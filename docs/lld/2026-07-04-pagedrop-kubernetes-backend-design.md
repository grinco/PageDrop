# PageDrop — Kubernetes Static-Host Backend (Design)

Date: 2026-07-04
Status: Approved for implementation
Author: Vadim (with Claude)

## Why

PageDrop's backend is a runtime configuration choice (`PAGEDROP_BACKEND`,
dispatched by `createPublisher()`): `appsscript` (default) and `gcp`. This
adds a third, `kubernetes` — publishing to a small self-hosted service on an
internal Kubernetes cluster, with viewing behind the operator's SSO proxy.

This is the design doc's long-deferred "Option C — full static hosting", made
practical because the operator already runs k8s + an SSO proxy. Its advantages
over the Apps Script path:

- **Fidelity**: raw HTML/CSS/JS served directly — no `HtmlService` iframe
  sandbox/CSP wrapping. reveal.js decks, arbitrary JS, and fonts work.
- **Clean URLs**: `https://pagedrop.internal.example.com/p/<id>`.
- **Access control**: the SSO proxy is real org-restriction, enforced by the
  viewer's login — no anonymous endpoint, no shared-link capability leak.

It does **not** provide native editable Google Doc/Slides copies or Drive
search; like the Apps Script static path it serves rendered HTML only. It is a
peer backend, selected per install — not a replacement.

## Architecture

Two pieces, mirroring the Apps Script split (dumb server + smart adapter):

1. A **host service** (the deployed payload): a small Node/TS service that
   stores and serves rendered artifacts. Two ports — viewing (behind SSO) and
   a token-gated write API.
2. A **Node `KubernetesPublisher` adapter** in the MCP server: implements the
   `Publisher` interface, does all HTML wrapping/Markdown conversion, and talks
   to the host service's write API.

```
MCP ──Bearer token──▶ :8081 /api/*   (write/list/search/update)  ┐
                                                                 ├─ pagedrop-host pod (PVC /data)
colleague ─SSO proxy──▶ :8080 /p/<id>, /  (rendered + index)     ┘
```

The MCP server is headless and runs outside the cluster (wherever Claude
Desktop/Code runs), so it cannot complete an interactive SSO handshake. The
write API therefore sits on a separate port reachable past the SSO proxy and
is gated by a Bearer token; viewing sits behind the SSO proxy where the
viewer's browser supplies the login.

**The host service stores bytes; it does not render.** Exactly like
`publisher.gs`, the Node adapter performs all Markdown→HTML conversion and
document wrapping before sending, so rendering is identical across all three
backends.

## Component 1 — Host service (`src/host/`)

Zero new dependencies: `node:http` + `node:fs/promises`.

### Ports and routes

**Viewing (`:8080`, intended behind the SSO proxy):**
- `GET /p/:id` — serves the stored `<id>.html` as `text/html`; `404` if absent.
- `GET /` — a minimal HTML index listing published artifacts (title, type,
  link, modified time); the internal analog of the Drive index.
- `GET /healthz` — `200`, unauthenticated (k8s probes).

**Write API (`:8081`, Bearer-token gated on every route):**
- `POST /api/publish` `{ type, title, html, tags? }` → `201 { id }`
- `PUT /api/artifacts/:id` `{ html, title? }` → `200 { id }`
- `GET /api/artifacts` → `200 { items: [{id,title,type,createdAt,modifiedAt,tags}] }`
- `GET /api/search?q=<term>` → `200 { items: [...] }` (case-insensitive match
  on title and stored HTML content)
- `GET /healthz` — `200`, unauthenticated.

Error responses are JSON: `{ error: { code, message } }` with an appropriate
status (`400` bad request, `401` unauthorized, `404` not found).

### Auth

`Authorization: Bearer <PAGEDROP_HOST_TOKEN>`, compared constant-time. If the
token env var is unset the API fails closed (every API request → `401`).
Viewing and `/healthz` are not token-gated (viewing is protected by the SSO
proxy in front of `:8080`).

### Storage

A PVC mounted at `PAGEDROP_HOST_DATA_DIR` (default `/data`). Each artifact is
two files:
- `<id>.html` — the rendered bytes (already wrapped by the adapter).
- `<id>.json` — `{ id, title, type, tags, createdAt, modifiedAt }`.

`list`/`search` scan the `.json` files; no database. `id` = `slug(title)` + `-`
+ a 6-hex random suffix, generated server-side and returned on publish, giving
clean stable URLs (`/p/q3-report-a1b2c3`). `update` overwrites `<id>.html`,
optionally renames the title in metadata, and bumps `modifiedAt`; the id and
therefore the URL stay stable.

### Host environment variables

- `PAGEDROP_HOST_TOKEN` (required) — the write-API bearer token. This is the
  same secret the adapter sends as `PAGEDROP_K8S_TOKEN`; the two must match.
- `PAGEDROP_HOST_DATA_DIR` (default `/data`).
- `PAGEDROP_HOST_VIEW_PORT` (default `8080`).
- `PAGEDROP_HOST_API_PORT` (default `8081`).

The server is launched via `tsx src/host/server.ts` (npm script `host`),
mirroring how the MCP server runs — no build step.

## Component 2 — Node adapter (`src/adapters/k8s/`)

Self-contained, like `src/adapters/google/`.

- **`host-client.ts`** — HTTP transport. Sets `Authorization: Bearer`, sends
  and parses JSON, maps a non-2xx response to a typed `K8sHostError(status,
  message)`. Takes an injectable `fetch` (`globalThis.fetch` default) for
  tests.
- **`kubernetes-publisher.ts`** — `implements Publisher`:
  - `publish(artifact, scope)` — wraps HTML (`doc` → `renderMarkdown` →
    `wrapHtmlDocument`; `page`/`deck` → `wrapHtmlDocument`), `POST /api/publish`,
    returns `{ id, viewUrl: ${baseUrl}/p/${id}, sharing: "domain" }`.
  - `update(id, content)` — wraps, `PUT /api/artifacts/:id`, returns
    `{ id, viewUrl }`.
  - `list()` / `search(q)` — `GET` the API, map items to `ArtifactRef`
    (`{ id, title, type, viewUrl }`).
  - `setSharing(id, scope)` — no-op for `"domain"`; throws `unsupported` for
    `"public"`/`"people"` (viewing is uniformly SSO-gated org-wide).
- **`config.ts`** — `loadK8sConfigFromEnv()` → `{ apiUrl, baseUrl, token }`
  from `PAGEDROP_K8S_API_URL` (write API base), `PAGEDROP_K8S_BASE_URL` (public
  viewing base, for composing `viewUrl`), and `PAGEDROP_K8S_TOKEN`. Fail-closed
  with a clear "missing vars" error that never echoes the token value.

### Wiring

`createPublisher()` gains `case "kubernetes"`, building the `KubernetesPublisher`
from `loadK8sConfigFromEnv()` and a `HostClient`. The `PAGEDROP_BACKEND`
default stays `appsscript`; `gcp` and `kubernetes` are opt-in.

## Semantics summary

- Viewing is always org-restricted by the SSO proxy; there is no public or
  per-artifact sharing. `sharing` is reported as `"domain"`.
- `doc`/`page`/`deck` all render to HTML. `editUrl` is always absent;
  `viewUrl` is always present and composed Node-side from `PAGEDROP_K8S_BASE_URL`.

## Packaging

### Dockerfile

`node:20-alpine`; copies the repo, runs `npm ci`, launches
`tsx src/host/server.ts`. Exposes `8080`/`8081`, runs as a non-root user,
declares `/data` as a volume.

### Helm chart (`deploy/helm/pagedrop-host/`)

Templates:
- `Deployment` — two container ports, `/healthz` liveness/readiness probes,
  env from `values`, token injected from a `Secret`, PVC mounted at `/data`.
- `Service` — exposes both the viewing and API ports.
- `PersistentVolumeClaim` — size from `values`, or reference an existing claim.
- `Secret` — the write-API token, created from a value or referencing an
  existing secret.
- `Ingress` — two hosts: **viewing** (with a `values`-driven `annotations`
  block so the operator injects their own SSO-proxy annotations here) and the
  **API** host (token-gated, no SSO annotations). Each toggleable.
- `values.yaml` — image repo/tag, token or existing-secret name, storage size,
  ingress hosts and per-ingress annotations, resource limits.

The chart does not ship or assume a particular SSO proxy; the operator wires
their proxy onto the viewing ingress via annotations.

## Testing

- **Host service** (`tests/host/`): start the server on ephemeral ports with a
  temp data dir. Assert `publish` writes both files, `GET /p/:id` serves the
  HTML, `list`/`search`/`update` behave, `401` without/with a wrong token,
  `404` for a missing id, and `/healthz` is open. Real HTTP, no k8s.
- **Adapter** (`tests/adapters/k8s/`): `kubernetes-publisher` and `host-client`
  against a fake `fetch` — request shapes per action, HTML wrapping per type,
  `viewUrl` composition, `setSharing` rules, and error mapping.
- **`create-publisher`**: extend with a `kubernetes` case (returns a
  `KubernetesPublisher`).
- **Chart / Docker** (not unit-testable): verified with `helm lint` +
  `helm template`, and `docker build` + a container `/healthz` smoke where the
  sandbox allows; documented otherwise.

All Node code is written test-first (TDD), matching the existing Vitest suite;
tests make no real network or cluster calls.

## Deliverables

1. `src/host/` — the host service (server + storage) and `host` npm script.
2. `src/adapters/k8s/` — `kubernetes-publisher.ts`, `host-client.ts`,
   `config.ts`.
3. `src/adapters/google/create-publisher.ts` — `kubernetes` case.
4. `Dockerfile` for the host container.
5. `deploy/helm/pagedrop-host/` — the Helm chart.
6. Tests for the host service and the adapter modules.
7. Docs: README (backend Option C), the Helm chart's own
   `deploy/helm/pagedrop-host/README.md` (deploy steps), `.mcp.json.example`,
   `AGENTS.md`.

## Non-goals (this cut)

- Native editable copies and full-text search beyond the simple title+content
  scan.
- Deleting/unpublishing artifacts (add later if needed).
- Authenticating individual viewers within the app (delegated to the SSO
  proxy) or per-artifact ACLs.
- Shipping or configuring a specific SSO proxy.
