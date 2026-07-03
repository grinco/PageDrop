# PageDrop POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a TypeScript MCP server that lets a user ask Claude to publish a Markdown doc, HTML page, or HTML deck to Google Workspace and get shareable links, with a companion Apps Script renderer that serves stored HTML as real pages.

**Architecture:** A backend-neutral publishing core (`Publisher` interface + `PublishService`) delegates to a `GoogleAdapter` that talks to Google Drive/Slides through thin, mockable client interfaces. HTML pages/decks are stored as blobs in a Drive folder and served as rendered pages by a deployed Apps Script web app; Markdown becomes a native Google Doc. The MCP server exposes publish/list/search tools consumed by both claude.ai and Claude Code.

**Tech Stack:** Node 20+, TypeScript (ESM), `@modelcontextprotocol/sdk`, `googleapis`, `google-auth-library`, `marked`, `zod`; Vitest for tests; `tsx` to run without a build step; Google Apps Script (`.gs`) for the renderer.

## Global Constraints

- Node.js 20 or newer; ESM modules (`"type": "module"` in package.json).
- Run via `tsx` (no compile step for the POC); `tsc --noEmit` must pass for typechecking.
- TDD: every code module is introduced test-first with Vitest.
- Google API access in unit tests is always through fake client implementations — no test may make a network call.
- Default sharing scope is `domain` ("anyone in the org with the link").
- The artifact `id` returned to callers is always the primary Drive file id.
- No secrets in the repo; Google auth is configured via environment variables only.

---

## File Structure

```
package.json                              # deps, scripts, ESM
tsconfig.json                             # bundler resolution, strict
vitest.config.ts                          # test include globs
src/
  core/
    types.ts                              # Artifact, PublishResult, ArtifactRef, SharingScope, Publisher
    markdown.ts                           # renderMarkdown(md) -> html
    html.ts                               # wrapHtmlDocument(inner, title) -> full-page html (idempotent)
    publish-service.ts                    # PublishService: validation + delegation to a Publisher
  adapters/google/
    drive-client.ts                       # DriveClient interface + DriveFile/UploadOptions types
    slides-client.ts                      # SlidesClient interface
    google-adapter.ts                     # GoogleAdapter implements Publisher
    google-drive-client.ts                # GoogleDriveClient: real googleapis Drive impl
    google-slides-client.ts               # GoogleSlidesClient: real googleapis Slides impl
    config.ts                             # GoogleConfig + loadGoogleConfigFromEnv()
  mcp/
    tools.ts                              # registerTools(server, service)
  index.ts                                # MCP server entrypoint (stdio); wires real clients
tests/
  fakes/
    fake-drive-client.ts                  # in-memory DriveClient for tests
    fake-slides-client.ts                 # in-memory SlidesClient for tests
    fake-publisher.ts                     # in-memory Publisher for PublishService tests
  core/
    markdown.test.ts
    html.test.ts
    publish-service.test.ts
  adapters/google/
    google-adapter.test.ts
  mcp/
    tools.test.ts
apps-script/
  renderer.gs                             # doGet renderer web app
  DEPLOY.md                               # one-time deploy + config instructions
README wiring in docs/lld (this plan) + apps-script/DEPLOY.md
```

---

### Task 1: Project scaffold + core types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ArtifactType = 'doc' | 'page' | 'deck'`
  - `type SharingScope = 'domain' | 'people' | 'public'`
  - `interface Artifact { type: ArtifactType; title: string; content: string; tags?: string[]; author?: string }`
  - `interface PublishResult { id: string; viewUrl?: string; editUrl?: string }`
  - `interface ArtifactRef { id: string; title: string; type: ArtifactType; viewUrl?: string; editUrl?: string; tags?: string[] }`
  - `interface Publisher { publish(a: Artifact, scope?: SharingScope): Promise<PublishResult>; update(id: string, content: string): Promise<PublishResult>; list(): Promise<ArtifactRef[]>; search(query: string): Promise<ArtifactRef[]>; setSharing(id: string, scope: SharingScope): Promise<void> }`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pagedrop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "pagedrop": "src/index.ts" },
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "google-auth-library": "^9.0.0",
    "googleapis": "^144.0.0",
    "marked": "^12.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no error. (`node_modules` is already gitignored.)

- [ ] **Step 5: Write the failing test for core types**

Create `tests/core/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Artifact, PublishResult, Publisher } from "../../src/core/types";

describe("core types", () => {
  it("shapes an Artifact and PublishResult", () => {
    const a: Artifact = { type: "doc", title: "T", content: "# Hi" };
    const r: PublishResult = { id: "file-1", editUrl: "https://x" };
    expect(a.type).toBe("doc");
    expect(r.id).toBe("file-1");
  });

  it("allows a Publisher implementation to satisfy the interface", () => {
    const p: Publisher = {
      publish: async () => ({ id: "file-1" }),
      update: async () => ({ id: "file-1" }),
      list: async () => [],
      search: async () => [],
      setSharing: async () => {},
    };
    expect(typeof p.publish).toBe("function");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../../src/core/types`.

- [ ] **Step 7: Create `src/core/types.ts`**

```ts
export type ArtifactType = "doc" | "page" | "deck";
export type SharingScope = "domain" | "people" | "public";

export interface Artifact {
  type: ArtifactType;
  title: string;
  content: string; // Markdown for 'doc'; HTML for 'page'/'deck'
  tags?: string[];
  author?: string;
}

export interface PublishResult {
  id: string;
  viewUrl?: string;
  editUrl?: string;
}

export interface ArtifactRef {
  id: string;
  title: string;
  type: ArtifactType;
  viewUrl?: string;
  editUrl?: string;
  tags?: string[];
}

export interface Publisher {
  publish(artifact: Artifact, scope?: SharingScope): Promise<PublishResult>;
  update(id: string, content: string): Promise<PublishResult>;
  list(): Promise<ArtifactRef[]>;
  search(query: string): Promise<ArtifactRef[]>;
  setSharing(id: string, scope: SharingScope): Promise<void>;
}
```

- [ ] **Step 8: Run test + typecheck to verify pass**

Run: `npm test && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/core/types.ts tests/core/types.test.ts
git commit -m "feat: scaffold PageDrop MCP server + core types"
```

---

### Task 2: Content rendering (markdown + HTML wrapping)

**Files:**
- Create: `src/core/markdown.ts`, `src/core/html.ts`
- Test: `tests/core/markdown.test.ts`, `tests/core/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `renderMarkdown(md: string): string` — returns an HTML fragment.
  - `wrapHtmlDocument(inner: string, title: string): string` — returns a full HTML document; **idempotent**: if `inner` already contains `<html` or `<!doctype`, it is returned unchanged.

- [ ] **Step 1: Write the failing test for `renderMarkdown`**

Create `tests/core/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/core/markdown";

describe("renderMarkdown", () => {
  it("converts a heading and paragraph to HTML", () => {
    const html = renderMarkdown("# Title\n\nHello **world**");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- markdown`
Expected: FAIL — cannot find module `../../src/core/markdown`.

- [ ] **Step 3: Implement `src/core/markdown.ts`**

```ts
import { marked } from "marked";

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- markdown`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `wrapHtmlDocument`**

Create `tests/core/html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wrapHtmlDocument } from "../../src/core/html";

describe("wrapHtmlDocument", () => {
  it("wraps a fragment into a full HTML document with the title", () => {
    const out = wrapHtmlDocument("<h1>Hi</h1>", "My Report");
    expect(out.toLowerCase()).toContain("<!doctype html>");
    expect(out).toContain("<title>My Report</title>");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("is idempotent when given a full document", () => {
    const full = "<!DOCTYPE html><html><head></head><body>x</body></html>";
    expect(wrapHtmlDocument(full, "ignored")).toBe(full);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- html`
Expected: FAIL — cannot find module `../../src/core/html`.

- [ ] **Step 7: Implement `src/core/html.ts`**

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function wrapHtmlDocument(inner: string, title: string): string {
  if (/<!doctype html|<html[\s>]/i.test(inner)) {
    return inner;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  img { max-width: 100%; }
  pre { overflow-x: auto; background: #f6f8fa; padding: 1rem; border-radius: 6px; }
</style>
</head>
<body>
${inner}
</body>
</html>`;
}
```

- [ ] **Step 8: Run tests to verify pass**

Run: `npm test -- html markdown`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/markdown.ts src/core/html.ts tests/core/markdown.test.ts tests/core/html.test.ts
git commit -m "feat: markdown rendering and idempotent HTML document wrapping"
```

---

### Task 3: PublishService (validation + delegation)

**Files:**
- Create: `src/core/publish-service.ts`
- Create: `tests/fakes/fake-publisher.ts`
- Test: `tests/core/publish-service.test.ts`

**Interfaces:**
- Consumes: `Publisher`, `Artifact`, `PublishResult`, `ArtifactRef` from `src/core/types`.
- Produces:
  - `class PublishService` constructed with `(publisher: Publisher)`.
  - `publishDoc(title: string, markdown: string, tags?: string[]): Promise<PublishResult>`
  - `publishPage(title: string, html: string, tags?: string[]): Promise<PublishResult>`
  - `publishDeck(title: string, html: string, tags?: string[]): Promise<PublishResult>`
  - `republish(id: string, content: string): Promise<PublishResult>`
  - `list(): Promise<ArtifactRef[]>`
  - `search(query: string): Promise<ArtifactRef[]>`

- [ ] **Step 1: Create the fake Publisher test double**

Create `tests/fakes/fake-publisher.ts`:

```ts
import type { Artifact, ArtifactRef, Publisher, PublishResult, SharingScope } from "../../src/core/types";

export class FakePublisher implements Publisher {
  public published: { artifact: Artifact; scope: SharingScope }[] = [];
  public updated: { id: string; content: string }[] = [];
  private seq = 0;

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    this.seq += 1;
    this.published.push({ artifact, scope });
    return { id: `file-${this.seq}`, viewUrl: "https://view", editUrl: "https://edit" };
  }
  async update(id: string, content: string): Promise<PublishResult> {
    this.updated.push({ id, content });
    return { id, viewUrl: "https://view" };
  }
  async list(): Promise<ArtifactRef[]> {
    return [{ id: "file-1", title: "T", type: "doc" }];
  }
  async search(query: string): Promise<ArtifactRef[]> {
    return query === "hit" ? [{ id: "file-1", title: "T", type: "doc" }] : [];
  }
  async setSharing(): Promise<void> {}
}
```

- [ ] **Step 2: Write the failing tests for PublishService**

Create `tests/core/publish-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PublishService } from "../../src/core/publish-service";
import { FakePublisher } from "../fakes/fake-publisher";

describe("PublishService", () => {
  it("publishes a doc with the right artifact type and default domain scope", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    const res = await svc.publishDoc("Report", "# Hi", ["q3"]);
    expect(res.id).toBe("file-1");
    expect(fake.published[0].artifact.type).toBe("doc");
    expect(fake.published[0].artifact.tags).toEqual(["q3"]);
    expect(fake.published[0].scope).toBe("domain");
  });

  it("publishes page and deck with matching types", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    await svc.publishPage("P", "<h1>x</h1>");
    await svc.publishDeck("D", "<section>s</section>");
    expect(fake.published.map((p) => p.artifact.type)).toEqual(["page", "deck"]);
  });

  it("rejects empty title or content", async () => {
    const svc = new PublishService(new FakePublisher());
    await expect(svc.publishDoc("  ", "x")).rejects.toThrow(/title/i);
    await expect(svc.publishDoc("T", "  ")).rejects.toThrow(/content/i);
  });

  it("republishes by id", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    await svc.republish("file-9", "<h1>new</h1>");
    expect(fake.updated[0]).toEqual({ id: "file-9", content: "<h1>new</h1>" });
  });

  it("rejects empty search query", async () => {
    const svc = new PublishService(new FakePublisher());
    await expect(svc.search("  ")).rejects.toThrow(/query/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- publish-service`
Expected: FAIL — cannot find module `../../src/core/publish-service`.

- [ ] **Step 4: Implement `src/core/publish-service.ts`**

```ts
import type { ArtifactRef, ArtifactType, Publisher, PublishResult } from "./types";

export class PublishService {
  constructor(private readonly publisher: Publisher) {}

  private validate(title: string, content: string): void {
    if (!title.trim()) throw new Error("title is required");
    if (!content.trim()) throw new Error("content is required");
  }

  private publishOfType(
    type: ArtifactType,
    title: string,
    content: string,
    tags?: string[],
  ): Promise<PublishResult> {
    this.validate(title, content);
    return this.publisher.publish({ type, title, content, tags }, "domain");
  }

  publishDoc(title: string, markdown: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("doc", title, markdown, tags);
  }
  publishPage(title: string, html: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("page", title, html, tags);
  }
  publishDeck(title: string, html: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("deck", title, html, tags);
  }

  republish(id: string, content: string): Promise<PublishResult> {
    if (!id.trim()) throw new Error("id is required");
    if (!content.trim()) throw new Error("content is required");
    return this.publisher.update(id, content);
  }

  list(): Promise<ArtifactRef[]> {
    return this.publisher.list();
  }

  search(query: string): Promise<ArtifactRef[]> {
    if (!query.trim()) throw new Error("query is required");
    return this.publisher.search(query);
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- publish-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/publish-service.ts tests/fakes/fake-publisher.ts tests/core/publish-service.test.ts
git commit -m "feat: PublishService with validation and Publisher delegation"
```

---

### Task 4: Google client interfaces + in-memory fakes

**Files:**
- Create: `src/adapters/google/drive-client.ts`, `src/adapters/google/slides-client.ts`
- Create: `tests/fakes/fake-drive-client.ts`, `tests/fakes/fake-slides-client.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface DriveFile { id: string; name: string; mimeType: string; webViewLink: string }`
  - `interface UploadOptions { name: string; mimeType: string; content: string; parents: string[]; convertToGoogleDoc?: boolean }`
  - `interface DriveClient { ensureFolder(name: string): Promise<string>; uploadFile(opts: UploadOptions): Promise<DriveFile>; updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile>; getFile(id: string): Promise<DriveFile>; setDomainLinkSharing(id: string): Promise<void>; listFolder(folderId: string): Promise<DriveFile[]>; searchFolder(folderId: string, query: string): Promise<DriveFile[]> }`
  - `interface SlidesClient { createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }> }`
  - Test doubles `FakeDriveClient` (records `shared: Set<string>`) and `FakeSlidesClient`.
- Constant: the native Google Doc mime is `application/vnd.google-apps.document`.

- [ ] **Step 1: Create `src/adapters/google/drive-client.ts`**

```ts
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

export interface UploadOptions {
  name: string;
  mimeType: string;
  content: string;
  parents: string[];
  convertToGoogleDoc?: boolean;
}

export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  uploadFile(opts: UploadOptions): Promise<DriveFile>;
  updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile>;
  getFile(id: string): Promise<DriveFile>;
  setDomainLinkSharing(id: string): Promise<void>;
  listFolder(folderId: string): Promise<DriveFile[]>;
  searchFolder(folderId: string, query: string): Promise<DriveFile[]>;
}
```

- [ ] **Step 2: Create `src/adapters/google/slides-client.ts`**

```ts
export interface SlidesClient {
  createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }>;
}
```

- [ ] **Step 3: Create `tests/fakes/fake-drive-client.ts`**

```ts
import {
  GOOGLE_DOC_MIME,
  type DriveClient,
  type DriveFile,
  type UploadOptions,
} from "../../src/adapters/google/drive-client";

export class FakeDriveClient implements DriveClient {
  public shared = new Set<string>();
  private files = new Map<string, DriveFile & { content: string; parents: string[] }>();
  private seq = 0;

  async ensureFolder(name: string): Promise<string> {
    return `folder-${name}`;
  }

  async uploadFile(opts: UploadOptions): Promise<DriveFile> {
    this.seq += 1;
    const id = `file-${this.seq}`;
    const isDoc = opts.convertToGoogleDoc === true;
    const mimeType = isDoc ? GOOGLE_DOC_MIME : opts.mimeType;
    const webViewLink = isDoc
      ? `https://docs.google.com/document/d/${id}`
      : `https://drive.google.com/file/d/${id}`;
    const file = { id, name: opts.name, mimeType, webViewLink, content: opts.content, parents: opts.parents };
    this.files.set(id, file);
    return { id, name: file.name, mimeType, webViewLink };
  }

  async updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile> {
    const f = this.files.get(id);
    if (!f) throw new Error(`no such file: ${id}`);
    f.content = content;
    f.mimeType = mimeType;
    return { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink };
  }

  async getFile(id: string): Promise<DriveFile> {
    const f = this.files.get(id);
    if (!f) throw new Error(`no such file: ${id}`);
    return { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink };
  }

  async setDomainLinkSharing(id: string): Promise<void> {
    this.shared.add(id);
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    return [...this.files.values()]
      .filter((f) => f.parents.includes(folderId))
      .map(({ id, name, mimeType, webViewLink }) => ({ id, name, mimeType, webViewLink }));
  }

  async searchFolder(folderId: string, query: string): Promise<DriveFile[]> {
    const q = query.toLowerCase();
    return (await this.listFolder(folderId)).filter((f) => f.name.toLowerCase().includes(q));
  }
}
```

- [ ] **Step 4: Create `tests/fakes/fake-slides-client.ts`**

```ts
import type { SlidesClient } from "../../src/adapters/google/slides-client";

export class FakeSlidesClient implements SlidesClient {
  public created: { title: string; viewUrl: string }[] = [];
  public shouldFail = false;
  private seq = 0;

  async createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }> {
    if (this.shouldFail) throw new Error("slides api unavailable");
    this.seq += 1;
    this.created.push({ title, viewUrl });
    const id = `slides-${this.seq}`;
    return { id, webViewLink: `https://docs.google.com/presentation/d/${id}` };
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no test asserts yet; fakes exercised in Task 5+).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/google/drive-client.ts src/adapters/google/slides-client.ts tests/fakes/fake-drive-client.ts tests/fakes/fake-slides-client.ts
git commit -m "feat: Google client interfaces and in-memory fakes"
```

---

### Task 5: GoogleAdapter — doc path

**Files:**
- Create: `src/adapters/google/config.ts`
- Create: `src/adapters/google/google-adapter.ts`
- Test: `tests/adapters/google/google-adapter.test.ts`

**Interfaces:**
- Consumes: `DriveClient`, `SlidesClient`, `renderMarkdown`, `wrapHtmlDocument`, `Publisher`, `Artifact`, `PublishResult`, `GOOGLE_DOC_MIME`.
- Produces:
  - `interface GoogleConfig { folderName: string; rendererBaseUrl: string }`
  - `function buildViewUrl(base: string, fileId: string): string` — returns `${base}?id=${fileId}` (strips a trailing `?`/`&`).
  - `class GoogleAdapter implements Publisher`, constructed `(drive: DriveClient, config: GoogleConfig, slides?: SlidesClient)`.

- [ ] **Step 1: Create `src/adapters/google/config.ts`**

```ts
export interface GoogleConfig {
  folderName: string;
  rendererBaseUrl: string;
}

export function buildViewUrl(base: string, fileId: string): string {
  const trimmed = base.replace(/[?&]$/, "");
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}id=${encodeURIComponent(fileId)}`;
}
```

- [ ] **Step 2: Write the failing test for the doc path**

Create `tests/adapters/google/google-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GoogleAdapter } from "../../../src/adapters/google/google-adapter";
import { FakeDriveClient } from "../../fakes/fake-drive-client";

const config = { folderName: "PageDrop", rendererBaseUrl: "https://script.google.com/exec" };

describe("GoogleAdapter — doc", () => {
  it("publishes markdown as a native Google Doc and shares it", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const res = await adapter.publish({ type: "doc", title: "Q3 Report", content: "# Hi\n\ntext" });
    expect(res.id).toBe("file-1");
    expect(res.editUrl).toContain("docs.google.com/document");
    expect(res.viewUrl).toBeUndefined();
    expect(drive.shared.has("file-1")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- google-adapter`
Expected: FAIL — cannot find module `google-adapter`.

- [ ] **Step 4: Implement `src/adapters/google/google-adapter.ts` (doc path only)**

```ts
import type { Artifact, ArtifactRef, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import { GOOGLE_DOC_MIME, type DriveClient } from "./drive-client";
import type { SlidesClient } from "./slides-client";
import { buildViewUrl, type GoogleConfig } from "./config";

export class GoogleAdapter implements Publisher {
  private folderId?: string;

  constructor(
    private readonly drive: DriveClient,
    private readonly config: GoogleConfig,
    private readonly slides?: SlidesClient,
  ) {}

  private async folder(): Promise<string> {
    if (!this.folderId) this.folderId = await this.drive.ensureFolder(this.config.folderName);
    return this.folderId;
  }

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    const parent = await this.folder();
    if (artifact.type === "doc") {
      const html = wrapHtmlDocument(renderMarkdown(artifact.content), artifact.title);
      const file = await this.drive.uploadFile({
        name: artifact.title,
        mimeType: "text/html",
        content: html,
        parents: [parent],
        convertToGoogleDoc: true,
      });
      await this.applySharing(file.id, scope);
      return { id: file.id, editUrl: file.webViewLink };
    }
    throw new Error(`unsupported artifact type: ${artifact.type}`);
  }

  private async applySharing(id: string, scope: SharingScope): Promise<void> {
    if (scope === "domain") await this.drive.setDomainLinkSharing(id);
    else throw new Error(`sharing scope not supported in POC: ${scope}`);
  }

  // Implemented in later tasks:
  async update(_id: string, _content: string): Promise<PublishResult> {
    throw new Error("not implemented");
  }
  async list(): Promise<ArtifactRef[]> {
    throw new Error("not implemented");
  }
  async search(_query: string): Promise<ArtifactRef[]> {
    throw new Error("not implemented");
  }
  async setSharing(id: string, scope: SharingScope): Promise<void> {
    await this.applySharing(id, scope);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- google-adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/google/config.ts src/adapters/google/google-adapter.ts tests/adapters/google/google-adapter.test.ts
git commit -m "feat: GoogleAdapter doc path (markdown -> native Google Doc)"
```

---

### Task 6: GoogleAdapter — page path

**Files:**
- Modify: `src/adapters/google/google-adapter.ts` (extend `publish` for `page`)
- Modify: `tests/adapters/google/google-adapter.test.ts` (add page test)

**Interfaces:**
- Consumes: same as Task 5.
- Produces: `publish` handles `type: "page"` — stores wrapped HTML as a `text/html` blob (no conversion) and returns `{ id, viewUrl }` where `viewUrl = buildViewUrl(config.rendererBaseUrl, id)`.

- [ ] **Step 1: Add the failing page test**

Append to `tests/adapters/google/google-adapter.test.ts`:

```ts
describe("GoogleAdapter — page", () => {
  it("stores HTML as a blob and returns a renderer view URL", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const res = await adapter.publish({ type: "page", title: "Dashboard", content: "<h1>x</h1>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toBeUndefined();
    expect(drive.shared.has("file-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-adapter`
Expected: FAIL — `unsupported artifact type: page`.

- [ ] **Step 3: Extend `publish` in `google-adapter.ts`**

Replace the `throw new Error(\`unsupported artifact type: ${artifact.type}\`)` line with a `page` branch so the method body reads:

```ts
    if (artifact.type === "doc") {
      const html = wrapHtmlDocument(renderMarkdown(artifact.content), artifact.title);
      const file = await this.drive.uploadFile({
        name: artifact.title,
        mimeType: "text/html",
        content: html,
        parents: [parent],
        convertToGoogleDoc: true,
      });
      await this.applySharing(file.id, scope);
      return { id: file.id, editUrl: file.webViewLink };
    }

    if (artifact.type === "page") {
      const html = wrapHtmlDocument(artifact.content, artifact.title);
      const file = await this.drive.uploadFile({
        name: `${artifact.title}.html`,
        mimeType: "text/html",
        content: html,
        parents: [parent],
      });
      await this.applySharing(file.id, scope);
      return { id: file.id, viewUrl: buildViewUrl(this.config.rendererBaseUrl, file.id) };
    }

    throw new Error(`unsupported artifact type: ${artifact.type}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- google-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/google-adapter.ts tests/adapters/google/google-adapter.test.ts
git commit -m "feat: GoogleAdapter page path (HTML blob + renderer view URL)"
```

---

### Task 7: GoogleAdapter — deck path (+ best-effort native Slides)

**Files:**
- Modify: `src/adapters/google/google-adapter.ts` (extend `publish` for `deck`)
- Modify: `tests/adapters/google/google-adapter.test.ts` (add deck tests)

**Interfaces:**
- Consumes: same as Task 5, plus the optional `SlidesClient`.
- Produces: `publish` handles `type: "deck"` — stores wrapped HTML blob, returns `{ id, viewUrl }`; if a `SlidesClient` was provided, it also creates a native Slides deck and sets `editUrl` to its link. A Slides failure is swallowed (best-effort) and `editUrl` stays undefined.

- [ ] **Step 1: Add the failing deck tests**

Append to `tests/adapters/google/google-adapter.test.ts`:

```ts
import { FakeSlidesClient } from "../../fakes/fake-slides-client";

describe("GoogleAdapter — deck", () => {
  it("returns a view URL and, when Slides is configured, an edit URL", async () => {
    const drive = new FakeDriveClient();
    const slides = new FakeSlidesClient();
    const adapter = new GoogleAdapter(drive, config, slides);
    const res = await adapter.publish({ type: "deck", title: "Kickoff", content: "<section>1</section>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toContain("docs.google.com/presentation");
    expect(slides.created[0].viewUrl).toBe("https://script.google.com/exec?id=file-1");
  });

  it("still succeeds when Slides creation fails (best-effort)", async () => {
    const drive = new FakeDriveClient();
    const slides = new FakeSlidesClient();
    slides.shouldFail = true;
    const adapter = new GoogleAdapter(drive, config, slides);
    const res = await adapter.publish({ type: "deck", title: "Kickoff", content: "<section>1</section>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- google-adapter`
Expected: FAIL — `unsupported artifact type: deck`.

- [ ] **Step 3: Extend `publish` with a `deck` branch**

Insert this branch immediately before the final `throw` in `publish`:

```ts
    if (artifact.type === "deck") {
      const html = wrapHtmlDocument(artifact.content, artifact.title);
      const file = await this.drive.uploadFile({
        name: `${artifact.title}.html`,
        mimeType: "text/html",
        content: html,
        parents: [parent],
      });
      await this.applySharing(file.id, scope);
      const viewUrl = buildViewUrl(this.config.rendererBaseUrl, file.id);
      let editUrl: string | undefined;
      if (this.slides) {
        try {
          const deck = await this.slides.createDeck(artifact.title, viewUrl);
          editUrl = deck.webViewLink;
        } catch {
          editUrl = undefined; // best-effort; rendered deck is the deliverable
        }
      }
      return { id: file.id, viewUrl, editUrl };
    }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- google-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/google-adapter.ts tests/adapters/google/google-adapter.test.ts
git commit -m "feat: GoogleAdapter deck path with best-effort native Slides"
```

---

### Task 8: GoogleAdapter — list, search, update

**Files:**
- Modify: `src/adapters/google/google-adapter.ts` (implement `list`, `search`, `update`)
- Modify: `tests/adapters/google/google-adapter.test.ts` (add tests)

**Interfaces:**
- Consumes: same as Task 5, plus `GOOGLE_DOC_MIME`, `DriveFile`, `ArtifactRef`.
- Produces:
  - `list()` returns `ArtifactRef[]` for the PageDrop folder; a file with mime `GOOGLE_DOC_MIME` maps to `type: "doc"` with `editUrl = webViewLink`; any other file maps to `type: "page"` with `viewUrl = buildViewUrl(...)`.
  - `search(query)` = same mapping over `searchFolder`.
  - `update(id, content)` fetches the file; if its mime is `text/html`, replaces content with `wrapHtmlDocument(content, name)` and returns `{ id, viewUrl }`; otherwise throws `"republish supports HTML pages/decks only in the POC"`.

- [ ] **Step 1: Add failing tests for list/search/update**

Append to `tests/adapters/google/google-adapter.test.ts`:

```ts
describe("GoogleAdapter — list/search/update", () => {
  it("lists published artifacts with derived types", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    await adapter.publish({ type: "doc", title: "Doc A", content: "# a" });
    await adapter.publish({ type: "page", title: "Page B", content: "<h1>b</h1>" });
    const refs = await adapter.list();
    const types = refs.map((r) => r.type).sort();
    expect(types).toEqual(["doc", "page"]);
    const doc = refs.find((r) => r.type === "doc")!;
    expect(doc.editUrl).toContain("docs.google.com/document");
    const page = refs.find((r) => r.type === "page")!;
    expect(page.viewUrl).toContain("script.google.com/exec?id=");
  });

  it("searches by title substring", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    await adapter.publish({ type: "page", title: "Budget Dashboard", content: "<h1>x</h1>" });
    await adapter.publish({ type: "page", title: "Roadmap", content: "<h1>y</h1>" });
    const hits = await adapter.search("budget");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toContain("Budget");
  });

  it("updates an HTML page and returns its view URL", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const pub = await adapter.publish({ type: "page", title: "P", content: "<h1>old</h1>" });
    const res = await adapter.update(pub.id, "<h1>new</h1>");
    expect(res.viewUrl).toBe(`https://script.google.com/exec?id=${pub.id}`);
  });

  it("refuses to update a native Doc in the POC", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const pub = await adapter.publish({ type: "doc", title: "D", content: "# x" });
    await expect(adapter.update(pub.id, "# y")).rejects.toThrow(/HTML pages\/decks only/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- google-adapter`
Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implement `list`, `search`, `update` and a private mapper**

Replace the three `throw new Error("not implemented")` method bodies with:

```ts
  async update(id: string, content: string): Promise<PublishResult> {
    const file = await this.drive.getFile(id);
    if (file.mimeType !== "text/html") {
      throw new Error("republish supports HTML pages/decks only in the POC");
    }
    await this.drive.updateFileContent(id, wrapHtmlDocument(content, file.name), "text/html");
    return { id, viewUrl: buildViewUrl(this.config.rendererBaseUrl, id) };
  }

  async list(): Promise<ArtifactRef[]> {
    const parent = await this.folder();
    return (await this.drive.listFolder(parent)).map((f) => this.toRef(f));
  }

  async search(query: string): Promise<ArtifactRef[]> {
    const parent = await this.folder();
    return (await this.drive.searchFolder(parent, query)).map((f) => this.toRef(f));
  }
```

Then add this private method to the class and import `DriveFile`:

```ts
  private toRef(f: DriveFile): ArtifactRef {
    if (f.mimeType === GOOGLE_DOC_MIME) {
      return { id: f.id, title: f.name, type: "doc", editUrl: f.webViewLink };
    }
    return {
      id: f.id,
      title: f.name.replace(/\.html$/i, ""),
      type: "page",
      viewUrl: buildViewUrl(this.config.rendererBaseUrl, f.id),
    };
  }
```

Update the import line for `drive-client` to include `DriveFile`:

```ts
import { GOOGLE_DOC_MIME, type DriveClient, type DriveFile } from "./drive-client";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- google-adapter && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/google-adapter.ts tests/adapters/google/google-adapter.test.ts
git commit -m "feat: GoogleAdapter list, search, and HTML republish"
```

---

### Task 9: Real Google clients + config from env

**Files:**
- Create: `src/adapters/google/google-drive-client.ts`
- Create: `src/adapters/google/google-slides-client.ts`
- Modify: `src/adapters/google/config.ts` (add `loadGoogleConfigFromEnv`)

**Interfaces:**
- Consumes: `googleapis`, `google-auth-library`, `DriveClient`, `SlidesClient`, `DriveFile`, `UploadOptions`, `GOOGLE_DOC_MIME`, `GoogleConfig`.
- Produces:
  - `function createOAuthClient(): OAuth2Client` — builds an authorized client from env (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`).
  - `class GoogleDriveClient implements DriveClient` constructed `(auth: OAuth2Client)`.
  - `class GoogleSlidesClient implements SlidesClient` constructed `(auth: OAuth2Client)`.
  - `function loadGoogleConfigFromEnv(): GoogleConfig` — reads `PAGEDROP_FOLDER_NAME` (default `"PageDrop"`) and `PAGEDROP_RENDERER_URL` (required).

> **Note on testing:** these wrappers are the single real-network boundary. They are covered by `typecheck` plus a manual smoke test against a real Google account (Task 11 setup doc), not by unit tests — mocking the full googleapis surface would test the mock, not the integration.

- [ ] **Step 1: Add `loadGoogleConfigFromEnv` to `config.ts`**

Append to `src/adapters/google/config.ts`:

```ts
export function loadGoogleConfigFromEnv(): GoogleConfig {
  const rendererBaseUrl = process.env.PAGEDROP_RENDERER_URL;
  if (!rendererBaseUrl) {
    throw new Error("PAGEDROP_RENDERER_URL is required (the deployed Apps Script web app URL)");
  }
  return {
    folderName: process.env.PAGEDROP_FOLDER_NAME ?? "PageDrop",
    rendererBaseUrl,
  };
}
```

- [ ] **Step 2: Create `src/adapters/google/google-drive-client.ts`**

```ts
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Readable } from "node:stream";
import {
  GOOGLE_DOC_MIME,
  type DriveClient,
  type DriveFile,
  type UploadOptions,
} from "./drive-client";

const FIELDS = "id, name, mimeType, webViewLink";

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    webViewLink: f.webViewLink ?? "",
  };
}

export class GoogleDriveClient implements DriveClient {
  private readonly drive: drive_v3.Drive;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
  }

  async ensureFolder(name: string): Promise<string> {
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await this.drive.files.list({ q, fields: "files(id)", pageSize: 1 });
    const existing = found.data.files?.[0]?.id;
    if (existing) return existing;
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
    });
    if (!created.data.id) throw new Error("failed to create PageDrop folder");
    return created.data.id;
  }

  async uploadFile(opts: UploadOptions): Promise<DriveFile> {
    const res = await this.drive.files.create({
      requestBody: {
        name: opts.name,
        parents: opts.parents,
        ...(opts.convertToGoogleDoc ? { mimeType: GOOGLE_DOC_MIME } : {}),
      },
      media: { mimeType: opts.mimeType, body: Readable.from([opts.content]) },
      fields: FIELDS,
    });
    return toDriveFile(res.data);
  }

  async updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile> {
    const res = await this.drive.files.update({
      fileId: id,
      media: { mimeType, body: Readable.from([content]) },
      fields: FIELDS,
    });
    return toDriveFile(res.data);
  }

  async getFile(id: string): Promise<DriveFile> {
    const res = await this.drive.files.get({ fileId: id, fields: FIELDS });
    return toDriveFile(res.data);
  }

  async setDomainLinkSharing(id: string): Promise<void> {
    const domain = process.env.PAGEDROP_DOMAIN;
    await this.drive.permissions.create({
      fileId: id,
      requestBody: domain
        ? { type: "domain", role: "reader", domain, allowFileDiscovery: false }
        : { type: "anyone", role: "reader", allowFileDiscovery: false },
    });
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: `files(${FIELDS})`,
      pageSize: 100,
    });
    return (res.data.files ?? []).map(toDriveFile);
  }

  async searchFolder(folderId: string, query: string): Promise<DriveFile[]> {
    const escaped = query.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false and (name contains '${escaped}' or fullText contains '${escaped}')`,
      fields: `files(${FIELDS})`,
      pageSize: 100,
    });
    return (res.data.files ?? []).map(toDriveFile);
  }
}
```

- [ ] **Step 3: Create `src/adapters/google/google-slides-client.ts`**

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { SlidesClient } from "./slides-client";

export class GoogleSlidesClient implements SlidesClient {
  private readonly auth: OAuth2Client;

  constructor(auth: OAuth2Client) {
    this.auth = auth;
  }

  async createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }> {
    const slides = google.slides({ version: "v1", auth: this.auth });
    const created = await slides.presentations.create({ requestBody: { title } });
    const id = created.data.presentationId;
    if (!id) throw new Error("failed to create presentation");

    const firstSlideId = created.data.slides?.[0]?.objectId;
    if (firstSlideId) {
      await slides.presentations.batchUpdate({
        presentationId: id,
        requestBody: {
          requests: [
            {
              createShape: {
                objectId: `note-${id}`,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: firstSlideId,
                  size: { width: { magnitude: 6000000, unit: "EMU" }, height: { magnitude: 800000, unit: "EMU" } },
                  transform: { scaleX: 1, scaleY: 1, translateX: 600000, translateY: 600000, unit: "EMU" },
                },
              },
            },
            {
              insertText: {
                objectId: `note-${id}`,
                text: `${title}\nRendered deck: ${viewUrl}`,
              },
            },
          ],
        },
      });
    }
    return { id, webViewLink: `https://docs.google.com/presentation/d/${id}` };
  }
}
```

- [ ] **Step 4: Add `createOAuthClient` to `config.ts`**

Append to `src/adapters/google/config.ts`:

```ts
import { OAuth2Client } from "google-auth-library";

export function createOAuthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
    );
  }
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return client;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/google/google-drive-client.ts src/adapters/google/google-slides-client.ts src/adapters/google/config.ts
git commit -m "feat: real googleapis Drive/Slides clients and env config"
```

---

### Task 10: MCP server + tool registration

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/index.ts`
- Test: `tests/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `PublishService`, `McpServer` (SDK), `zod`, `GoogleAdapter`, `GoogleDriveClient`, `GoogleSlidesClient`, `createOAuthClient`, `loadGoogleConfigFromEnv`.
- Produces:
  - `interface ToolHost { tool(name: string, description: string, schema: Record<string, unknown>, handler: (args: any) => Promise<{ content: { type: "text"; text: string }[] }>): void }`
  - `function registerTools(host: ToolHost, service: PublishService): void` — registers `pagedrop_publish_doc`, `pagedrop_publish_page`, `pagedrop_publish_deck`, `pagedrop_republish`, `pagedrop_list`, `pagedrop_search`.

- [ ] **Step 1: Write the failing test for `registerTools`**

Create `tests/mcp/tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { registerTools } from "../../src/mcp/tools";
import { PublishService } from "../../src/core/publish-service";
import { FakePublisher } from "../fakes/fake-publisher";

function makeHost() {
  const names: string[] = [];
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const host = {
    tool(name: string, _desc: string, _schema: Record<string, unknown>, handler: any) {
      names.push(name);
      handlers[name] = handler;
    },
  };
  return { host, names, handlers };
}

describe("registerTools", () => {
  it("registers all six PageDrop tools", () => {
    const { host, names } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    expect(names.sort()).toEqual(
      [
        "pagedrop_list",
        "pagedrop_publish_deck",
        "pagedrop_publish_doc",
        "pagedrop_publish_page",
        "pagedrop_republish",
        "pagedrop_search",
      ].sort(),
    );
  });

  it("publish_doc handler returns links in its text content", async () => {
    const { host, handlers } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    const out = await handlers["pagedrop_publish_doc"]({ title: "R", markdown: "# hi" });
    expect(out.content[0].type).toBe("text");
    expect(out.content[0].text).toContain("https://edit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools`
Expected: FAIL — cannot find module `../../src/mcp/tools`.

- [ ] **Step 3: Implement `src/mcp/tools.ts`**

```ts
import { z } from "zod";
import type { PublishResult } from "../core/types";
import type { PublishService } from "../core/publish-service";

export interface ToolHost {
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: any) => Promise<{ content: { type: "text"; text: string }[] }>,
  ): void;
}

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

function describeResult(kind: string, title: string, r: PublishResult): string {
  const lines = [`Published ${kind}: "${title}".`];
  if (r.viewUrl) lines.push(`View: ${r.viewUrl}`);
  if (r.editUrl) lines.push(`Edit: ${r.editUrl}`);
  lines.push("Shared with anyone in your organization who has the link.");
  return lines.join("\n");
}

export function registerTools(host: ToolHost, service: PublishService): void {
  const tags = z.array(z.string()).optional();

  host.tool(
    "pagedrop_publish_doc",
    "Publish a Markdown document as a shareable, editable Google Doc.",
    { title: z.string(), markdown: z.string(), tags },
    async ({ title, markdown, tags }) =>
      text(describeResult("document", title, await service.publishDoc(title, markdown, tags))),
  );

  host.tool(
    "pagedrop_publish_page",
    "Publish a full HTML page rendered at a shareable Google Workspace URL.",
    { title: z.string(), html: z.string(), tags },
    async ({ title, html, tags }) =>
      text(describeResult("page", title, await service.publishPage(title, html, tags))),
  );

  host.tool(
    "pagedrop_publish_deck",
    "Publish an HTML/reveal.js presentation as a shareable rendered deck (with an optional native Google Slides copy).",
    { title: z.string(), html: z.string(), tags },
    async ({ title, html, tags }) =>
      text(describeResult("deck", title, await service.publishDeck(title, html, tags))),
  );

  host.tool(
    "pagedrop_republish",
    "Replace the HTML content of a previously published page or deck, keeping its URL.",
    { id: z.string(), html: z.string() },
    async ({ id, html }) => text(describeResult("update", id, await service.republish(id, html))),
  );

  host.tool(
    "pagedrop_list",
    "List everything published to PageDrop.",
    {},
    async () => {
      const refs = await service.list();
      if (refs.length === 0) return text("Nothing has been published yet.");
      return text(
        refs
          .map((r) => `- [${r.type}] ${r.title} — ${r.viewUrl ?? r.editUrl ?? "(no link)"}`)
          .join("\n"),
      );
    },
  );

  host.tool(
    "pagedrop_search",
    "Search published PageDrop artifacts by title or content.",
    { query: z.string() },
    async ({ query }) => {
      const refs = await service.search(query);
      if (refs.length === 0) return text(`No matches for "${query}".`);
      return text(
        refs
          .map((r) => `- [${r.type}] ${r.title} — ${r.viewUrl ?? r.editUrl ?? "(no link)"}`)
          .join("\n"),
      );
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools`
Expected: PASS.

- [ ] **Step 5: Implement `src/index.ts` (entrypoint wiring)**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublishService } from "./core/publish-service.js";
import { GoogleAdapter } from "./adapters/google/google-adapter.js";
import { GoogleDriveClient } from "./adapters/google/google-drive-client.js";
import { GoogleSlidesClient } from "./adapters/google/google-slides-client.js";
import { createOAuthClient, loadGoogleConfigFromEnv } from "./adapters/google/config.js";
import { registerTools } from "./mcp/tools.js";

async function main(): Promise<void> {
  const auth = createOAuthClient();
  const config = loadGoogleConfigFromEnv();
  const adapter = new GoogleAdapter(
    new GoogleDriveClient(auth),
    config,
    new GoogleSlidesClient(auth),
  );
  const service = new PublishService(adapter);

  const server = new McpServer({ name: "pagedrop", version: "0.1.0" });
  registerTools(server as unknown as Parameters<typeof registerTools>[0], service);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("PageDrop failed to start:", err);
  process.exit(1);
});
```

> Note: `src/index.ts` uses `.js` import specifiers because it is the one file run directly by Node/tsx as an ESM entrypoint; the `McpServer` from the SDK is structurally compatible with `ToolHost` (it exposes `tool(name, description, schema, handler)`), hence the single cast.

- [ ] **Step 6: Verify typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts src/index.ts tests/mcp/tools.test.ts
git commit -m "feat: MCP tool registration and server entrypoint"
```

---

### Task 11: Apps Script renderer + deploy/setup docs + client wiring

**Files:**
- Create: `apps-script/renderer.gs`
- Create: `apps-script/DEPLOY.md`
- Create: `.mcp.json.example`
- Create: `README.md` content update (project usage)

**Interfaces:**
- Consumes: the deployed web app URL feeds `PAGEDROP_RENDERER_URL`; the folder from `PAGEDROP_FOLDER_NAME`.
- Produces: a running renderer and documented setup for both Claude surfaces.

- [ ] **Step 1: Create `apps-script/renderer.gs`**

```js
/**
 * PageDrop renderer web app.
 * Serves an HTML file stored in Drive (by file id) as a fully rendered page.
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app.
 *   - Execute as: Me
 *   - Who has access: Anyone within <your domain>
 */
function doGet(e) {
  var id = e && e.parameter ? e.parameter.id : null;
  if (!id) {
    return HtmlService.createHtmlOutput("<h1>PageDrop</h1><p>Missing ?id parameter.</p>");
  }
  try {
    var file = DriveApp.getFileById(id);
    var html = file.getBlob().getDataAsString();
    return HtmlService.createHtmlOutput(html)
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setTitle(file.getName());
  } catch (err) {
    return HtmlService.createHtmlOutput(
      "<h1>PageDrop</h1><p>Could not load that page. It may not exist or you may not have access.</p>"
    );
  }
}
```

- [ ] **Step 2: Create `apps-script/DEPLOY.md`**

```markdown
# Deploying the PageDrop renderer (one-time, admin)

1. Go to https://script.google.com and create a **New project**.
2. Replace the default `Code.gs` contents with `renderer.gs` from this folder.
3. **Deploy → New deployment → Web app**:
   - Description: `PageDrop renderer`
   - Execute as: **Me**
   - Who has access: **Anyone within <your organization>**
4. Authorize the requested Drive scopes when prompted.
5. Copy the **Web app URL** (ends in `/exec`). This is your `PAGEDROP_RENDERER_URL`.

## Environment variables for the MCP server

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
PAGEDROP_RENDERER_URL=https://script.google.com/macros/s/XXXX/exec
PAGEDROP_FOLDER_NAME=PageDrop            # optional, defaults to "PageDrop"
PAGEDROP_DOMAIN=yourcompany.com          # optional; if set, link sharing is domain-restricted
```

Obtain the OAuth values via a Google Cloud OAuth client (Desktop type) with
the Drive and Slides scopes, then run a one-time consent to get a refresh
token. The renderer runs under your account, so stored HTML files must live
in a Drive it can read (the same account used for the MCP server is simplest).
```

- [ ] **Step 3: Create `.mcp.json.example` (Claude Code wiring)**

```json
{
  "mcpServers": {
    "pagedrop": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/PageDrop/src/index.ts"],
      "env": {
        "GOOGLE_CLIENT_ID": "...",
        "GOOGLE_CLIENT_SECRET": "...",
        "GOOGLE_REFRESH_TOKEN": "...",
        "PAGEDROP_RENDERER_URL": "https://script.google.com/macros/s/XXXX/exec",
        "PAGEDROP_FOLDER_NAME": "PageDrop"
      }
    }
  }
}
```

- [ ] **Step 4: Update `README.md`**

Replace the file contents with:

```markdown
# PageDrop

A Claude plugin for publishing reports, documents, and presentations to
Google Workspace and sharing them instantly with colleagues.

- **Markdown → Google Doc** (`pagedrop_publish_doc`) — editable, commentable.
- **HTML → rendered page** (`pagedrop_publish_page`) — served by an Apps Script renderer.
- **HTML deck → presentable page** (`pagedrop_publish_deck`) — plus a best-effort native Slides copy.
- **List / search** (`pagedrop_list`, `pagedrop_search`) — everything lands in a Drive folder.

## Setup

1. Deploy the renderer: see `apps-script/DEPLOY.md`.
2. Set the environment variables listed there.
3. Wire the MCP server:
   - **Claude Code:** copy `.mcp.json.example` to `.mcp.json` and fill in values.
   - **claude.ai / Desktop:** add PageDrop as a custom MCP connector pointing at this server.

## Development

```bash
npm install
npm test          # unit tests (no network)
npm run typecheck
npm start         # run the MCP server over stdio
```
```

- [ ] **Step 5: Manual smoke test (real account)**

With env vars set and the renderer deployed:

Run: `npm start` (in a scratch shell), then from a connected Claude client:
- publish a doc → confirm a Google Doc appears in the PageDrop folder and the edit link opens it;
- publish a page → confirm the view URL renders the HTML as a real page;
- run list/search → confirm the artifacts appear.

Expected: all three succeed; links open for another org user with the link.

- [ ] **Step 6: Commit**

```bash
git add apps-script/renderer.gs apps-script/DEPLOY.md .mcp.json.example README.md
git commit -m "feat: Apps Script renderer, deploy/setup docs, and client wiring"
```

---

## Self-Review

**Spec coverage:**
- Markdown → native Doc (replace Docs/Word): Task 5. ✓
- Full HTML page rendered: Tasks 6 + 11 (renderer). ✓
- HTML deck + optional native Slides (replace Slides/PPT): Task 7 + 9. ✓
- Searchable in Drive: Task 8 (`search` over folder + fullText) . ✓
- Default domain link-sharing, returns view+edit URLs: Tasks 5–7, 10. ✓
- Republish/update in place: Task 8 + 10. ✓
- One-time setup (renderer deploy + folder auto-create): Task 9 (`ensureFolder`) + Task 11 (DEPLOY.md). ✓
- Backend-neutral core / future backends: Task 1 (`Publisher`) + Task 3 (`PublishService`). ✓
- MCP server usable from both surfaces: Task 10 + Task 11 wiring. ✓

**Known POC scope decisions (from the spec, carried forward):**
- Native Slides is best-effort (a titled deck linking to the rendered view), not a full HTML→Slides conversion — Task 7/9.
- `republish` supports HTML pages/decks only; updating a native Doc's body is deferred — Task 8.
- The PageDrop Drive folder itself is the searchable index; a decorative human-browsable index doc is deferred (folder + Drive full-text search satisfy "searchable").
- Real Google client wrappers (Task 9) are verified by typecheck + manual smoke test, not unit tests.

**Placeholder scan:** no TBD/TODO; every code step contains complete code. ✓
**Type consistency:** `Publisher`, `DriveClient`, `SlidesClient`, `GoogleConfig`, `buildViewUrl`, `ArtifactRef` signatures are identical across defining and consuming tasks. ✓
