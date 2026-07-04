# PageDrop

PageDrop is a Claude plugin (an MCP server) that publishes reports, documents,
and presentations to Google Workspace and hands you back a shareable link.
Ask Claude to write something and publish it — a Markdown report becomes a
native Google Doc, an HTML page or reveal.js deck becomes a rendered,
shareable web page — and everything lands in a searchable Drive folder.
Built for non-technical users: no Drive fiddling, no manual sharing settings,
just "publish this and share it."

## Features

PageDrop exposes eight MCP tools:

- **`pagedrop_publish_doc(title, markdown, tags?, ttlSeconds?, password?)`** — converts
  Markdown into a native Google Doc and returns an edit URL.
- **`pagedrop_publish_page(title, html, tags?, ttlSeconds?, password?)`** — publishes a
  full HTML page, rendered via a small Apps Script "renderer" web app, and returns a view URL.
- **`pagedrop_publish_deck(title, html, tags?, ttlSeconds?, password?)`** — publishes an
  HTML/reveal.js presentation as a rendered, presentable page (with an optional native
  Google Slides copy), returning a view URL and, if the Slides copy succeeds,
  an edit URL too.
- **`pagedrop_republish(id, html)`** — replaces the HTML of a previously
  published page or deck while keeping its existing URL.
- **`pagedrop_delete(id)`** — permanently deletes a published artifact.
- **`pagedrop_protect(id, password?, ttlSeconds?)`** — sets or clears a viewing
  password and/or expiry on an existing artifact. Pass `null` to clear a field,
  omit it to leave it unchanged.
- **`pagedrop_list()`** — lists everything published to PageDrop so far.
- **`pagedrop_search(query)`** — searches published artifacts by title or
  content.

> **`ttlSeconds` and `password` are self-hosted (`kubernetes`) features.** On the
> `appsscript` and `gcp` backends the artifact is a Google Drive file shared via an
> anonymous link that a password prompt can't honestly gate, so those backends
> reject `ttlSeconds`/`password` and `pagedrop_delete`/`pagedrop_protect` with a
> clear "unsupported on this backend" error. `ttlSeconds: 0` means "never expires"
> (and overrides the server's default TTL); passwords must be at least 8 characters.

## Backends

PageDrop supports three publishing backends, selected with the `PAGEDROP_BACKEND`
environment variable. **The publishing tools work identically whichever you pick**
(the TTL/password/delete tools are self-hosted `kubernetes`-only — see the note above).

> **Not sure which to choose? Use the default, `appsscript`.** It needs no
> Google Cloud account, no billing, and no admin rights — most people,
> especially first-timers, should start here. The rest of this guide assumes
> it unless noted.

- **`appsscript` — the default, recommended for everyone starting out.**
  Publishes through two small Google Apps Script web apps you create in your
  browser (Claude can walk you through it). Needs **no Google Cloud project, no
  OAuth client, no billing** — it even works on Workspace tenants where Google
  Cloud Platform is disabled.
- **`gcp` (advanced)** — calls the Drive and Slides APIs directly via a Google
  Cloud OAuth client. Adds native Google Doc/Slides copies and Drive full-text
  search, but requires a one-time Google Cloud OAuth setup.
- **`kubernetes` (advanced, self-hosted)** — publishes to a PageDrop host
  service you run on your own Kubernetes cluster, with viewing behind your SSO
  proxy. Best HTML/CSS/JS fidelity and clean internal URLs; no native
  Docs/Slides copies or Drive search. See
  [`deploy/helm/pagedrop-host/README.md`](deploy/helm/pagedrop-host/README.md).

## Install via Claude Code (recommended)

**New to this? This is the easy path — no developer or Google Cloud experience
needed.** Paste the block below into Claude Code (or Claude Desktop). Claude
does the whole thing: clones the repo, installs it, walks you through the
one-time Google setup **in plain language, one step at a time**, wires up the
connection, and publishes a test page so you can see it working. You don't need
to understand any of the Google terms — Claude will explain each click and wait
for you.

```
Please set up the PageDrop MCP server for me, end to end, using the default
Apps Script backend (no Google Cloud account or billing needed). I'm not a
developer — explain each step in plain language, do ONE step at a time, and
wait for me before moving on.

1. Clone https://github.com/grinco/PageDrop (or use the current folder if I'm
   already inside the PageDrop repo) and run `npm install` in it.
2. Ask me whether I'm using a personal Google account or a Workspace
   (organization) account, because the "Who has access" choices differ:
   - Personal account: fine — there's no organization, so I'll deploy BOTH web
     apps with "Who has access: Anyone", and leave PAGEDROP_DOMAIN unset (files
     are shared "anyone with the link"). Proceed.
   - Workspace account: the publisher must be deployable with "Who has access:
     Anyone". If my admin only allows "Anyone within <org>", stop and tell me
     to use the Kubernetes backend instead (see the Backends section) — the
     Apps Script backend can't work headless without anonymous access.
3. Walk me through apps-script/DEPLOY.md "Backend A" to create two Google Apps
   Script web apps in my browser — first the renderer, then the publisher.
   Tell me exactly what to click at each screen (for the renderer's access:
   "Anyone" on a personal account, or "Anyone within <org>" on Workspace). To
   get the code in, have me run `npm run copy:renderer` (then
   `npm run copy:publisher`) — each copies that web app's code to my clipboard
   so I can paste it straight over the default Code.gs (if my machine has no
   clipboard tool, the command prints the code to copy instead). Generate my
   publisher secret by having me run `npm run gen:secret` (it copies a random
   secret to my clipboard without showing it); when I add it as the
   PAGEDROP_PUBLISH_SECRET Script Property, the Apps Script UI won't save a
   blank value, so paste the real secret, and tell me to skip the optional
   PAGEDROP_FOLDER_NAME/PAGEDROP_DOMAIN properties unless I want them. Collect
   PAGEDROP_RENDERER_URL, PAGEDROP_PUBLISHER_URL, and PAGEDROP_PUBLISH_SECRET
   from me before continuing.
4. Copy .mcp.json.example to .mcp.json and fill in those three values (keep
   PAGEDROP_BACKEND as "appsscript"). Never show my secret back to me in full.
5. Tell me to fully quit and reopen Claude Code/Desktop so the `pagedrop`
   server loads, and wait for me to confirm.
6. Once the pagedrop tools appear, call `pagedrop_publish_page` with the title
   "PageDrop Hello World" and a small hello-world HTML page, then give me the
   shareable link so I can open it.

Only if I explicitly say I need native Google Docs/Slides editing or Drive
search: switch me to the "gcp" backend and follow apps-script/DEPLOY.md
"Backend B" instead. Otherwise stick with the default Apps Script setup.
```

## Manual setup

If you'd rather do it yourself, choose a backend (see [Backends](#backends)),
then follow the matching option. Full instructions for both live in
[`apps-script/DEPLOY.md`](apps-script/DEPLOY.md).

### Option A — Apps Script (default, no Google Cloud)

> **Personal (non-Workspace) account?** You have no organization domain, so
> deploy the **renderer** with "Who has access: **Anyone**" (the "Anyone within
> `<org>`" option won't appear) and leave `PAGEDROP_DOMAIN` unset — published
> files are shared "anyone with the link". Everything else is unchanged. On a
> **Workspace** account the publisher still needs "Anyone" access (see the
> prerequisite in [`apps-script/DEPLOY.md`](apps-script/DEPLOY.md)).

1. **Deploy the two web apps.** Deploy the renderer (Workspace: org-only;
   personal: "Anyone") and the publisher (anonymous, secret-gated) to get
   `PAGEDROP_RENDERER_URL`, `PAGEDROP_PUBLISHER_URL`, and a
   `PAGEDROP_PUBLISH_SECRET`. Optional Drive folder name and domain-restricted
   sharing are Script Properties on the publisher.
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
