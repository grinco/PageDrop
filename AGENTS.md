# AGENTS.md

Guidance for coding agents working in this repository.

## Project overview

PageDrop is an MCP server (TypeScript, Node, ESM, run via `tsx` — no build
step) that lets Claude publish Markdown/HTML content to Google Workspace and
return shareable links. It is layered to keep the publishing logic
backend-neutral:

```
src/core/            backend-neutral core
  types.ts             Artifact, PublishResult, ArtifactRef, and the
                        Publisher interface every backend adapter implements
  publish-service.ts   PublishService: validation + orchestration, talks
                        only to a Publisher, no Google-specific code
  markdown.ts           Markdown helpers (used for pagedrop_publish_doc)
  html.ts                HTML helpers (used for pages/decks)

src/adapters/google/  the Google Workspace adapter (first Publisher impl)
  google-adapter.ts     GoogleAdapter implements Publisher
  drive-client.ts        DriveClient interface
  slides-client.ts       SlidesClient interface
  google-drive-client.ts  real Drive API implementation of DriveClient
  google-slides-client.ts real Slides API implementation of SlidesClient
  apps-script-publisher.ts AppsScriptPublisher implements Publisher (GCP-free,
                          default wiring): delegates Drive work to the Apps
                          Script publisher web app
  publisher-client.ts     PublisherClient — HTTP transport to that web app
  config.ts               env var loading (publisher + legacy OAuth paths)

src/mcp/tools.ts       registers the six pagedrop_* MCP tools against a
                        PublishService
src/index.ts           entrypoint: wires GoogleAdapter + PublishService +
                        registerTools, connects over stdio

tests/fakes/           in-memory fakes (FakeDriveClient, FakeSlidesClient,
                        FakePublisher) used by all unit tests — no network
```

The dependency direction is one-way: MCP layer → core → `Publisher`
interface ← adapter. `PublishService` and the MCP tool handlers never import
anything from `src/adapters/google/` directly.

## Build / test

- `npm ci` — install dependencies from the lockfile
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — run the Vitest suite (`vitest run`)
- `npm run test:watch` — Vitest in watch mode
- `npm start` / `npm run dev` — run the server (`tsx src/index.ts`)

There is no build/compile step; the server runs directly from TypeScript
source via `tsx`.

## Conventions (mandatory)

1. **Test-Driven Development.** Write the failing test first, then write the
   implementation that makes it pass. All unit tests run against the
   in-memory fakes in `tests/fakes/` — there must be no real network calls
   (no live Drive/Slides/Apps Script requests) in the test suite.
2. **No co-author trailers.** Do not add a `Co-Authored-By:` line (or any
   other co-author trailer) to commit messages, regardless of what tooling
   defaults to.

## Adding a new publishing backend

1. Implement the `Publisher` interface from `src/core/types.ts`
   (`publish`, `update`, `list`, `search`, `setSharing`) against the new
   backend (e.g. SharePoint).
2. Write it test-first: build a fake for the new backend's client(s) under
   `tests/fakes/`, write tests against the fake, then implement.
3. Wire the new adapter into `src/index.ts` (in place of, or alongside,
   `GoogleAdapter`) so it's constructed and passed into `PublishService`.
4. Do not change `PublishService` or `src/mcp/tools.ts` to special-case the
   new backend — the point of the `Publisher` interface is that they don't
   need to know which backend is behind it.

## Setup / deploy docs

These are user-facing setup docs, not agent instructions, but agents editing
the server's env-var handling or the renderer should keep them in sync:

- [`apps-script/DEPLOY.md`](apps-script/DEPLOY.md) — deploying the two Apps
  Script web apps (renderer + publisher); GCP-free, no OAuth credentials.
- [`.mcp.json.example`](.mcp.json.example) — example Claude Code MCP
  configuration (command, args, required env vars) that users copy to
  `.mcp.json`.
