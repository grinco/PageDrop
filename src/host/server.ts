import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { access, constants } from "node:fs/promises";
import { escapeHtml } from "../core/html";
import { type HostConfig } from "./config";
import {
  createStorage,
  NotFoundError,
  ValidationError,
  isValidId,
  type ArtifactMeta,
  type Storage,
} from "./storage";
import { verifyPassword } from "./password";
import { signCookie, verifyCookie } from "./cookie";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FORM_BYTES = 4 * 1024;
const COOKIE_TTL_SECONDS = 3600;
const DEFAULT_FAIL_DELAY_MS = 250;

function log(req: IncomingMessage, status: number, extra = ""): void {
  console.log(`${req.method} ${req.url} -> ${status}${extra ? " " + extra : ""}`);
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
  log(req, status);
}

function sendError(req: IncomingMessage, res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(req, res, status, { error: { code, message } });
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > maxBytes) throw new ValidationError("request body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, MAX_JSON_BYTES);
  return raw ? JSON.parse(raw) : {};
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice("Bearer ".length) : "";
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// Public-facing shape: never exposes the password hash.
interface ArtifactDto {
  id: string;
  title: string;
  type: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  expiresAt: string | null;
  protected: boolean;
}

function toDto(meta: ArtifactMeta): ArtifactDto {
  return {
    id: meta.id,
    title: meta.title,
    type: meta.type,
    tags: meta.tags,
    createdAt: meta.createdAt,
    modifiedAt: meta.modifiedAt,
    expiresAt: meta.expiresAt ?? null,
    protected: meta.password !== undefined,
  };
}

// Map a thrown error to an HTTP response; returns true if handled.
function handleError(req: IncomingMessage, res: ServerResponse, err: unknown): void {
  if (err instanceof SyntaxError) return sendError(req, res, 400, "bad_request", "invalid JSON body");
  if (err instanceof ValidationError) return sendError(req, res, 400, "bad_request", err.message);
  if (err instanceof NotFoundError) return sendError(req, res, 404, "not_found", err.message);
  return sendError(req, res, 500, "internal", (err as Error).message);
}

// Shared unauthenticated probes; returns true if handled.
async function handleProbe(req: IncomingMessage, res: ServerResponse, path: string, dataDir?: string): Promise<boolean> {
  if (path === "/healthz") {
    sendJson(req, res, 200, { status: "ok" });
    return true;
  }
  if (path === "/readyz") {
    let ready = true;
    if (dataDir) {
      try {
        await access(dataDir, constants.W_OK);
      } catch {
        ready = false;
      }
    }
    sendJson(req, res, ready ? 200 : 503, { status: ready ? "ready" : "unready" });
    return true;
  }
  return false;
}

// Coerce a JSON field to the ttl argument shape (number | null | undefined).
function ttlArg(body: Record<string, unknown>): number | null | undefined {
  if (!("ttlSeconds" in body)) return undefined;
  const v = body.ttlSeconds;
  if (v === null) return null;
  return Number(v);
}

function passwordArg(body: Record<string, unknown>): string | null | undefined {
  if (!("password" in body)) return undefined;
  const v = body.password;
  if (v === null) return null;
  return String(v);
}

export function createApiHandler(storage: Storage, token: string, dataDir?: string): Handler {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://host");
        const path = url.pathname;
        if (await handleProbe(req, res, path, dataDir)) return;

        if (!token || !tokenMatches(bearer(req), token)) {
          return sendError(req, res, 401, "unauthorized", "invalid or missing bearer token");
        }

        if (req.method === "POST" && path === "/api/publish") {
          const body = await readJson(req);
          if (!body.title || !body.type) {
            return sendError(req, res, 400, "bad_request", "type and title are required");
          }
          const result = await storage.publish({
            type: String(body.type),
            title: String(body.title),
            html: String(body.html ?? ""),
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
            ttlSeconds: body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds),
            password: body.password === undefined ? undefined : String(body.password),
          });
          return sendJson(req, res, 201, result);
        }

        const protectMatch = path.match(/^\/api\/artifacts\/([^/]+)\/protect$/);
        if (req.method === "POST" && protectMatch) {
          const id = decodeURIComponent(protectMatch[1]);
          const body = await readJson(req);
          const result = await storage.setProtection(id, {
            password: passwordArg(body),
            ttlSeconds: ttlArg(body),
          });
          return sendJson(req, res, 200, result);
        }

        const artifactMatch = path.match(/^\/api\/artifacts\/([^/]+)$/);
        if (req.method === "PUT" && artifactMatch) {
          const id = decodeURIComponent(artifactMatch[1]);
          const body = await readJson(req);
          await storage.update(id, { html: String(body.html ?? ""), title: body.title ? String(body.title) : undefined });
          return sendJson(req, res, 200, { id });
        }

        if (req.method === "DELETE" && artifactMatch) {
          const id = decodeURIComponent(artifactMatch[1]);
          await storage.delete(id);
          return sendJson(req, res, 200, { id });
        }

        if (req.method === "GET" && path === "/api/artifacts") {
          return sendJson(req, res, 200, { items: (await storage.list()).map(toDto) });
        }

        if (req.method === "GET" && path === "/api/search") {
          return sendJson(req, res, 200, { items: (await storage.search(url.searchParams.get("q") ?? "")).map(toDto) });
        }

        return sendError(req, res, 404, "not_found", "no such route");
      } catch (err) {
        return handleError(req, res, err);
      }
    })();
  };
}

export interface ViewHandlerOptions {
  cookieSecret?: string;
  cookieTtlSeconds?: number;
  failDelayMs?: number;
  now?: () => number; // epoch seconds
}

function passwordForm(id: string, error = false): string {
  const action = `/p/${encodeURIComponent(id)}`;
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Password required</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:15vh auto;padding:0 1rem}` +
    `form{display:flex;gap:.5rem}input{flex:1;padding:.5rem}button{padding:.5rem .9rem}` +
    `.err{color:#b00020}</style>` +
    `<h1>🔒 This page is protected</h1>` +
    (error ? `<p class="err">Incorrect password. Try again.</p>` : "") +
    `<form method="POST" action="${action}">` +
    `<input type="password" name="password" placeholder="Password" autofocus aria-label="Password">` +
    `<button type="submit">Unlock</button></form>`
  );
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export function createViewHandler(storage: Storage, dataDir?: string, options: ViewHandlerOptions = {}): Handler {
  const cookieTtl = options.cookieTtlSeconds ?? COOKIE_TTL_SECONDS;
  const failDelayMs = options.failDelayMs ?? DEFAULT_FAIL_DELAY_MS;
  const nowSec = options.now ?? (() => Math.floor(Date.now() / 1000));
  const secret = options.cookieSecret ?? "";

  const notFound = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<h1>Not found</h1>");
    log(req, 404);
  };

  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://host");
        const path = url.pathname;
        if (await handleProbe(req, res, path, dataDir)) return;

        const pageMatch = path.match(/^\/p\/([^/]+)$/);

        // Password submission for a protected page.
        if (req.method === "POST" && pageMatch) {
          const id = decodeURIComponent(pageMatch[1]);
          const meta = isValidId(id) ? await storage.getMeta(id) : null;
          if (!meta) return notFound(req, res);
          const target = `/p/${encodeURIComponent(id)}`;
          if (!meta.password) {
            res.writeHead(302, { Location: target });
            res.end();
            return log(req, 302);
          }
          const raw = await readRawBody(req, MAX_FORM_BYTES);
          const submitted = new URLSearchParams(raw).get("password") ?? "";
          if (verifyPassword(submitted, meta.password)) {
            const token = signCookie(id, nowSec() + cookieTtl, secret);
            const cookie =
              `pd_auth_${id}=${token}; HttpOnly; SameSite=Lax; Secure; ` +
              `Path=${target}; Max-Age=${cookieTtl}`;
            res.writeHead(302, { Location: target, "Set-Cookie": cookie });
            res.end();
            return log(req, 302);
          }
          await delay(failDelayMs);
          const form = passwordForm(id, true);
          res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          res.end(form);
          return log(req, 401);
        }

        if (req.method === "GET" && pageMatch) {
          const id = decodeURIComponent(pageMatch[1]);
          const meta = isValidId(id) ? await storage.getMeta(id) : null;
          if (!meta) return notFound(req, res);

          if (meta.password) {
            const cookies = parseCookies(req.headers.cookie);
            const token = cookies[`pd_auth_${id}`];
            const authed = token !== undefined && verifyCookie(token, id, secret, nowSec());
            if (!authed) {
              res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
              res.end(passwordForm(id));
              return log(req, 401);
            }
          }

          const html = await storage.get(id);
          if (html === null) return notFound(req, res);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return log(req, 200);
        }

        if (req.method === "GET" && path === "/") {
          const items = await storage.list();
          const rows = items
            .map((i) => {
              const lock = i.password ? " 🔒" : "";
              return (
                `<li><a href="/p/${encodeURIComponent(i.id)}">${escapeHtml(i.title)}</a>${lock} ` +
                `<small>(${escapeHtml(i.type)}, ${escapeHtml(i.modifiedAt)})</small></li>`
              );
            })
            .join("\n");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><meta charset="utf-8"><title>PageDrop</title><h1>PageDrop</h1><ul>${rows}</ul>`);
          return log(req, 200);
        }

        return notFound(req, res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>Server error</h1>");
        log(req, 500, (err as Error).message);
      }
    })();
  };
}

export function start(config: HostConfig): { view: Server; api: Server } {
  let cookieSecret = config.cookieSecret;
  if (!cookieSecret) {
    cookieSecret = randomBytes(32).toString("hex");
    console.warn(
      "PAGEDROP_COOKIE_SECRET is unset; using a random per-process secret. " +
        "Unlock cookies will not survive a restart or validate across replicas — " +
        "set PAGEDROP_COOKIE_SECRET for any non-dev deployment.",
    );
  }

  const storage = createStorage(config.dataDir, {
    defaultTtlSeconds: config.defaultTtlSeconds,
    defaultProtect: config.defaultProtect,
  });
  const view = createServer(createViewHandler(storage, config.dataDir, { cookieSecret }));
  const api = createServer(createApiHandler(storage, config.token, config.dataDir));

  const reaper = setInterval(() => {
    storage.deleteExpired().catch((err) => console.error("reaper failed:", (err as Error).message));
  }, config.reaperIntervalSeconds * 1000);
  reaper.unref(); // never block process exit
  view.on("close", () => clearInterval(reaper));

  view.listen(config.viewPort, () => console.log(`viewing on :${config.viewPort}`));
  api.listen(config.apiPort, () => console.log(`api on :${config.apiPort}`));
  return { view, api };
}
