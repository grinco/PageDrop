# Kubernetes Static-Host Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third PageDrop publishing backend (`PAGEDROP_BACKEND=kubernetes`) that publishes rendered artifacts to a small self-hosted Node service on Kubernetes, with viewing behind the operator's SSO proxy.

**Architecture:** A dumb **host service** (`src/host/`) stores and serves rendered HTML on two ports — viewing (`:8080`, behind SSO) and a token-gated write API (`:8081`). A smart **Node adapter** (`src/adapters/k8s/`) implements the existing `Publisher` interface, does all HTML wrapping, and talks to the write API. Selection happens in the existing `createPublisher()` factory.

**Tech Stack:** TypeScript, Node 20 (`node:http`, `node:fs/promises`, `node:crypto`), Vitest, `tsx` (no build step), Docker, Helm.

## Global Constraints

- **TDD**: every production change is preceded by a failing test (write test → verify RED → implement → verify GREEN → commit). Copied verbatim from spec: "All Node code is written test-first."
- **No new runtime dependencies** in the host service — `node:*` built-ins only.
- **No `Co-Authored-By:` trailer** on any commit (repo rule).
- **Commit messages**: Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`).
- **Relative imports are extensionless** in new `src/` files, matching the neighbor `src/adapters/google/apps-script-publisher.ts`.
- **Backend token identity**: `PAGEDROP_HOST_TOKEN` (server) and `PAGEDROP_K8S_TOKEN` (adapter) are the same secret and must match.
- **id charset**: artifact ids match `^[a-z0-9][a-z0-9-]*$`; the host rejects any other id on read/update/serve (path-traversal guard).
- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`.

---

## File structure

Host service (`src/host/`):
- `config.ts` — `loadHostConfigFromEnv()` → `HostConfig`.
- `storage.ts` — `createStorage()`; publish/update/get/list/search over the PVC.
- `server.ts` — `createApiHandler()`, `createViewHandler()`, `start()`; routing, auth, index page, logging.
- `main.ts` — entrypoint: load config, `start()`.

Adapter (`src/adapters/k8s/`):
- `config.ts` — `loadK8sConfigFromEnv()` → `K8sConfig`.
- `host-client.ts` — `HostClient`, `K8sHostError`.
- `kubernetes-publisher.ts` — `KubernetesPublisher implements Publisher`.

Shared/wiring:
- `src/core/html.ts` — export `escapeHtml` (currently private) for the host index page.
- `src/adapters/google/create-publisher.ts` — add `kubernetes` case.
- `package.json` — add `host` script.

Packaging:
- `Dockerfile`
- `deploy/helm/pagedrop-host/` — chart.

Tests:
- `tests/host/config.test.ts`, `tests/host/storage.test.ts`, `tests/host/server.test.ts`
- `tests/adapters/k8s/config.test.ts`, `tests/adapters/k8s/host-client.test.ts`, `tests/adapters/k8s/kubernetes-publisher.test.ts`
- `tests/adapters/google/create-publisher.test.ts` (extend)

---

## Task 1: Host config loader

**Files:**
- Create: `src/host/config.ts`
- Test: `tests/host/config.test.ts`

**Interfaces:**
- Produces: `interface HostConfig { token: string; dataDir: string; viewPort: number; apiPort: number }` and `function loadHostConfigFromEnv(): HostConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/host/config.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { loadHostConfigFromEnv } from "../../src/host/config";

afterEach(() => vi.unstubAllEnvs());

describe("loadHostConfigFromEnv", () => {
  it("returns defaults for dataDir and ports when only the token is set", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    vi.stubEnv("PAGEDROP_HOST_DATA_DIR", undefined);
    vi.stubEnv("PAGEDROP_HOST_VIEW_PORT", undefined);
    vi.stubEnv("PAGEDROP_HOST_API_PORT", undefined);
    expect(loadHostConfigFromEnv()).toEqual({
      token: "s3cret",
      dataDir: "/data",
      viewPort: 8080,
      apiPort: 8081,
    });
  });

  it("honors overrides", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    vi.stubEnv("PAGEDROP_HOST_DATA_DIR", "/srv/pagedrop");
    vi.stubEnv("PAGEDROP_HOST_VIEW_PORT", "9090");
    vi.stubEnv("PAGEDROP_HOST_API_PORT", "9091");
    const c = loadHostConfigFromEnv();
    expect(c.dataDir).toBe("/srv/pagedrop");
    expect(c.viewPort).toBe(9090);
    expect(c.apiPort).toBe(9091);
  });

  it("throws without leaking the token when PAGEDROP_HOST_TOKEN is unset", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", undefined);
    expect(() => loadHostConfigFromEnv()).toThrow(/PAGEDROP_HOST_TOKEN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/host/config.test.ts`
Expected: FAIL — cannot find module `src/host/config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/host/config.ts
export interface HostConfig {
  token: string;
  dataDir: string;
  viewPort: number;
  apiPort: number;
}

export function loadHostConfigFromEnv(): HostConfig {
  const token = process.env.PAGEDROP_HOST_TOKEN;
  if (!token) {
    throw new Error("PAGEDROP_HOST_TOKEN is required (the write-API bearer token)");
  }
  return {
    token,
    dataDir: process.env.PAGEDROP_HOST_DATA_DIR ?? "/data",
    viewPort: Number(process.env.PAGEDROP_HOST_VIEW_PORT ?? "8080"),
    apiPort: Number(process.env.PAGEDROP_HOST_API_PORT ?? "8081"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/host/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/host/config.ts tests/host/config.test.ts
git commit -m "feat: host config loader for the k8s backend"
```

---

## Task 2: Storage — publish/get/update

**Files:**
- Create: `src/host/storage.ts`
- Test: `tests/host/storage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ArtifactMeta { id: string; title: string; type: string; tags: string[]; createdAt: string; modifiedAt: string }
  interface PublishInput { type: string; title: string; html: string; tags?: string[] }
  interface Storage {
    publish(input: PublishInput): Promise<{ id: string }>;
    update(id: string, input: { html: string; title?: string }): Promise<{ id: string }>;
    get(id: string): Promise<string | null>;
    list(): Promise<ArtifactMeta[]>;
    search(q: string): Promise<ArtifactMeta[]>;
  }
  class NotFoundError extends Error {}
  function createStorage(dataDir: string, opts?: { now?: () => string; suffix?: () => string }): Storage
  function isValidId(id: string): boolean   // ^[a-z0-9][a-z0-9-]*$
  ```
- `opts.now` (default `() => new Date().toISOString()`) and `opts.suffix` (default 6-hex from `crypto.randomBytes(3)`) are injected for deterministic tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/host/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage, NotFoundError, isValidId } from "../../src/host/storage";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pagedrop-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("storage publish/get/update", () => {
  it("publishes and serves HTML, with a slug-based id", async () => {
    const s = createStorage(dir, { now: () => "2026-07-04T00:00:00.000Z", suffix: () => "abc123" });
    const { id } = await s.publish({ type: "page", title: "Q3 Report!", html: "<h1>hi</h1>" });
    expect(id).toBe("q3-report-abc123");
    expect(await s.get(id)).toBe("<h1>hi</h1>");
    expect(JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"))).toMatchObject({
      id, title: "Q3 Report!", type: "page", createdAt: "2026-07-04T00:00:00.000Z",
    });
  });

  it("returns null for a missing id and rejects traversal ids", async () => {
    const s = createStorage(dir);
    expect(await s.get("does-not-exist")).toBeNull();
    expect(await s.get("../etc/passwd")).toBeNull();
    expect(isValidId("../x")).toBe(false);
    expect(isValidId("q3-report-abc123")).toBe(true);
  });

  it("retries on id collision instead of overwriting", async () => {
    let n = 0;
    const suffixes = ["dupe01", "dupe01", "uniq02"]; // first two collide
    const s = createStorage(dir, { suffix: () => suffixes[n++] });
    const a = await s.publish({ type: "page", title: "T", html: "<p>a</p>" });
    const b = await s.publish({ type: "page", title: "T", html: "<p>b</p>" });
    expect(a.id).toBe("t-dupe01");
    expect(b.id).toBe("t-uniq02");
    expect(await s.get(a.id)).toBe("<p>a</p>"); // first not clobbered
    expect(await s.get(b.id)).toBe("<p>b</p>");
  });

  it("updates existing content and bumps modifiedAt, but 404s for a missing id", async () => {
    const times = ["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z"];
    let t = 0;
    const s = createStorage(dir, { now: () => times[Math.min(t++, times.length - 1)], suffix: () => "x1" });
    const { id } = await s.publish({ type: "page", title: "P", html: "<p>old</p>" });
    await s.update(id, { html: "<p>new</p>" });
    expect(await s.get(id)).toBe("<p>new</p>");
    const meta = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
    expect(meta.modifiedAt).toBe("2026-02-02T00:00:00.000Z");
    await expect(s.update("nope-000000", { html: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/host/storage.test.ts`
Expected: FAIL — cannot find module `src/host/storage`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/host/storage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/host/storage.ts tests/host/storage.test.ts
git commit -m "feat: host storage layer (publish/get/update) with atomic, collision-safe writes"
```

---

## Task 3: Storage — list/search (orphan tolerance)

**Files:**
- Modify: `src/host/storage.ts` (already implements `list`/`search` from Task 2 — this task adds their tests and proves orphan tolerance)
- Test: `tests/host/storage.test.ts` (append)

**Interfaces:**
- Consumes: `Storage.list()`, `Storage.search()` from Task 2.

- [ ] **Step 1: Write the failing test (append to the file)**

```ts
// tests/host/storage.test.ts — append
describe("storage list/search", () => {
  it("lists newest-first and skips orphaned metadata", async () => {
    const times = ["2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z"];
    let t = 0;
    const s = createStorage(dir, { now: () => times[Math.min(t++, 1)], suffix: () => `s${t}` });
    await s.publish({ type: "page", title: "First", html: "<p>1</p>" });
    await s.publish({ type: "doc", title: "Second", html: "<p>2</p>" });
    // Orphan: a .json with no matching .html must be ignored.
    await writeFile(join(dir, "ghost-000000.json"),
      JSON.stringify({ id: "ghost-000000", title: "Ghost", type: "page", tags: [], createdAt: "x", modifiedAt: "x" }));
    const items = await s.list();
    expect(items.map((i) => i.title)).toEqual(["Second", "First"]);
  });

  it("searches title and HTML content case-insensitively", async () => {
    const s = createStorage(dir, { suffix: () => Math.random().toString(16).slice(2, 8) });
    await s.publish({ type: "page", title: "Budget Dashboard", html: "<p>x</p>" });
    await s.publish({ type: "page", title: "Roadmap", html: "<p>quarterly REVENUE</p>" });
    expect((await s.search("budget")).map((i) => i.title)).toEqual(["Budget Dashboard"]);
    expect((await s.search("revenue")).map((i) => i.title)).toEqual(["Roadmap"]);
    expect(await s.search("nothing")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (implementation already exists)**

Run: `npx vitest run tests/host/storage.test.ts`
Expected: PASS (all 6 tests). If list/search behavior is wrong, fix `src/host/storage.ts` until green — do not change the tests.

- [ ] **Step 3: Commit**

```bash
git add tests/host/storage.test.ts
git commit -m "test: cover host storage list ordering, orphan skip, and search"
```

---

## Task 4: Export `escapeHtml` from core

**Files:**
- Modify: `src/core/html.ts` (change `function escapeHtml` → `export function escapeHtml`)
- Test: `tests/core/html.test.ts` (append)

**Interfaces:**
- Produces: `export function escapeHtml(s: string): string` (already exists privately; just export it).

- [ ] **Step 1: Write the failing test (append)**

```ts
// tests/core/html.test.ts — append
import { escapeHtml } from "../../src/core/html";

describe("escapeHtml", () => {
  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtml('<script>a & b</script>')).toBe("&lt;script&gt;a &amp; b&lt;/script&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/html.test.ts`
Expected: FAIL — `escapeHtml` is not exported.

- [ ] **Step 3: Implement (one-word change)**

In `src/core/html.ts`, change:
```ts
function escapeHtml(s: string): string {
```
to:
```ts
export function escapeHtml(s: string): string {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/html.ts tests/core/html.test.ts
git commit -m "refactor: export escapeHtml for reuse by the host index page"
```

---

## Task 5: Host server — write API (`:8081`)

**Files:**
- Create: `src/host/server.ts`
- Test: `tests/host/server.test.ts`

**Interfaces:**
- Consumes: `Storage`, `NotFoundError`, `isValidId` (Task 2); `HostConfig` (Task 1).
- Produces:
  ```ts
  function createApiHandler(storage: Storage, token: string): (req, res) => void
  function createViewHandler(storage: Storage): (req, res) => void   // Task 6
  function start(config: HostConfig): { view: import("node:http").Server; api: import("node:http").Server }  // Task 6
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/host/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../../src/host/storage";
import { createApiHandler } from "../../src/host/server";

let dir: string;
let server: Server;
let base: string;
const TOKEN = "test-token";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pagedrop-api-"));
  server = createServer(createApiHandler(createStorage(dir), TOKEN));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("host write API", () => {
  it("rejects requests without a valid token", async () => {
    const res = await fetch(`${base}/api/artifacts`);
    expect(res.status).toBe(401);
  });

  it("publishes, lists, searches, and updates", async () => {
    const pub = await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ type: "page", title: "Q3", html: "<h1>hi</h1>" }),
    });
    expect(pub.status).toBe(201);
    const { id } = await pub.json();
    expect(id).toMatch(/^q3-/);

    const list = await (await fetch(`${base}/api/artifacts`, { headers: auth })).json();
    expect(list.items).toHaveLength(1);

    const found = await (await fetch(`${base}/api/search?q=hi`, { headers: auth })).json();
    expect(found.items).toHaveLength(1);

    const upd = await fetch(`${base}/api/artifacts/${id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ html: "<h1>bye</h1>" }),
    });
    expect(upd.status).toBe(200);
  });

  it("returns 404 when updating a nonexistent artifact (never creates)", async () => {
    const res = await fetch(`${base}/api/artifacts/missing-000000`, {
      method: "PUT", headers: auth, body: JSON.stringify({ html: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("serves /healthz and /readyz without a token", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/host/server.test.ts`
Expected: FAIL — cannot find module `src/host/server`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/host/server.ts
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
```

Note: the implementation for Task 6 (viewing handler + `start`) is included here because `server.ts` is one file; Task 6 adds its tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/host/server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/host/server.ts tests/host/server.test.ts
git commit -m "feat: host write API with bearer auth, publish/update/list/search, probes"
```

---

## Task 6: Host server — viewing surface + entrypoint

**Files:**
- Modify: `src/host/server.ts` (viewing handler + `start` already written in Task 5 — this task tests them)
- Create: `src/host/main.ts`
- Modify: `package.json` (add `host` script)
- Test: `tests/host/server.test.ts` (append)

**Interfaces:**
- Consumes: `createViewHandler`, `start` (Task 5); `loadHostConfigFromEnv` (Task 1).

- [ ] **Step 1: Write the failing test (append)**

```ts
// tests/host/server.test.ts — append
import { createViewHandler } from "../../src/host/server";

describe("host viewing surface", () => {
  it("serves published HTML at /p/:id and escapes titles in the index", async () => {
    const storage = createStorage(dir);
    const { id } = await storage.publish({ type: "page", title: "<script>evil</script>", html: "<h1>real page</h1>" });
    const view = createServer(createViewHandler(storage));
    await new Promise<void>((r) => view.listen(0, "127.0.0.1", r));
    const addr = view.address();
    const vbase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

    const page = await fetch(`${vbase}/p/${id}`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<h1>real page</h1>");

    const index = await (await fetch(`${vbase}/`)).text();
    expect(index).toContain("&lt;script&gt;evil&lt;/script&gt;");
    expect(index).not.toContain("<script>evil");

    expect((await fetch(`${vbase}/p/does-not-exist`)).status).toBe(404);
    await new Promise<void>((r) => view.close(() => r()));
  });
});
```

- [ ] **Step 2: Run test to verify it passes (implementation already present)**

Run: `npx vitest run tests/host/server.test.ts`
Expected: PASS (all 5 tests). If the index isn't escaped, fix `createViewHandler` — not the test.

- [ ] **Step 3: Create the entrypoint**

```ts
// src/host/main.ts
import { loadHostConfigFromEnv } from "./config";
import { start } from "./server";

start(loadHostConfigFromEnv());
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:
```json
"host": "tsx src/host/main.ts",
```

- [ ] **Step 5: Verify the host boots and serves (manual smoke)**

Run:
```bash
PAGEDROP_HOST_TOKEN=smoke PAGEDROP_HOST_DATA_DIR="$(mktemp -d)" \
  PAGEDROP_HOST_VIEW_PORT=8080 PAGEDROP_HOST_API_PORT=8081 \
  timeout --preserve-status 2 npm run host
```
Expected: logs `viewing on :8080` and `api on :8081`, no crash (exits on timeout).

- [ ] **Step 6: Commit**

```bash
git add src/host/main.ts package.json tests/host/server.test.ts
git commit -m "feat: host viewing surface (/p/:id, escaped index) and entrypoint"
```

---

## Task 7: Adapter config loader

**Files:**
- Create: `src/adapters/k8s/config.ts`
- Test: `tests/adapters/k8s/config.test.ts`

**Interfaces:**
- Produces: `interface K8sConfig { apiUrl: string; baseUrl: string; token: string }` and `function loadK8sConfigFromEnv(): K8sConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/adapters/k8s/config.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { loadK8sConfigFromEnv } from "../../../src/adapters/k8s/config";

afterEach(() => vi.unstubAllEnvs());

function setAll() {
  vi.stubEnv("PAGEDROP_K8S_API_URL", "https://pagedrop-api.internal/api");
  vi.stubEnv("PAGEDROP_K8S_BASE_URL", "https://pagedrop.internal");
  vi.stubEnv("PAGEDROP_K8S_TOKEN", "super-secret");
}

describe("loadK8sConfigFromEnv", () => {
  it("returns all three values when set", () => {
    setAll();
    expect(loadK8sConfigFromEnv()).toEqual({
      apiUrl: "https://pagedrop-api.internal/api",
      baseUrl: "https://pagedrop.internal",
      token: "super-secret",
    });
  });

  it("throws without leaking the token when PAGEDROP_K8S_TOKEN is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_K8S_TOKEN", undefined);
    let thrown: unknown;
    try { loadK8sConfigFromEnv(); } catch (e) { thrown = e; }
    expect((thrown as Error).message).toContain("PAGEDROP_K8S_TOKEN");
    expect((thrown as Error).message).not.toContain("super-secret");
  });

  it("throws when PAGEDROP_K8S_API_URL is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_K8S_API_URL", undefined);
    expect(() => loadK8sConfigFromEnv()).toThrow(/PAGEDROP_K8S_API_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/k8s/config.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/adapters/k8s/config.ts
export interface K8sConfig {
  apiUrl: string;
  baseUrl: string;
  token: string;
}

export function loadK8sConfigFromEnv(): K8sConfig {
  const { PAGEDROP_K8S_API_URL, PAGEDROP_K8S_BASE_URL, PAGEDROP_K8S_TOKEN } = process.env;
  const missing = [
    ["PAGEDROP_K8S_API_URL", PAGEDROP_K8S_API_URL],
    ["PAGEDROP_K8S_BASE_URL", PAGEDROP_K8S_BASE_URL],
    ["PAGEDROP_K8S_TOKEN", PAGEDROP_K8S_TOKEN],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing k8s backend env vars: ${missing.join(", ")}`);
  return {
    apiUrl: PAGEDROP_K8S_API_URL as string,
    baseUrl: PAGEDROP_K8S_BASE_URL as string,
    token: PAGEDROP_K8S_TOKEN as string,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/k8s/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/k8s/config.ts tests/adapters/k8s/config.test.ts
git commit -m "feat: k8s adapter config loader"
```

---

## Task 8: Host client (HTTP transport)

**Files:**
- Create: `src/adapters/k8s/host-client.ts`
- Test: `tests/adapters/k8s/host-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class K8sHostError extends Error { readonly status: number }
  type FetchLike = (url: string, init: { method: string; headers: Record<string,string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>
  interface RemoteItem { id: string; title: string; type: string; createdAt?: string; modifiedAt?: string; tags?: string[] }
  class HostClient {
    constructor(apiUrl: string, token: string, fetchFn?: FetchLike)
    publish(body: { type: string; title: string; html: string; tags?: string[] }): Promise<{ id: string }>
    update(id: string, body: { html: string; title?: string }): Promise<{ id: string }>
    list(): Promise<{ items: RemoteItem[] }>
    search(q: string): Promise<{ items: RemoteItem[] }>
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/adapters/k8s/host-client.test.ts
import { describe, it, expect } from "vitest";
import { HostClient, K8sHostError } from "../../../src/adapters/k8s/host-client";

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("HostClient", () => {
  it("POSTs publish with a bearer header and returns the id", async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, init });
      return res({ id: "q3-abc123" }, 201);
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    const out = await client.publish({ type: "page", title: "Q3", html: "<h1>x</h1>" });
    expect(out).toEqual({ id: "q3-abc123" });
    expect(calls[0].url).toBe("https://api.internal/api/publish");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ type: "page", title: "Q3", html: "<h1>x</h1>" });
  });

  it("maps a non-2xx response to K8sHostError carrying the status", async () => {
    const fetchFn = async () => res({ error: { code: "not_found", message: "nope" } }, 404);
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await expect(client.update("missing", { html: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(client.update("missing", { html: "x" })).rejects.toBeInstanceOf(K8sHostError);
  });

  it("lists and searches", async () => {
    const fetchFn = async (url: string) =>
      res({ items: [{ id: "a", title: "A", type: "page" }] });
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    expect((await client.list()).items).toHaveLength(1);
    expect((await client.search("a")).items[0].id).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/k8s/host-client.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/adapters/k8s/host-client.ts
export class K8sHostError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "K8sHostError";
  }
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RemoteItem {
  id: string;
  title: string;
  type: string;
  createdAt?: string;
  modifiedAt?: string;
  tags?: string[];
}

export class HostClient {
  private readonly fetchFn: FetchLike;
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {
    this.fetchFn = fetchFn;
  }

  private base(): string {
    return this.apiUrl.replace(/\/+$/, "");
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${this.base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!res.ok) throw new K8sHostError(res.status, `host returned HTTP ${res.status}`);
        throw new K8sHostError(res.status, "malformed response from host");
      }
    }
    if (!res.ok) {
      const err = parsed.error as { message?: string } | undefined;
      throw new K8sHostError(res.status, err?.message ?? `host returned HTTP ${res.status}`);
    }
    return parsed;
  }

  async publish(body: { type: string; title: string; html: string; tags?: string[] }): Promise<{ id: string }> {
    return (await this.call("POST", "/publish", body)) as { id: string };
  }
  async update(id: string, body: { html: string; title?: string }): Promise<{ id: string }> {
    return (await this.call("PUT", `/artifacts/${encodeURIComponent(id)}`, body)) as { id: string };
  }
  async list(): Promise<{ items: RemoteItem[] }> {
    return (await this.call("GET", "/artifacts")) as unknown as { items: RemoteItem[] };
  }
  async search(q: string): Promise<{ items: RemoteItem[] }> {
    return (await this.call("GET", `/search?q=${encodeURIComponent(q)}`)) as unknown as { items: RemoteItem[] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/k8s/host-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/k8s/host-client.ts tests/adapters/k8s/host-client.test.ts
git commit -m "feat: k8s host client with bearer auth and typed errors"
```

---

## Task 9: KubernetesPublisher (Publisher impl)

**Files:**
- Create: `src/adapters/k8s/kubernetes-publisher.ts`
- Test: `tests/adapters/k8s/kubernetes-publisher.test.ts`

**Interfaces:**
- Consumes: `HostClient`, `RemoteItem` (Task 8); `renderMarkdown` (`src/core/markdown`), `wrapHtmlDocument` (`src/core/html`), `Publisher`/`Artifact`/`ArtifactRef`/`PublishResult`/`SharingScope` (`src/core/types`).
- Produces: `class KubernetesPublisher implements Publisher` with `constructor(client: HostClient, config: { baseUrl: string })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/adapters/k8s/kubernetes-publisher.test.ts
import { describe, it, expect } from "vitest";
import { KubernetesPublisher } from "../../../src/adapters/k8s/kubernetes-publisher";
import type { HostClient } from "../../../src/adapters/k8s/host-client";

class FakeHost {
  public calls: { m: string; args: unknown[] }[] = [];
  publishReturn = { id: "q3-abc123" };
  async publish(body: unknown) { this.calls.push({ m: "publish", args: [body] }); return this.publishReturn; }
  async update(id: string, body: unknown) { this.calls.push({ m: "update", args: [id, body] }); return { id }; }
  async list() { this.calls.push({ m: "list", args: [] }); return { items: [{ id: "a", title: "A", type: "page" }] }; }
  async search(q: string) { this.calls.push({ m: "search", args: [q] }); return { items: [{ id: "a", title: "A", type: "page" }] }; }
  last() { return this.calls[this.calls.length - 1]; }
}

const config = { baseUrl: "https://pagedrop.internal" };

describe("KubernetesPublisher", () => {
  it("publishes a page as wrapped HTML and composes a /p/ view URL", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.publish({ type: "page", title: "Q3", content: "<h1>x</h1>" });
    const body = host.last().args[0] as { type: string; title: string; html: string };
    expect(body.type).toBe("page");
    expect(body.html).toContain("<h1>x</h1>");
    expect(body.html.toLowerCase()).toContain("<!doctype html>");
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/q3-abc123");
    expect(res.editUrl).toBeUndefined();
    expect(res.sharing).toBe("domain");
  });

  it("renders a doc's Markdown before wrapping", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await pub.publish({ type: "doc", title: "Notes", content: "# Hi\n\ntext" });
    const body = host.last().args[0] as { html: string };
    expect(body.html).toContain("<h1>Hi</h1>");
  });

  it("updates and returns the stable view URL", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.update("q3-abc123", "<h1>new</h1>");
    expect(host.last().m).toBe("update");
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/q3-abc123");
  });

  it("maps list/search to refs with composed view URLs", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    expect(await pub.list()).toEqual([
      { id: "a", title: "A", type: "page", viewUrl: "https://pagedrop.internal/p/a" },
    ]);
    expect((await pub.search("a"))[0].viewUrl).toBe("https://pagedrop.internal/p/a");
  });

  it("treats setSharing('domain') as a no-op and rejects public", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await expect(pub.setSharing("a", "domain")).resolves.toBeUndefined();
    await expect(pub.setSharing("a", "public")).rejects.toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/k8s/kubernetes-publisher.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/adapters/k8s/kubernetes-publisher.ts
import type { Artifact, ArtifactRef, ArtifactType, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import type { HostClient, RemoteItem } from "./host-client";

export interface KubernetesPublisherConfig {
  baseUrl: string;
}

export class KubernetesPublisher implements Publisher {
  constructor(
    private readonly client: HostClient,
    private readonly config: KubernetesPublisherConfig,
  ) {}

  private viewUrl(id: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/p/${id}`;
  }

  private toHtml(type: ArtifactType, title: string, content: string): string {
    const inner = type === "doc" ? renderMarkdown(content) : content;
    return wrapHtmlDocument(inner, title);
  }

  async publish(artifact: Artifact, _scope: SharingScope = "domain"): Promise<PublishResult> {
    const html = this.toHtml(artifact.type, artifact.title, artifact.content);
    const { id } = await this.client.publish({
      type: artifact.type,
      title: artifact.title,
      html,
      tags: artifact.tags,
    });
    return { id, viewUrl: this.viewUrl(id), sharing: "domain" };
  }

  async update(id: string, content: string): Promise<PublishResult> {
    await this.client.update(id, { html: wrapHtmlDocument(content, "") });
    return { id, viewUrl: this.viewUrl(id) };
  }

  async list(): Promise<ArtifactRef[]> {
    return (await this.client.list()).items.map((i) => this.toRef(i));
  }

  async search(query: string): Promise<ArtifactRef[]> {
    return (await this.client.search(query)).items.map((i) => this.toRef(i));
  }

  async setSharing(_id: string, scope: SharingScope): Promise<void> {
    if (scope !== "domain") throw new Error(`sharing scope not supported by the k8s backend: ${scope}`);
    // no-op: viewing is uniformly SSO-gated org-wide.
  }

  private toRef(item: RemoteItem): ArtifactRef {
    return {
      id: item.id,
      title: item.title,
      type: (item.type as ArtifactType) ?? "page",
      viewUrl: this.viewUrl(item.id),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/k8s/kubernetes-publisher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/k8s/kubernetes-publisher.ts tests/adapters/k8s/kubernetes-publisher.test.ts
git commit -m "feat: KubernetesPublisher implementing the Publisher interface"
```

---

## Task 10: Wire the `kubernetes` backend into the factory

**Files:**
- Modify: `src/adapters/google/create-publisher.ts`
- Test: `tests/adapters/google/create-publisher.test.ts` (extend)

**Interfaces:**
- Consumes: `loadK8sConfigFromEnv` (Task 7), `HostClient` (Task 8), `KubernetesPublisher` (Task 9).

- [ ] **Step 1: Write the failing test (append)**

```ts
// tests/adapters/google/create-publisher.test.ts — append
import { KubernetesPublisher } from "../../../src/adapters/k8s/kubernetes-publisher";

function stubK8sEnv() {
  vi.stubEnv("PAGEDROP_K8S_API_URL", "https://api.internal/api");
  vi.stubEnv("PAGEDROP_K8S_BASE_URL", "https://pagedrop.internal");
  vi.stubEnv("PAGEDROP_K8S_TOKEN", "tok");
}

describe("createPublisher — kubernetes", () => {
  it("selects the Kubernetes backend for 'kubernetes'", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "kubernetes");
    stubK8sEnv();
    expect(createPublisher()).toBeInstanceOf(KubernetesPublisher);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/google/create-publisher.test.ts`
Expected: FAIL — unknown backend `kubernetes` throws.

- [ ] **Step 3: Implement the case**

Add imports at the top of `src/adapters/google/create-publisher.ts`:
```ts
import { KubernetesPublisher } from "../k8s/kubernetes-publisher";
import { HostClient } from "../k8s/host-client";
import { loadK8sConfigFromEnv } from "../k8s/config";
```

Update the `Backend` type:
```ts
export type Backend = "appsscript" | "gcp" | "kubernetes";
```

Add the case inside the `switch (backend)` block, before `default`:
```ts
    case "kubernetes": {
      const config = loadK8sConfigFromEnv();
      const client = new HostClient(config.apiUrl, config.token);
      return new KubernetesPublisher(client, { baseUrl: config.baseUrl });
    }
```

Update the error message in `default`:
```ts
    default:
      throw new Error(
        `Unknown PAGEDROP_BACKEND "${backend}"; valid values are "appsscript" (default), "gcp", or "kubernetes"`,
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/google/create-publisher.test.ts`
Expected: PASS (all cases, including the existing unknown-backend test whose regex still matches).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/create-publisher.ts tests/adapters/google/create-publisher.test.ts
git commit -m "feat: select the kubernetes backend via PAGEDROP_BACKEND"
```

---

## Task 11: Full-suite + typecheck gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass (existing + new host and k8s tests).

- [ ] **Step 3: Startup smoke — kubernetes backend selects without crashing**

Run:
```bash
PAGEDROP_BACKEND=kubernetes PAGEDROP_K8S_API_URL=https://api.internal/api \
  PAGEDROP_K8S_BASE_URL=https://pagedrop.internal PAGEDROP_K8S_TOKEN=tok \
  timeout --preserve-status 1.5 npx tsx src/index.ts </dev/null; echo "exit=$?"
```
Expected: no error output before the timeout (clean startup).

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git commit -am "fix: resolve typecheck/test issues for the k8s backend" || echo "nothing to commit"
```

---

## Task 12: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Dockerfile — PageDrop host service
FROM node:20-alpine

WORKDIR /app

# Install deps against the lockfile first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App source (no build step; run via tsx like the MCP server).
COPY tsconfig.json ./
COPY src ./src

# Non-root user + writable data dir.
RUN addgroup -S pagedrop && adduser -S pagedrop -G pagedrop \
    && mkdir -p /data && chown pagedrop:pagedrop /data
USER pagedrop

ENV PAGEDROP_HOST_DATA_DIR=/data \
    PAGEDROP_HOST_VIEW_PORT=8080 \
    PAGEDROP_HOST_API_PORT=8081
EXPOSE 8080 8081
VOLUME ["/data"]

CMD ["npx", "tsx", "src/host/main.ts"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
tests
docs
deploy
.git
*.md
```

- [ ] **Step 3: Verify the image builds and serves health (if Docker is available)**

Run:
```bash
docker build -t pagedrop-host:dev . \
  && docker run -d --name pagedrop-smoke -e PAGEDROP_HOST_TOKEN=smoke -p 18080:8080 -p 18081:8081 pagedrop-host:dev \
  && sleep 3 && curl -sf http://127.0.0.1:18080/healthz && echo " OK" \
  ; docker rm -f pagedrop-smoke
```
Expected: `{"status":"ok"} OK`. If Docker is unavailable in this environment, note that and defer this smoke to the operator (documented in the chart README).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: Dockerfile for the PageDrop host service"
```

---

## Task 13: Helm chart

**Files:**
- Create: `deploy/helm/pagedrop-host/Chart.yaml`
- Create: `deploy/helm/pagedrop-host/values.yaml`
- Create: `deploy/helm/pagedrop-host/templates/_helpers.tpl`
- Create: `deploy/helm/pagedrop-host/templates/secret.yaml`
- Create: `deploy/helm/pagedrop-host/templates/pvc.yaml`
- Create: `deploy/helm/pagedrop-host/templates/deployment.yaml`
- Create: `deploy/helm/pagedrop-host/templates/service.yaml`
- Create: `deploy/helm/pagedrop-host/templates/ingress-view.yaml`
- Create: `deploy/helm/pagedrop-host/templates/ingress-api.yaml`
- Create: `deploy/helm/pagedrop-host/templates/networkpolicy.yaml`
- Create: `deploy/helm/pagedrop-host/README.md`

- [ ] **Step 1: `Chart.yaml`**

```yaml
apiVersion: v2
name: pagedrop-host
description: PageDrop Kubernetes static-host backend (viewing behind SSO + token-gated write API)
type: application
version: 0.1.0
appVersion: "0.1.0"
```

- [ ] **Step 2: `values.yaml`**

```yaml
image:
  repository: pagedrop-host
  tag: "0.1.0"
  pullPolicy: IfNotPresent

# Write-API bearer token. Either set `value` (chart creates a Secret) or point
# `existingSecret`/`existingSecretKey` at a Secret you manage.
token:
  value: ""
  existingSecret: ""
  existingSecretKey: token

storage:
  size: 1Gi
  # storageClassName: ""   # uncomment to pin a class; PVC is ReadWriteOnce.

resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 250m
    memory: 128Mi

# Viewing ingress — PLACE THIS BEHIND YOUR SSO PROXY via annotations.
viewIngress:
  enabled: true
  className: ""
  host: pagedrop.internal.example.com
  annotations: {}   # <-- inject your SSO proxy (oauth2-proxy/Pomerium/etc.) annotations here
  tls: []

# API ingress — token-gated; the MCP server reaches it.
# WARNING: this bypasses the SSO proxy. It MUST be internal-only. Prefer
# leaving it disabled and reaching the Service in-cluster, or restrict it with
# the NetworkPolicy below and an internal load balancer.
apiIngress:
  enabled: false
  className: ""
  host: pagedrop-api.internal.example.com
  annotations: {}
  tls: []

# NetworkPolicy restricting who can reach the write-API port (8081).
networkPolicy:
  enabled: true
  # CIDRs allowed to reach the API port (e.g. your MCP host / VPN range).
  allowedCIDRs: []
  # Pod selectors (namespace-local) allowed to reach the API port.
  allowedPodSelectors: []
```

- [ ] **Step 3: `templates/_helpers.tpl`**

```yaml
{{- define "pagedrop-host.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pagedrop-host.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "pagedrop-host.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pagedrop-host.labels" -}}
app.kubernetes.io/name: {{ include "pagedrop-host.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "pagedrop-host.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pagedrop-host.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "pagedrop-host.secretName" -}}
{{- if .Values.token.existingSecret -}}{{ .Values.token.existingSecret }}{{- else -}}{{ include "pagedrop-host.fullname" . }}{{- end -}}
{{- end -}}

{{- define "pagedrop-host.secretKey" -}}
{{- default "token" .Values.token.existingSecretKey -}}
{{- end -}}
```

- [ ] **Step 4: `templates/secret.yaml`**

```yaml
{{- if not .Values.token.existingSecret }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "pagedrop-host.fullname" . }}
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
type: Opaque
stringData:
  {{ include "pagedrop-host.secretKey" . }}: {{ required "token.value is required unless token.existingSecret is set" .Values.token.value | quote }}
{{- end }}
```

- [ ] **Step 5: `templates/pvc.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "pagedrop-host.fullname" . }}-data
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: {{ .Values.storage.size }}
  {{- with .Values.storage.storageClassName }}
  storageClassName: {{ . }}
  {{- end }}
```

- [ ] **Step 6: `templates/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "pagedrop-host.fullname" . }}
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "pagedrop-host.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "pagedrop-host.selectorLabels" . | nindent 8 }}
    spec:
      securityContext:
        fsGroup: 1000
      containers:
        - name: host
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: view
              containerPort: 8080
            - name: api
              containerPort: 8081
          env:
            - name: PAGEDROP_HOST_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{ include "pagedrop-host.secretName" . }}
                  key: {{ include "pagedrop-host.secretKey" . }}
            - name: PAGEDROP_HOST_DATA_DIR
              value: /data
          livenessProbe:
            httpGet:
              path: /healthz
              port: view
          readinessProbe:
            httpGet:
              path: /readyz
              port: view
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "pagedrop-host.fullname" . }}-data
```

- [ ] **Step 7: `templates/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "pagedrop-host.fullname" . }}
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "pagedrop-host.selectorLabels" . | nindent 4 }}
  ports:
    - name: view
      port: 8080
      targetPort: view
    - name: api
      port: 8081
      targetPort: api
```

- [ ] **Step 8: `templates/ingress-view.yaml`**

```yaml
{{- if .Values.viewIngress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "pagedrop-host.fullname" . }}-view
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
  annotations:
    {{- toYaml .Values.viewIngress.annotations | nindent 4 }}
spec:
  {{- with .Values.viewIngress.className }}
  ingressClassName: {{ . }}
  {{- end }}
  rules:
    - host: {{ .Values.viewIngress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "pagedrop-host.fullname" . }}
                port:
                  name: view
  {{- with .Values.viewIngress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

- [ ] **Step 9: `templates/ingress-api.yaml`**

```yaml
{{- if .Values.apiIngress.enabled }}
# WARNING: this ingress exposes the token-gated write API and bypasses the SSO
# proxy. Ensure it is internal-only (private load balancer / restricted CIDRs).
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "pagedrop-host.fullname" . }}-api
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
  annotations:
    {{- toYaml .Values.apiIngress.annotations | nindent 4 }}
spec:
  {{- with .Values.apiIngress.className }}
  ingressClassName: {{ . }}
  {{- end }}
  rules:
    - host: {{ .Values.apiIngress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "pagedrop-host.fullname" . }}
                port:
                  name: api
  {{- with .Values.apiIngress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

- [ ] **Step 10: `templates/networkpolicy.yaml`**

```yaml
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "pagedrop-host.fullname" . }}-api
  labels:
    {{- include "pagedrop-host.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "pagedrop-host.selectorLabels" . | nindent 6 }}
  policyTypes: ["Ingress"]
  ingress:
    # Viewing port is open (SSO proxy fronts it).
    - ports:
        - port: 8080
    # Write-API port restricted to explicit sources.
    - ports:
        - port: 8081
      from:
        {{- range .Values.networkPolicy.allowedCIDRs }}
        - ipBlock:
            cidr: {{ . }}
        {{- end }}
        {{- range .Values.networkPolicy.allowedPodSelectors }}
        - podSelector:
            matchLabels:
              {{- toYaml . | nindent 14 }}
        {{- end }}
{{- end }}
```

- [ ] **Step 11: `deploy/helm/pagedrop-host/README.md`**

```markdown
# pagedrop-host Helm chart

Deploys the PageDrop Kubernetes static-host backend: a single pod serving
rendered artifacts on a viewing port (`:8080`, place behind your SSO proxy) and
a token-gated write API (`:8081`, reached by the PageDrop MCP server).

## Install

```
helm install pagedrop deploy/helm/pagedrop-host \
  --set image.repository=<your-registry>/pagedrop-host \
  --set image.tag=0.1.0 \
  --set token.value=$(openssl rand -hex 32) \
  --set viewIngress.host=pagedrop.internal.example.com
```

Set the same token as `PAGEDROP_K8S_TOKEN` in the MCP server's environment
(`PAGEDROP_BACKEND=kubernetes`, `PAGEDROP_K8S_API_URL`, `PAGEDROP_K8S_BASE_URL`).

## Putting viewing behind SSO (worked example: oauth2-proxy)

Inject your proxy's annotations onto the viewing ingress only:

```
--set-json 'viewIngress.annotations={"nginx.ingress.kubernetes.io/auth-url":"https://oauth2-proxy.internal/oauth2/auth","nginx.ingress.kubernetes.io/auth-signin":"https://oauth2-proxy.internal/oauth2/start?rd=$escaped_request_uri"}'
```

The API ingress must NOT carry these annotations — the headless MCP server
cannot complete interactive SSO. Keep `apiIngress.enabled=false` and reach the
Service in-cluster when possible, or restrict it via `networkPolicy.allowedCIDRs`
and a private load balancer.

## Token rotation

1. Update the Secret: `helm upgrade ... --set token.value=<new>` (or edit the
   referenced `existingSecret`).
2. Update every MCP client's `PAGEDROP_K8S_TOKEN` to the new value.

Because there is a single shared token, rotate both sides close together;
requests with the old token return `401` after the pod restarts.

## Constraints

- Single writer: the PVC is `ReadWriteOnce` and the Deployment runs one replica
  (`Recreate` strategy). Not horizontally scalable without a `ReadWriteMany`
  volume or a database.
- `list`/`search` scan the data dir; suitable for hundreds–low-thousands of
  artifacts.
```

- [ ] **Step 12: Verify the chart lints and renders**

Run:
```bash
helm lint deploy/helm/pagedrop-host --set token.value=x
helm template pagedrop deploy/helm/pagedrop-host --set token.value=x | head -60
```
Expected: `helm lint` reports 0 failures; `helm template` renders valid YAML (Deployment with `replicas: 1`, `strategy: Recreate`, both ports, probes; NetworkPolicy present). If `helm` is not installed in this environment, note it and defer verification to the operator.

- [ ] **Step 13: Commit**

```bash
git add deploy/helm/pagedrop-host
git commit -m "build: Helm chart for the PageDrop host service"
```

---

## Task 14: Documentation

**Files:**
- Modify: `README.md` (add backend Option C)
- Modify: `AGENTS.md` (module map + factory note)
- Modify: `.mcp.json.example` (note the kubernetes env set — via README, since JSON has no comments)

- [ ] **Step 1: README — add the backend to the Backends section**

In `README.md`, under `## Backends`, add a third bullet after the `gcp` bullet:
```markdown
- **`kubernetes`** — publishes to a self-hosted PageDrop host service on your
  Kubernetes cluster; viewing sits behind your SSO proxy. Best HTML/CSS/JS
  fidelity and clean internal URLs; no native Docs/Slides copies or Drive
  search. See [`deploy/helm/pagedrop-host/README.md`](deploy/helm/pagedrop-host/README.md).
```

- [ ] **Step 2: README — add manual-setup Option C**

In `README.md`, after the GCP "Option B" block and before "Connect it to Claude", add:
```markdown
### Option C — Kubernetes (self-hosted static host)

1. **Deploy the host service.** Build the image from the repo `Dockerfile`,
   push it to your registry, and install the Helm chart
   ([`deploy/helm/pagedrop-host`](deploy/helm/pagedrop-host)). Place the viewing
   ingress behind your SSO proxy; keep the write API internal-only.
2. **Configure the environment.** Copy `.mcp.json.example` to `.mcp.json` and set:
   - `PAGEDROP_BACKEND=kubernetes`
   - `PAGEDROP_K8S_API_URL` — the write-API base URL (ends in `/api`)
   - `PAGEDROP_K8S_BASE_URL` — the public viewing base URL (used to build `/p/<id>` links)
   - `PAGEDROP_K8S_TOKEN` — the same token you set on the host service
```

- [ ] **Step 3: AGENTS.md — extend the module map**

In `AGENTS.md`, under the adapters listing, add:
```markdown
src/adapters/k8s/     the Kubernetes static-host adapter (kubernetes backend)
  kubernetes-publisher.ts KubernetesPublisher implements Publisher
  host-client.ts          HTTP transport to the host service write API
  config.ts               loadK8sConfigFromEnv
src/host/             the deployable host service (PVC store + two-port server)
  storage.ts server.ts config.ts main.ts
```
And update the `create-publisher.ts` line to note three backends: `"appsscript" default | "gcp" | "kubernetes"`.

- [ ] **Step 4: Verify docs reference real paths**

Run: `ls deploy/helm/pagedrop-host/README.md src/host/main.ts && npx tsc --noEmit`
Expected: paths exist; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md .mcp.json.example
git commit -m "docs: document the kubernetes backend (README, AGENTS)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm test` — all suites green.
- [ ] `git log --oneline` — one focused commit per task.
- [ ] Open a PR stacked on `feat/configurable-backend` (or retarget to `main` once PR #3 merges).

---

## Self-review notes (author)

- **Spec coverage:** host service (Tasks 1–6), adapter (7–9), wiring (10), Docker (12), Helm incl. NetworkPolicy + probes + Recreate/RWO (13), docs (14). Security-model items map to concrete code: exclusive-create+retry (Task 2), atomic writes/orphan skip (Tasks 2–3), 404-on-update (Tasks 2,5), timingSafeEqual (Task 5), index escaping (Tasks 4,6), `/readyz` (Tasks 5–6), NetworkPolicy + internal-only warning + rotation docs (Task 13).
- **Deferred (spec non-goals), intentionally not tasked:** index.json/pagination, Prometheus, rate-limiting, delete/unpublish, HA replicas, per-artifact ACLs.
- **Type consistency:** `Storage`, `HostClient`, `K8sConfig`, `RemoteItem`, `KubernetesPublisher(client, {baseUrl})` signatures are used identically across producing and consuming tasks.
