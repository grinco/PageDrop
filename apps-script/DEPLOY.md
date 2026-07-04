# Deploying PageDrop (one-time, admin) — no Google Cloud project required

PageDrop uses **two** Apps Script web apps. Neither needs the Google Cloud
Console or an OAuth client — Apps Script authorizes Drive access itself. This
is what lets PageDrop run on tenants where "Google Cloud Platform service has
been disabled" in the Workspace Admin console.

```
MCP ──secret──▶ Publisher (anonymous, doPost, execute-as-me)  ── writes Drive files
colleague ─org login─▶ Renderer (org-only, doGet)             ── serves rendered pages
```

The **publisher** is anonymous-reachable, so a shared secret is the only gate
— treat it like a password.

## 1. Deploy the renderer (org-only viewing)

1. Go to https://script.google.com and create a **New project** named
   `PageDrop renderer`.
2. Replace `Code.gs` with the contents of `renderer.gs` from this folder.
3. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone within <your organization>**
4. Authorize the Drive scopes when prompted.
5. Copy the **Web app URL** (ends in `/exec`) → this is `PAGEDROP_RENDERER_URL`.

## 2. Deploy the publisher (secret-gated writes)

1. Create a **second** New project named `PageDrop publisher`.
2. Replace `Code.gs` with the contents of `publisher.gs` from this folder.
3. **Project Settings → Script Properties → Add script property:**
   - `PAGEDROP_PUBLISH_SECRET` = a high-entropy secret. Generate one with:
     ```
     openssl rand -hex 32
     ```
   - `PAGEDROP_FOLDER_NAME` = `PageDrop` (optional; this is the default)
   - `PAGEDROP_DOMAIN` = `yourcompany.com` (optional; if set, published files
     are shared domain-with-link instead of anyone-with-link)
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**  ← anonymous; the secret is the gate
5. Authorize the Drive scopes when prompted.
6. Copy the **Web app URL** (ends in `/exec`) → this is `PAGEDROP_PUBLISHER_URL`.

## 3. Environment variables for the MCP server

```
PAGEDROP_PUBLISHER_URL=https://script.google.com/macros/s/AAAA/exec
PAGEDROP_RENDERER_URL=https://script.google.com/macros/s/BBBB/exec
PAGEDROP_PUBLISH_SECRET=<the same secret you set in step 2.3>
```

No `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` — the
publisher runs under the deploying account, so published files live in that
account's Drive.

## 4. Smoke-test the publisher

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
