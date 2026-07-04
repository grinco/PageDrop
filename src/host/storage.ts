// src/host/storage.ts
import { randomBytes } from "node:crypto";
import { open, readFile, writeFile, rename, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hashPassword, type StoredPassword } from "./password";
import { generatePassphrase } from "./passphrase";

export interface ArtifactMeta {
  id: string;
  title: string;
  type: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  expiresAt?: string; // ISO 8601; absent = never expires
  password?: StoredPassword; // absent = no password
}
export interface PublishInput {
  type: string;
  title: string;
  html: string;
  tags?: string[];
  ttlSeconds?: number; // >0 sets expiry; 0 = never (overrides default); omitted = global default
  password?: string; // plaintext; hashed here
}
export interface ProtectionInput {
  password?: string | null; // string = set; null = clear; omitted = unchanged
  ttlSeconds?: number | null; // >0 = set expiry; 0/null = clear; omitted = unchanged
}
/** A password was auto-generated iff `password` is present in the result. */
export interface WriteResult {
  id: string;
  password?: string;
}
export interface Storage {
  publish(input: PublishInput): Promise<WriteResult>;
  update(id: string, input: { html: string; title?: string }): Promise<{ id: string }>;
  delete(id: string): Promise<void>;
  setProtection(id: string, input: ProtectionInput): Promise<WriteResult>;
  get(id: string): Promise<string | null>;
  getMeta(id: string): Promise<ArtifactMeta | null>;
  list(): Promise<ArtifactMeta[]>;
  search(q: string): Promise<ArtifactMeta[]>;
  deleteExpired(): Promise<number>;
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Client-caused input error; the server maps this to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "page";
}

/** Minimum length for a user-supplied password (auto-generated ones far exceed it). */
export const MIN_PASSWORD_LENGTH = 8;

interface Opts {
  now?: () => string;
  suffix?: () => string;
  defaultTtlSeconds?: number;
  defaultProtect?: boolean;
  genPassword?: () => string;
}

export function createStorage(dataDir: string, opts: Opts = {}): Storage {
  const now = opts.now ?? (() => new Date().toISOString());
  const suffix = opts.suffix ?? (() => randomBytes(3).toString("hex"));
  const genPassword = opts.genPassword ?? generatePassphrase;
  const defaultTtlSeconds = opts.defaultTtlSeconds;
  const defaultProtect = opts.defaultProtect ?? false;
  const htmlPath = (id: string) => join(dataDir, `${id}.html`);
  const jsonPath = (id: string) => join(dataDir, `${id}.json`);

  async function writeAtomic(path: string, data: string): Promise<void> {
    const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, data, "utf8");
    await rename(tmp, path);
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async function readMeta(id: string): Promise<ArtifactMeta | null> {
    try {
      return JSON.parse(await readFile(jsonPath(id), "utf8"));
    } catch {
      return null;
    }
  }

  function isExpired(meta: ArtifactMeta): boolean {
    return meta.expiresAt !== undefined && meta.expiresAt <= now();
  }

  // Resolve a caller-supplied ttlSeconds to an absolute expiry (or undefined).
  function resolveExpiry(ttlSeconds: number | undefined): string | undefined {
    if (ttlSeconds === undefined) {
      if (defaultTtlSeconds && defaultTtlSeconds > 0) {
        return new Date(Date.parse(now()) + defaultTtlSeconds * 1000).toISOString();
      }
      return undefined;
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new ValidationError("ttlSeconds must be a non-negative number");
    }
    if (ttlSeconds === 0) return undefined; // explicit "never", overrides default
    return new Date(Date.parse(now()) + ttlSeconds * 1000).toISOString();
  }

  function hashSupplied(plain: string): StoredPassword {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return hashPassword(plain);
  }

  return {
    async publish(input) {
      const expiresAt = resolveExpiry(input.ttlSeconds);
      // Resolve protection before reserving the id so validation errors don't leave files.
      let password: StoredPassword | undefined;
      let generated: string | undefined;
      if (input.password !== undefined && input.password !== "") {
        password = hashSupplied(input.password);
      } else if (defaultProtect) {
        generated = genPassword();
        password = hashPassword(generated);
      }

      const base = slug(input.title);
      // Reserve a unique id via exclusive create; retry on collision.
      let id = "";
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = `${base}-${suffix()}`;
        try {
          const fh = await open(htmlPath(candidate), "wx");
          await fh.writeFile(input.html, "utf8");
          await fh.close();
          id = candidate;
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw err;
        }
      }
      if (!id) throw new Error("could not allocate a unique id after 10 attempts");
      const ts = now();
      const meta: ArtifactMeta = {
        id,
        title: input.title,
        type: input.type,
        tags: input.tags ?? [],
        createdAt: ts,
        modifiedAt: ts,
        ...(expiresAt ? { expiresAt } : {}),
        ...(password ? { password } : {}),
      };
      await writeAtomic(jsonPath(id), JSON.stringify(meta));
      return generated ? { id, password: generated } : { id };
    },

    async update(id, input) {
      if (!isValidId(id) || !(await exists(htmlPath(id)))) {
        throw new NotFoundError(`no such artifact: ${id}`);
      }
      await writeAtomic(htmlPath(id), input.html);
      let meta = await readMeta(id);
      if (!meta) {
        meta = { id, title: id, type: "page", tags: [], createdAt: now(), modifiedAt: now() };
      }
      meta.modifiedAt = now();
      if (input.title) meta.title = input.title;
      await writeAtomic(jsonPath(id), JSON.stringify(meta));
      return { id };
    },

    async delete(id) {
      // Physical presence, not logical expiry: an expired-but-unreaped artifact
      // is still explicitly deletable.
      if (!isValidId(id) || !(await exists(htmlPath(id)))) {
        throw new NotFoundError(`no such artifact: ${id}`);
      }
      await unlink(htmlPath(id));
      await unlink(jsonPath(id)).catch(() => {}); // tolerate a missing sidecar
    },

    async setProtection(id, input) {
      if (!isValidId(id) || !(await exists(htmlPath(id)))) {
        throw new NotFoundError(`no such artifact: ${id}`);
      }
      let meta = await readMeta(id);
      if (!meta) {
        meta = { id, title: id, type: "page", tags: [], createdAt: now(), modifiedAt: now() };
      }

      let generated: string | undefined;
      if (input.password === null) {
        delete meta.password;
      } else if (input.password !== undefined && input.password !== "") {
        meta.password = hashSupplied(input.password);
      } else if (input.password === undefined && !meta.password && defaultProtect) {
        generated = genPassword();
        meta.password = hashPassword(generated);
      }

      if (input.ttlSeconds === null) {
        delete meta.expiresAt;
      } else if (input.ttlSeconds !== undefined) {
        const expiresAt = resolveExpiry(input.ttlSeconds);
        if (expiresAt) meta.expiresAt = expiresAt;
        else delete meta.expiresAt;
      }

      meta.modifiedAt = now();
      await writeAtomic(jsonPath(id), JSON.stringify(meta));
      return generated ? { id, password: generated } : { id };
    },

    async getMeta(id) {
      if (!isValidId(id)) return null;
      const meta = await readMeta(id);
      if (!meta || isExpired(meta) || !(await exists(htmlPath(id)))) return null;
      return meta;
    },

    async get(id) {
      if ((await this.getMeta(id)) === null) return null;
      try {
        return await readFile(htmlPath(id), "utf8");
      } catch {
        return null;
      }
    },

    async list() {
      let names: string[];
      try {
        names = await readdir(dataDir);
      } catch {
        return [];
      }
      const metas: ArtifactMeta[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (!(await exists(htmlPath(id)))) continue; // skip orphaned metadata
        const meta = await readMeta(id);
        if (!meta || isExpired(meta)) continue; // skip unreadable and expired
        metas.push(meta);
      }
      return metas.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    },

    async search(q) {
      const term = q.toLowerCase();
      const all = await this.list();
      const hits: ArtifactMeta[] = [];
      for (const meta of all) {
        if (meta.title.toLowerCase().includes(term)) {
          hits.push(meta);
          continue;
        }
        const html = (await readFile(htmlPath(meta.id), "utf8").catch(() => "")).toLowerCase();
        if (html.includes(term)) hits.push(meta);
      }
      return hits;
    },

    async deleteExpired() {
      let names: string[];
      try {
        names = await readdir(dataDir);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        const meta = await readMeta(id);
        if (!meta || !isExpired(meta)) continue;
        await unlink(htmlPath(id)).catch(() => {});
        await unlink(jsonPath(id)).catch(() => {});
        removed++;
      }
      return removed;
    },
  };
}
