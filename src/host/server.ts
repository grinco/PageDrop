import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { access, constants } from "node:fs/promises";
import { escapeHtml } from "../core/html";
import { type HostConfig } from "./config";
import { createStorage, NotFoundError, isValidId, type Storage } from "./storage";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
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
          const { id } = await storage.publish({
            type: String(body.type),
            title: String(body.title),
            html: String(body.html ?? ""),
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          });
          return sendJson(req, res, 201, { id });
        }

        const artifactMatch = path.match(/^\/api\/artifacts\/([^/]+)$/);
        if (req.method === "PUT" && artifactMatch) {
          const id = decodeURIComponent(artifactMatch[1]);
          const body = await readJson(req);
          try {
            await storage.update(id, { html: String(body.html ?? ""), title: body.title ? String(body.title) : undefined });
            return sendJson(req, res, 200, { id });
          } catch (err) {
            if (err instanceof NotFoundError) return sendError(req, res, 404, "not_found", err.message);
            throw err;
          }
        }

        if (req.method === "GET" && path === "/api/artifacts") {
          return sendJson(req, res, 200, { items: await storage.list() });
        }

        if (req.method === "GET" && path === "/api/search") {
          return sendJson(req, res, 200, { items: await storage.search(url.searchParams.get("q") ?? "") });
        }

        return sendError(req, res, 404, "not_found", "no such route");
      } catch (err) {
        if (err instanceof SyntaxError) return sendError(req, res, 400, "bad_request", "invalid JSON body");
        return sendError(req, res, 500, "internal", (err as Error).message);
      }
    })();
  };
}

// --- viewing handler + start() are added in Task 6 ---
export function createViewHandler(storage: Storage): Handler {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://host");
        const path = url.pathname;
        if (await handleProbe(req, res, path)) return;

        const pageMatch = path.match(/^\/p\/([^/]+)$/);
        if (req.method === "GET" && pageMatch) {
          const id = decodeURIComponent(pageMatch[1]);
          const html = isValidId(id) ? await storage.get(id) : null;
          if (html === null) {
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("<h1>Not found</h1>");
            log(req, 404);
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          log(req, 200);
          return;
        }

        if (req.method === "GET" && path === "/") {
          const items = await storage.list();
          const rows = items
            .map(
              (i) =>
                `<li><a href="/p/${encodeURIComponent(i.id)}">${escapeHtml(i.title)}</a> ` +
                `<small>(${escapeHtml(i.type)}, ${escapeHtml(i.modifiedAt)})</small></li>`,
            )
            .join("\n");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><meta charset="utf-8"><title>PageDrop</title><h1>PageDrop</h1><ul>${rows}</ul>`);
          log(req, 200);
          return;
        }

        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>Not found</h1>");
        log(req, 404);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>Server error</h1>");
        log(req, 500, (err as Error).message);
      }
    })();
  };
}

export function start(config: HostConfig): { view: Server; api: Server } {
  const storage = createStorage(config.dataDir);
  const view = createServer(createViewHandler(storage));
  const api = createServer(createApiHandler(storage, config.token, config.dataDir));
  view.listen(config.viewPort, () => console.log(`viewing on :${config.viewPort}`));
  api.listen(config.apiPort, () => console.log(`api on :${config.apiPort}`));
  return { view, api };
}
