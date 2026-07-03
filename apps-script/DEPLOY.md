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
