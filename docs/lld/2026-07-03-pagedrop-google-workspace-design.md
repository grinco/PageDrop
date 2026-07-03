# PageDrop — Google Workspace Publishing Plugin (Design)

Date: 2026-07-03
Status: Approved for POC
Author: Vadim (with Claude)

## Summary

PageDrop is a Claude plugin that lets a non-technical user ask Claude to
publish a report, document, or presentation and instantly get shareable
links for their colleagues. It targets Google Workspace first, but is
built around a backend-neutral publishing core so other backends (e.g.
SharePoint) can be added later without touching the core.

Two publishing outcomes are delivered for every artifact where it makes
sense:

- a **rendered view** — pixel-perfect HTML (reports) or a presentable
  HTML deck (presentations), and
- a **native editable copy** — a Google Doc or Google Slides file that
  colleagues can open, comment on, and co-edit.

Everything published lands in a dedicated, Drive-searchable location.

## Goals

- Let a non-technical user publish and share in a single natural-language
  request ("publish this report and share it with my team").
- Support Markdown documents (to replace Word / Google Docs) and full
  HTML pages and HTML-based decks (to replace PowerPoint / Google Slides).
- Preserve HTML/CSS fidelity for rendered pages and decks.
- Also produce native Google Docs/Slides copies so colleagues can edit.
- Make every published artifact searchable inside Google Drive.
- Default sharing to "anyone in the organization with the link."
- Keep the core backend-neutral so additional backends can be added later.

## Non-goals (for the POC)

- SharePoint or any non-Google backend (the interface anticipates it; the
  implementation does not).
- Version-history UI or diffing.
- View/access analytics.
- Custom domains for rendered pages.
- Public / external-to-org sharing (opt-in only, deferred).
- Round-tripping native Docs/Slides edits back into HTML.

## Key Constraint (why the architecture looks the way it does)

Google Workspace has **no native static HTML hosting**. The
`drive.google.com/host/` feature was deprecated in 2015 and fully
disabled in August 2016. Uploading an `.html` file to Drive today gives
colleagues a download prompt or a sanitized source preview — never a
live, rendered page.

However, **Google Apps Script can serve full, rendered HTML pages** via
`HtmlService` at a `script.google.com/macros/s/…/exec` URL, shareable
within a Workspace domain. This is the mechanism PageDrop uses to render
HTML while staying inside Google's trust boundary and requiring no
servers.

References:
- Drive hosting removal: https://lifetips.alibaba.com/tech-efficiency/host-web-pages-on-google-drive
- Apps Script HTML Service: https://developers.google.com/apps-script/guides/html
- Apps Script Web Apps: https://developers.google.com/apps-script/guides/web

## Options Considered

**Option A — Zero-infra, native-only.** Convert everything to Google
Docs/Slides via the existing Google connector. No extra infrastructure,
fully searchable/editable, but loses HTML/CSS/deck fidelity. Rejected on
fidelity grounds; retained conceptually as the fallback path.

**Option B — Hybrid: Apps Script renderer + native copies (CHOSEN).**
A single lightweight Apps Script web app renders stored HTML as real
pages; each artifact also gets a native Doc/Slides copy; everything is
indexed in a Drive folder. No servers, stays inside Workspace, delivers
both fidelity and native editability.

**Option C — Full GCP static hosting.** Firebase Hosting or a GCS bucket
for pixel-perfect pages with clean custom-domain URLs; Drive holds links
plus native copies. Best URLs and scale, but real cloud infra with its
own auth/security surface, and arguably outside Workspace. Deferred as a
possible future backend.

Decision: **Option B.** It is the only option satisfying fidelity +
native editability + Drive search without standing up servers.

## Architecture

PageDrop is a **backend-neutral publishing core** plus a **Google
Workspace adapter**, exposed as an **MCP server** so it works from both
claude.ai / Claude Desktop and Claude Code. Thin slash-command / skill
wrappers provide the Claude Code surface. Core logic lives in the MCP
server so both surfaces share one implementation.

### Component 1 — Publishing core (backend-neutral)

Defines a single `Publisher` interface and an artifact model. It
sanitizes and renders content, then delegates to the configured adapter.
Adding SharePoint/Confluence/etc. later means implementing a new adapter
behind this interface — no core changes.

`Publisher` interface (conceptual):

- `publish(artifact) -> { viewUrl?, editUrl?, id }`
- `update(id, artifact) -> { viewUrl?, editUrl?, id }`
- `list(filter?) -> [artifactRef]`
- `search(query) -> [artifactRef]`
- `setSharing(id, scope)`

Artifact model:

- `type`: `doc` | `page` | `deck`
- `title`
- `content` (Markdown or HTML)
- `assets` (inlined/embedded where possible)
- `tags`, `author`, `createdAt`

### Component 2 — Google Workspace adapter

Routes by artifact type:

- **`doc` (Markdown → replaces Word/Docs):** convert MD → HTML, upload to
  Drive with conversion to a native **Google Doc** (editable,
  commentable), and keep the source `.md`. Returns an edit URL.
- **`page` (full HTML report):** store the HTML file in the PageDrop
  Drive folder (for search + versioning) and register it with the Apps
  Script renderer, which serves it as a live rendered page. Returns a
  view URL. Optionally also creates a native Doc copy.
- **`deck` (replaces Slides/PowerPoint):** render an HTML/reveal.js deck
  through the renderer for a full-screen presentable view (must-have),
  and **optionally** generate a native **Google Slides** copy for
  co-editing (best-effort in the POC — see Open Decisions).

For all types, the adapter:

- applies **domain "anyone with the link" sharing** by default, and
- writes/updates an entry in the **PageDrop index** (Drive folder + index
  doc) for discoverability and Drive full-text indexing.

### Component 3 — Apps Script renderer web app (the one piece of infra)

A single deployed Apps Script web app:

- `doGet(?id=…)` looks up the stored HTML in the PageDrop Drive folder by
  id and returns it via `HtmlService`, using `IFRAME` sandbox mode and
  `XFrameOptionsMode.ALLOWALL` so it renders as a genuine page.
- Deployed as "execute as me, accessible to anyone in the domain" to
  match domain-link sharing.
- A one-time **setup flow** walks an admin through deploying it and
  pasting the deployment URL into PageDrop config.

This component is what solves the "Drive can't render HTML" constraint.

### Component 4 — Search / discovery

A `search` capability wraps Drive's full-text search scoped to the
PageDrop folder (Google Docs, Slides, and HTML text content are all
indexed), plus a human-browsable index doc that lists published
artifacts with links and tags.

### Auth

- **POC:** per-user OAuth (matches "anyone in org with the link" and
  keeps authorship correct on Drive files).
- **Later hardening:** a service account with domain-wide delegation, if
  a single publishing identity is preferred.

## Data Flow — "publish this report and share it with my team"

1. Claude generates the content (Markdown or HTML).
2. Claude calls the MCP tool `publish_*` with `{ type, title, content }`.
3. Core sanitizes and renders the content.
4. Adapter:
   - uploads source + rendered HTML to the PageDrop Drive folder,
   - creates the native Doc/Slides copy where applicable,
   - registers the HTML id with the renderer (for `page`/`deck`),
   - applies domain-link sharing,
   - updates the index.
5. Adapter returns a **view URL** (rendered) and/or an **edit URL**
   (native).
6. Claude replies in chat with the link(s).

## POC Feature List

1. **`publish_doc`** — Markdown → native Google Doc + shareable link.
2. **`publish_page`** — full HTML → rendered page via the Apps Script
   renderer, stored in Drive.
3. **`publish_deck`** — HTML/reveal.js deck → presentable rendered page
   (must-have) + optional native Slides copy (best-effort).
4. **`list` / `search`** — find previously published artifacts in the
   PageDrop folder.
5. **Default domain link-sharing**, returning view and edit URLs on every
   publish.
6. **Republish / update** an existing artifact in place (stable URL).
7. **One-time setup flow** — deploy the Apps Script renderer + auto-create
   the PageDrop Drive folder and index doc.

## Open Decisions (locked for POC)

- **Native Slides generation** stays in the POC but as an *optional*
  sub-feature of `publish_deck`. The rendered HTML deck is the must-have;
  native Slides is best-effort and may slip to a follow-up if the Slides
  API mapping proves heavy.
- **Auth** is per-user OAuth for the POC; service-account delegation is
  deferred.

## Future Work

- SharePoint adapter behind the same `Publisher` interface.
- Optional GCP/Firebase hosting backend for clean custom-domain URLs.
- Version history, view analytics, external sharing (opt-in), and
  edit-back-to-HTML round-tripping.
