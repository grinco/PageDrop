# Deploying PageDrop (one-time, admin)

PageDrop has two backends, selected with `PAGEDROP_BACKEND`. **Both** need the
renderer web app (it serves rendered HTML pages/decks); only one needs a
Google Cloud OAuth client. Pick one:

- **Backend A — Apps Script (default, `PAGEDROP_BACKEND=appsscript`).** No
  Google Cloud project or OAuth client. Works even where "Google Cloud
  Platform service has been disabled" in the Workspace Admin console.
- **Backend B — GCP (`PAGEDROP_BACKEND=gcp`).** Calls the Drive/Slides APIs
  directly with an OAuth client. Adds native Google Doc/Slides copies and
  Drive full-text search.

---

# Backend A — Apps Script (default)

Two Apps Script web apps; Apps Script authorizes Drive access itself.

```
MCP ──secret──▶ Publisher (anonymous, doPost, execute-as-me)  ── writes Drive files
colleague ─org login─▶ Renderer (org-only, doGet)             ── serves rendered pages
```

The **publisher** is anonymous-reachable, so a shared secret is the only gate
— treat it like a password.

> **Prerequisite — check this first.** This backend requires that you can deploy
> the publisher web app with **Who has access: Anyone** (anonymous). Some
> Workspace admins disable that and allow only *Anyone within <your
> organization>*. The headless MCP server has no Google login session, so it
> **cannot call an org-restricted web app** without a Google Cloud OAuth client
> — which is exactly what the GCP-disabled case (the reason for this backend)
> rules out. **If your admin blocks "Anyone" access, this backend will not work
> headless — use the Kubernetes backend instead** (see the main README); it
> needs no Google credentials or admin toggles.

## A1. Deploy the renderer (org-only viewing)

1. Go to https://script.google.com and create a **New project** named
   `PageDrop renderer`.
2. Get the renderer code onto your clipboard by running, in the repo you cloned:
   ```
   npm run copy:renderer
   ```
   Then in the editor, click inside `Code.gs`, select all, and paste. (No
   clipboard tool on your machine? The command prints the code instead so you
   can copy it manually.)
3. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone within <your organization>**
4. Authorize the Drive scopes when prompted.
5. Copy the **Web app URL** (ends in `/exec`) → this is `PAGEDROP_RENDERER_URL`.

## A2. Deploy the publisher (secret-gated writes)

1. Create a **second** New project named `PageDrop publisher`.
2. Get the publisher code onto your clipboard by running, in the repo you cloned:
   ```
   npm run copy:publisher
   ```
   Then in the editor, click inside `Code.gs`, select all, and paste. (No
   clipboard tool? The command prints the code to copy manually.)
3. **Project Settings → Script Properties → Add script property:**
   - `PAGEDROP_PUBLISH_SECRET` (**required**) = a high-entropy secret. Generate
     one and copy it to your clipboard (without printing it) by running
     `npm run gen:secret`, then paste the result as the **value** (or use
     `openssl rand -hex 32`). The Script Properties UI **will not save a
     property with an empty value**, so this must be a real string (not blank).
   - `PAGEDROP_FOLDER_NAME` (optional, defaults to `PageDrop`) and
     `PAGEDROP_DOMAIN` (optional; if set, published files are shared
     domain-with-link instead of anyone-with-link) — **only add these if you
     have a value for them.** Leave them out entirely otherwise; the UI won't
     let you save them blank.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**  ← anonymous; the secret is the gate. If your
     admin only offers *Anyone within <org>*, stop here — see the prerequisite
     above and switch to the Kubernetes backend.
5. Authorize the Drive scopes when prompted.
6. Copy the **Web app URL** (ends in `/exec`) → this is `PAGEDROP_PUBLISHER_URL`.

## A3. Environment variables for the MCP server

```
PAGEDROP_BACKEND=appsscript            # optional; this is the default
PAGEDROP_PUBLISHER_URL=https://script.google.com/macros/s/AAAA/exec
PAGEDROP_RENDERER_URL=https://script.google.com/macros/s/BBBB/exec
PAGEDROP_PUBLISH_SECRET=<the same secret you set in step A2.3>
```

No OAuth credentials — the publisher runs under the deploying account, so
published files live in that account's Drive.

## A4. Smoke-test the publisher

Confirm the deployment answers before wiring the MCP server. Publish a page:

```
curl -sL "$PAGEDROP_PUBLISHER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"secret":"'"$PAGEDROP_PUBLISH_SECRET"'","action":"publish","type":"page","title":"PageDrop smoke test","html":"<h1>it works</h1>","scope":"domain"}'
# → {"ok":true,"data":{"id":"...","type":"page","name":"PageDrop smoke test.html",...}}
```

Then open `"$PAGEDROP_RENDERER_URL?id=<id from above>"` in a browser (signed
into your org) to confirm it renders. A wrong/missing secret returns
`{"ok":false,"error":{"code":"unauthorized",...}}`.

> Note: Apps Script caps POST payloads at tens of MB and applies per-user
> execution quotas; both are ample for HTML publishing.

---

# Backend B — GCP (direct Drive/Slides API)

The MCP server calls the Drive/Slides APIs directly under a Google Cloud OAuth
client. Rendered pages/decks are still served through the **renderer** web app,
so you deploy that too.

## B1. Deploy the renderer

Follow **A1** above to deploy `renderer.gs` and get `PAGEDROP_RENDERER_URL`.
(You do **not** need the publisher web app for this backend.)

## B2. Create an OAuth client in Google Cloud

1. In https://console.cloud.google.com, create or select a project.
2. **APIs & Services → Enable APIs**: enable the **Google Drive API** and
   **Google Slides API**.
3. **OAuth consent screen**: choose **Internal** (for a Workspace org) or
   **External** with your account added as a test user.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
   Note the **Client ID** (`GOOGLE_CLIENT_ID`) and **Client secret**
   (`GOOGLE_CLIENT_SECRET`).

## B3. Mint a refresh token

Run a one-time consent to get `GOOGLE_REFRESH_TOKEN`. The simplest path is the
[OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):

1. In the Playground gear menu, check **Use your own OAuth credentials** and
   paste your client ID + secret.
2. Authorize these scopes:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/presentations`
3. Exchange the authorization code and copy the **refresh token**.

## B4. Environment variables for the MCP server

```
PAGEDROP_BACKEND=gcp
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
PAGEDROP_RENDERER_URL=https://script.google.com/macros/s/BBBB/exec
PAGEDROP_FOLDER_NAME=PageDrop            # optional, defaults to "PageDrop"
PAGEDROP_DOMAIN=yourcompany.com          # optional; restricts link-sharing to this domain
```

Published files live in the Drive of the account that minted the refresh token.
