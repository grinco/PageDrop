# PageDrop — Apps Script Publisher (doPost) Design

Date: 2026-07-04
Status: Approved for implementation
Author: Vadim (with Claude)

## Why

The POC design (`2026-07-03-pagedrop-google-workspace-design.md`) has the
Node MCP server call the Drive and Slides APIs directly, authenticated with
a Google Cloud OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REFRESH_TOKEN`). On your organization's Workspace tenant this is a dead end:

> Google Cloud Platform service has been disabled. Please contact your
> administrator to turn the service on in the Google Workspace Admin console.

We cannot create a GCP project or an OAuth client, so the direct-API path
cannot be authenticated. Apps Script, however, calls Drive/Slides using its
**own built-in authorization** (`DriveApp`, `DocumentApp`, `SlidesApp`) with
no external OAuth client and no GCP console. This design moves **all** Google
write/read operations behind an Apps Script web app so PageDrop needs zero
GCP. The Node server keeps only a deployment URL and a shared secret.

This removes the GCP dependency structurally rather than tunnelling around an
admin policy that could tighten later.

## Scope

- **In:** `publish` / `update` / `list` / `search` / `setSharing` for
  `doc`, `page`, and `deck`, rendered as HTML views.
- **Deferred:** native Google Doc / Slides copies (edit URLs). In this cut
  `publish_doc` returns a rendered HTML view of the Markdown; `editUrl` is
  always absent. Native copies are the next cut.
- **Untouched:** the existing `googleapis`-based `GoogleAdapter` stays in the
  tree as the valid path for orgs where GCP *is* enabled. The `Publisher`
  interface exists precisely to allow both. Removing the `googleapis` /
  `google-auth-library` dependencies is a deferred YAGNI call, not part of
  this work.

## Topology — two deployments

An Apps Script `doPost(e)` cannot read arbitrary HTTP headers (no
`Authorization`), and the deployment's **access setting** decides who may
call it:

- *"Anyone within org"* requires every caller to be an authenticated Google
  org user. The headless Node MCP server has no Google session, and giving it
  one needs an OAuth token — the exact thing we cannot mint. **Dead end for
  the publish path.**
- *"Anyone" (anonymous)* is callable with no Google login. The MCP server can
  reach it, gated by a shared secret in the body.

But rendered pages should stay **org-restricted**, and org-restriction
*requires* the viewer's Google login (which browsers have). Publish wants
anonymous; view wants org-only; one deployment can't be both. Resolution:
**two separate script projects, two deployments.**

```
MCP ──secret──▶ Publisher web app        (anonymous, doPost, execute-as-me)
                    │  writes Drive files, sets sharing, reads folder
                    ▼  returns Drive ids
                (Node composes viewUrl)
colleague ─Google org login─▶ Renderer web app  (org-only, doGet)
```

- **Publisher** (`apps-script/publisher.gs`, new): anonymous, secret-gated,
  execute-as-me. The *only* thing the MCP server calls. Exposes only
  `doPost` — no `doGet` render surface exposed to the world.
- **Renderer** (`apps-script/renderer.gs`, existing, unchanged): deployed
  org-only. Exposes only `doGet`. What colleagues open; Google enforces
  org login.

Two separate script projects keep the anonymous surface to `doPost` alone.

## Where work happens

- **Markdown → HTML conversion stays in Node** (`core/markdown.ts` +
  `core/html.ts`). The publisher always receives *final HTML* — even for
  `doc` — so the `.gs` stays dumb: it stores bytes, it does not render. This
  keeps the publishing core backend-neutral.
- **URL composition stays in Node.** The publisher returns Drive `id`s +
  metadata; the MCP composes `viewUrl = ${PAGEDROP_RENDERER_URL}?id=${id}`
  via the existing `buildViewUrl`. The publisher never knows the renderer URL.
- **Folder-ensure and sharing move server-side** into the publisher.

## Wire contract

Every request is `POST {PUBLISHER_URL}` with a JSON body. Every response is
HTTP 200 (an Apps Script constraint) carrying an envelope:

```jsonc
// success
{ "ok": true,  "data": { … } }
// failure
{ "ok": false, "error": { "code": "unauthorized|bad_request|not_found|unsupported|internal",
                          "message": "human-readable" } }
```

The Node client treats non-200, non-JSON, or `ok:false` as a thrown
`PublisherError(code, message)`.

### Actions

```jsonc
// 1. publish — create a new artifact
{ "secret":"…", "action":"publish", "type":"doc|page|deck", "title":"Q3 Report",
  "html":"<!doctype html>…",        // already-rendered final HTML
  "scope":"domain" }
→ data: { "id":"1AbC…", "type":"page", "name":"Q3 Report.html", "createdAt":"2026-07-04T…Z" }

// 2. update — overwrite content in place (stable id ⇒ stable viewUrl)
{ "secret":"…", "action":"update", "id":"1AbC…", "title":"Q3 Report (rev)", "html":"…" }
→ data: { "id":"1AbC…", "name":"Q3 Report (rev).html" }

// 3. list — everything in the PageDrop folder
{ "secret":"…", "action":"list" }
→ data: { "items":[ { "id":"…", "title":"Q3 Report", "type":"page",
                      "createdAt":"…", "modifiedAt":"…" } ] }

// 4. search — Drive full-text within the folder
{ "secret":"…", "action":"search", "query":"revenue" }
→ data: { "items":[ …same shape as list… ] }

// 5. setSharing
{ "secret":"…", "action":"setSharing", "id":"1AbC…", "scope":"domain" }
→ data: { "id":"1AbC…", "scope":"domain" }
```

Baked-in rules:

- The artifact **`type` is stored in the Drive file's `description`** field
  (e.g. `pagedrop-type: page`) via `DriveApp` — read back by `list`/`search`,
  fallback `"page"`. This avoids inferring from mime (all files are
  `text/html` now) and avoids enabling the Advanced Drive Service.
- `scope` accepts only `"domain"` for now (matches the current adapter's
  `applySharing`); `people` / `public` return `{code:"unsupported"}`.
- `editUrl` is always absent in this cut; `viewUrl` is Node-composed for
  every type.

## Secret handling

- **Node:** `PAGEDROP_PUBLISH_SECRET`, sent in every request **body** (never
  the query string, so it stays out of access logs).
- **Apps Script:** stored as a **Script Property** `PAGEDROP_PUBLISH_SECRET`,
  never committed in the `.gs`. Operator sets it once via Project Settings →
  Script Properties.
- **Fail closed:** unset property or missing request secret ⇒ `unauthorized`;
  empty == empty must never pass. Compare with a small constant-time helper
  (GAS has no `timingSafeEqual`).
- The publisher is anonymous-reachable, so the secret is the only gate.
  DEPLOY.md instructs generating a high-entropy value (`openssl rand -hex 32`).

## Node-side structure

The 5 actions mirror the `Publisher` interface, so we add a new `Publisher`
implementation in two thin layers rather than forcing the RPC through the
Drive-shaped `DriveClient`:

- **`PublisherClient`** (`src/adapters/google/publisher-client.ts`) —
  transport. `constructor(publisherUrl, secret, fetchFn = globalThis.fetch)`;
  `call(action, payload)` builds `{secret, action, ...payload}`, POSTs JSON,
  unwraps the envelope, throws typed `PublisherError` on `ok:false` /
  non-200 / non-JSON. `fetchFn` injectable for tests.
- **`AppsScriptPublisher implements Publisher`**
  (`src/adapters/google/apps-script-publisher.ts`) — owns HTML wrapping
  (`doc` → `wrapHtmlDocument(renderMarkdown(content))`; `page`/`deck` →
  `wrapHtmlDocument(content)`), delegates to `PublisherClient`, and composes
  `viewUrl` / `ArtifactRef` from returned ids via `buildViewUrl`.

`config.ts` shrinks: drop `createOAuthClient` and the OAuth vars; new loader
reads `PAGEDROP_PUBLISHER_URL`, `PAGEDROP_RENDERER_URL`,
`PAGEDROP_PUBLISH_SECRET`. `PAGEDROP_FOLDER_NAME` and `PAGEDROP_DOMAIN` move
server-side (publisher Script Properties). `index.ts` wires `PublisherClient`
+ `AppsScriptPublisher` instead of OAuth + `GoogleAdapter`.

## Error & edge handling

- `doPost` wraps everything in try/catch: malformed JSON = `bad_request`,
  missing id on update/setSharing = `not_found`, unsupported scope =
  `unsupported`, anything else = `internal`. Handled errors are HTTP 200 with
  `ok:false`; only unhandled GAS crashes yield a non-JSON page, surfaced by
  the Node client as `internal: malformed response`.
- Apps Script POST payload ceiling is tens of MB — fine for HTML pages;
  DEPLOY.md notes it.
- Per-user Apps Script execution quotas apply (publisher runs as the
  deploying account) — acceptable for POC.

## Testing

- **Node (where the logic lives) — TDD with vitest**, matching the existing
  `tests/` style: `AppsScriptPublisher` + `PublisherClient` against an
  injected fake `fetch`. Assert the request envelope per action + type,
  correct HTML wrapping per artifact type, `ArtifactRef` / `viewUrl`
  composition, and error mapping (`ok:false`, non-200, non-JSON,
  `unauthorized` all throw).
- **Apps Script** can't run under vitest; the `.gs` stays thin and is covered
  by a documented `curl` smoke test in DEPLOY.md against the live deployment.

## Deliverables

1. `apps-script/publisher.gs` — new anonymous doPost web app.
2. `src/adapters/google/publisher-client.ts` — transport + `PublisherError`.
3. `src/adapters/google/apps-script-publisher.ts` — `Publisher` impl.
4. `src/adapters/google/config.ts` — new env loader (GCP-free).
5. `src/index.ts` — rewire.
6. Tests for the two new Node modules.
7. `apps-script/DEPLOY.md` — two-deployment setup, secret generation, curl
   smoke test; drop the OAuth env vars.
```
