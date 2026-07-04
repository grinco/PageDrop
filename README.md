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

## Install via Claude Code (recommended)

The fastest path is to hand the whole setup to Claude. Copy the block below
into Claude Code and it will clone the repo, install dependencies, walk you
through the one-time Google setup, wire up the MCP connection, and publish a
test page so you know it worked.

```
Please set up the PageDrop MCP server for me, end to end:

1. Clone https://github.com/grinco/PageDrop (or use the current checkout if
   I'm already inside the PageDrop repo), then run `npm install` in it.
2. Walk me, step by step, through deploying the two Apps Script web apps in
   apps-script/DEPLOY.md — the renderer (org-only) and the publisher
   (anonymous, secret-gated). That means creating both web apps and getting
   PAGEDROP_RENDERER_URL, PAGEDROP_PUBLISHER_URL, and generating a
   PAGEDROP_PUBLISH_SECRET. No Google Cloud project or OAuth client is
   involved. Wait for me to give you the deployed URLs before moving on.
3. Copy .mcp.json.example to .mcp.json and fill in the values I gave you
   (PAGEDROP_PUBLISHER_URL, PAGEDROP_RENDERER_URL, PAGEDROP_PUBLISH_SECRET).
   Never print my secret back to me in full.
4. Tell me to restart or reload Claude Code so the `pagedrop` MCP server
   loads, and wait for me to confirm I've done that.
5. Once the `pagedrop` tools are available, call `pagedrop_publish_page` with
   title "PageDrop Hello World" and a small self-contained HTML page that
   says hello. Report back the shareable view URL it returns so I can open it.

Go step by step, confirm each stage with me before continuing, and don't
assume I know what any of these Google terms mean.
```

## Manual setup

If you'd rather do it yourself:

1. **Deploy the two web apps.** Follow [`apps-script/DEPLOY.md`](apps-script/DEPLOY.md)
   to deploy the renderer (org-only) and the publisher (anonymous,
   secret-gated) and get your `PAGEDROP_RENDERER_URL`, `PAGEDROP_PUBLISHER_URL`,
   and `PAGEDROP_PUBLISH_SECRET`. No Google Cloud project or OAuth client is
   needed — this is what lets PageDrop run on tenants where Google Cloud
   Platform is disabled. Optional Drive folder name and domain-restricted
   sharing are set as Script Properties on the publisher (see DEPLOY.md).
2. **Configure the environment.** Copy [`.mcp.json.example`](.mcp.json.example)
   to `.mcp.json` and fill in:
   - `PAGEDROP_PUBLISHER_URL` — the publisher web app URL, ending in `/exec` (required)
   - `PAGEDROP_RENDERER_URL` — the renderer web app URL, ending in `/exec` (required)
   - `PAGEDROP_PUBLISH_SECRET` — the shared secret you set on the publisher (required)
3. **Connect it to Claude.**
   - **Claude Code:** place `.mcp.json` in your project root (as above), then
     restart or reload Claude Code so it picks up the `pagedrop` server.
   - **claude.ai / Claude Desktop:** add PageDrop as a custom MCP connector
     using the same command/args/env from `.mcp.json.example`.

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
