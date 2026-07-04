# PageDrop

PageDrop is a Claude plugin (an MCP server) that publishes reports, documents,
and presentations to Google Workspace and hands you back a shareable link.
Ask Claude to write something and publish it — a Markdown report becomes a
native Google Doc, an HTML page or reveal.js deck becomes a rendered,
shareable web page — and everything lands in a searchable Drive folder.
Built for non-technical users: no Drive fiddling, no manual sharing settings,
just "publish this and share it."

## Features

PageDrop exposes six MCP tools:

- **`pagedrop_publish_doc(title, markdown, tags?)`** — converts Markdown into
  a native Google Doc and returns an edit URL.
- **`pagedrop_publish_page(title, html, tags?)`** — publishes a full HTML page,
  rendered via a small Apps Script "renderer" web app, and returns a view URL.
- **`pagedrop_publish_deck(title, html, tags?)`** — publishes an HTML/reveal.js
  presentation as a rendered, presentable page (with an optional native
  Google Slides copy), returning a view URL and, if the Slides copy succeeds,
  an edit URL too.
- **`pagedrop_republish(id, html)`** — replaces the HTML of a previously
  published page or deck while keeping its existing URL.
- **`pagedrop_list()`** — lists everything published to PageDrop so far.
- **`pagedrop_search(query)`** — searches published artifacts by title or
  content.

## Backends

PageDrop supports three publishing backends, selected with the `PAGEDROP_BACKEND`
environment variable. The six MCP tools behave the same whichever you pick:

- **`appsscript` (default)** — publishes through two small Apps Script web apps
  and needs **no Google Cloud project or OAuth client**, so it works even on
  tenants where Google Cloud Platform is disabled in the Workspace admin
  console.
- **`gcp`** — calls the Drive and Slides APIs directly via a Google Cloud OAuth
  client. Adds native Google Doc/Slides copies and Drive full-text search, at
  the cost of a one-time GCP OAuth setup.
- **`kubernetes`** — publishes to a self-hosted PageDrop host service on your
  Kubernetes cluster; viewing sits behind your SSO proxy. Best HTML/CSS/JS
  fidelity and clean internal URLs; no native Docs/Slides copies or Drive
  search. See [`deploy/helm/pagedrop-host/README.md`](deploy/helm/pagedrop-host/README.md).

Pick whichever fits your environment; setup for each is below.

## Install via Claude Code (recommended)

The fastest path is to hand the whole setup to Claude. Copy the block below
into Claude Code and it will clone the repo, install dependencies, walk you
through the one-time Google setup, wire up the MCP connection, and publish a
test page so you know it worked.

```
Please set up the PageDrop MCP server for me, end to end:

1. Clone https://github.com/grinco/PageDrop (or use the current checkout if
   I'm already inside the PageDrop repo), then run `npm install` in it.
2. Ask me which backend I want: "appsscript" (default; no Google Cloud project
   needed) or "gcp" (native Docs/Slides + Drive search, needs a GCP OAuth
   client). Then walk me, step by step, through the matching setup in
   apps-script/DEPLOY.md and wait for the values before moving on.
3. Copy .mcp.json.example to .mcp.json and fill in the values for my chosen
   backend (set PAGEDROP_BACKEND=gcp if I picked GCP; leave it unset for the
   default Apps Script backend). Never print my secrets back to me in full.
4. Tell me to restart or reload Claude Code so the `pagedrop` MCP server
   loads, and wait for me to confirm I've done that.
5. Once the `pagedrop` tools are available, call `pagedrop_publish_page` with
   title "PageDrop Hello World" and a small self-contained HTML page that
   says hello. Report back the shareable view URL it returns so I can open it.

Go step by step, confirm each stage with me before continuing, and don't
assume I know what any of these Google terms mean.
```

## Manual setup

If you'd rather do it yourself, choose a backend (see [Backends](#backends)),
then follow the matching option. Full instructions for both live in
[`apps-script/DEPLOY.md`](apps-script/DEPLOY.md).

### Option A — Apps Script (default, no Google Cloud)

1. **Deploy the two web apps.** Deploy the renderer (org-only) and the publisher
   (anonymous, secret-gated) to get `PAGEDROP_RENDERER_URL`,
   `PAGEDROP_PUBLISHER_URL`, and a `PAGEDROP_PUBLISH_SECRET`. Optional Drive
   folder name and domain-restricted sharing are Script Properties on the
   publisher.
2. **Configure the environment.** Copy [`.mcp.json.example`](.mcp.json.example)
   to `.mcp.json`, leave `PAGEDROP_BACKEND` unset (or `appsscript`), and set:
   - `PAGEDROP_PUBLISHER_URL` — the publisher web app URL, ending in `/exec` (required)
   - `PAGEDROP_RENDERER_URL` — the renderer web app URL, ending in `/exec` (required)
   - `PAGEDROP_PUBLISH_SECRET` — the shared secret you set on the publisher (required)

### Option B — GCP (direct Drive/Slides API)

1. **Deploy the renderer.** Deploy the renderer web app to get your
   `PAGEDROP_RENDERER_URL` (rendered pages/decks are still served through it).
2. **Get OAuth credentials.** Create a Google Cloud OAuth client (Desktop type)
   with Drive + Slides scopes and run a one-time consent to obtain
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`.
3. **Configure the environment.** Copy [`.mcp.json.example`](.mcp.json.example)
   to `.mcp.json` and set:
   - `PAGEDROP_BACKEND=gcp` (required to select this backend)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — OAuth (required)
   - `PAGEDROP_RENDERER_URL` — the renderer web app URL, ending in `/exec` (required)
   - `PAGEDROP_FOLDER_NAME` — Drive folder for artifacts (optional, defaults to `PageDrop`)
   - `PAGEDROP_DOMAIN` — if set, restricts link-sharing to this Workspace domain (optional)

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

### Connect it to Claude (any backend)

- **Claude Code:** place `.mcp.json` in your project root, then restart or
  reload Claude Code so it picks up the `pagedrop` server.
- **claude.ai / Claude Desktop:** add PageDrop as a custom MCP connector using
  the same command/args/env from `.mcp.json.example`.

## Usage examples

Once connected, just talk to Claude naturally:

- "Publish this incident writeup as a Google Doc and share it with me." → `pagedrop_publish_doc`
- "Turn this into a shareable web page and give me the link." → `pagedrop_publish_page`
- "Build a slide deck from these bullet points and publish it." → `pagedrop_publish_deck`
- "Update the page you published earlier with the new numbers." → `pagedrop_republish`
- "What have I published to PageDrop so far?" → `pagedrop_list`
- "Find the deck I published about Q3 planning." → `pagedrop_search`

## Development

- `npm install` — install dependencies
- `npm start` — run the MCP server (`tsx src/index.ts`) over stdio
- `npm test` — run the Vitest suite (in-memory fakes, no network)
- `npm run typecheck` — run `tsc --noEmit`

## Known limitations (POC)

- Decks are listed and searched as type `page`, not `deck`.
- Updating a native Google Doc via `pagedrop_republish` is not supported —
  republish only works for HTML pages/decks.
- Native Google Slides generation is best-effort: it produces a titled deck
  that links to the rendered HTML view, not a full HTML→Slides conversion.
- No version history or analytics.
- External/public sharing is not the default — links are shared within your
  Workspace domain (or "anyone with the link" if `PAGEDROP_DOMAIN` is unset).
- `pagedrop_list`/`pagedrop_search` return at most 100 items (no pagination yet).

## Extending / other backends

The core is backend-neutral. Everything in `src/core/` talks to a
[`Publisher`](src/core/types.ts) interface, not to Google directly. Google
Workspace is the first adapter (`src/adapters/google/`); a future backend —
SharePoint, for example — just implements the same `Publisher` interface and
gets wired in alongside it.
