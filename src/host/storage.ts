// src/host/storage.ts
import { randomBytes } from "node:crypto";
import { open, readFile, writeFile, rename, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ArtifactMeta {
  id: string;
  title: string;
  type: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
}
export interface PublishInput {
  type: string;
  title: string;
  html: string;
  tags?: string[];
}
export interface Storage {
  publish(input: PublishInput): Promise<{ id: string }>;
  update(id: string, input: { html: string; title?: string }): Promise<{ id: string }>;
  get(id: string): Promise<string | null>;
  list(): Promise<ArtifactMeta[]>;
  search(q: string): Promise<ArtifactMeta[]>;
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
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

interface Opts {
  now?: () => string;
  suffix?: () => string;
}

export function createStorage(dataDir: string, opts: Opts = {}): Storage {
  const now = opts.now ?? (() => new Date().toISOString());
  const suffix = opts.suffix ?? (() => randomBytes(3).toString("hex"));
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

  return {
    async publish(input) {
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
      };
      await writeAtomic(jsonPath(id), JSON.stringify(meta));
      return { id };
    },

    async update(id, input) {
      if (!isValidId(id) || !(await exists(htmlPath(id)))) {
        throw new NotFoundError(`no such artifact: ${id}`);
      }
      await writeAtomic(htmlPath(id), input.html);
      let meta: ArtifactMeta;
      try {
        meta = JSON.parse(await readFile(jsonPath(id), "utf8"));
      } catch {
        meta = { id, title: id, type: "page", tags: [], createdAt: now(), modifiedAt: now() };
      }
      meta.modifiedAt = now();
      if (input.title) meta.title = input.title;
      await writeAtomic(jsonPath(id), JSON.stringify(meta));
      return { id };
    },

    async get(id) {
      if (!isValidId(id)) return null;
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
        try {
          metas.push(JSON.parse(await readFile(join(dataDir, name), "utf8")));
        } catch {
          // skip unreadable metadata
        }
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
  };
}
