# PageDrop: Delete, TTL, and Password-Protected Shares

**Date:** 2026-07-04
**Status:** Design (approved for planning)
**Scope:** Self-hosted (Kubernetes) backend only. The Apps Script backend is out of scope and rejects the new options explicitly.

## Motivation

PageDrop can publish and update artifacts but never expire or remove them, so
the self-hosted store grows without bound and there is no way to retract a
shared page. There is also no access control on individual pages beyond the
deployment's SSO proxy, which makes public / no-SSO installations all-or-nothing.

This design adds three capabilities to the self-hosted backend:

1. **Delete** — retract a published artifact.
2. **TTL** — artifacts that expire and are cleaned up automatically.
3. **Password-protected shares** — a per-artifact password gate enforced by the
   view server, including an opt-in "protect every page by default" mode for
   public installations with a memorable auto-generated passphrase.

## Why self-hosted only

The Apps Script backend serves artifacts as Google Drive files shared via
`ANYONE_WITH_LINK`. A password prompt in `renderer.gs` would be trivially
bypassed by fetching the raw Drive link, so password protection cannot be
honestly enforced there. TTL and delete *could* be added to Apps Script later,
but to keep this change focused they are not.

To keep the shared `Publisher` interface coherent, `AppsScriptPublisher`
implements the new operations as explicit failures:

- `delete` and `setProtection` throw `unsupported on the Apps Script backend`.
- `publish` throws if `ttlSeconds` or `password` is supplied.

This fails loudly rather than silently dropping a security-relevant option.

## Architecture

All changes concentrate in the self-hosted path:

```
MCP tools ── PublishService ── Publisher (interface)
                                  ├── AppsScriptPublisher   (rejects new opts)
                                  └── KubernetesPublisher ── HostClient ──HTTP── host/server.ts ── storage.ts
                                                                                        │
                                                                                   view server (/p/:id)
```

- `src/core/types.ts` — extend `Artifact`, `PublishResult`, and `Publisher`.
- `src/core/publish-service.ts` — `delete`, `setProtection`, validation.
- `src/mcp/tools.ts` — new tools + new args.
- `src/adapters/k8s/host-client.ts`, `kubernetes-publisher.ts` — plumbing.
- `src/adapters/google/apps-script-publisher.ts` — explicit rejections.
- `src/host/storage.ts` — expiry, password hashing, delete, reaper support.
- `src/host/server.ts` — DELETE + protect routes, password unlock flow, reaper.
- `src/host/config.ts` — new config fields.
- `src/host/passphrase.ts` (new) + bundled wordlist — passphrase generation.

## Data model

`ArtifactMeta` (persisted as `<id>.json`) gains two optional fields:

```ts
interface ArtifactMeta {
  id: string;
  title: string;
  type: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  expiresAt?: string;                    // ISO 8601; absent = never expires
  password?: { salt: string; hash: string }; // absent = no password
}
```

**Sentinel convention.** Both optional fields use a single sentinel: the field
is **absent** when unset. `null` is never persisted, so a plain truthy check
(`if (meta.password)`) is always correct. (The `protect` *request* DTO uses
`null` to mean "clear" — that maps to *deleting* the stored field, not writing
`null`.)

The `password` hash is an internal secret. It is **never** returned over the API
or rendered in a listing. The API projects a safe DTO instead:

```ts
interface ArtifactDto {
  id, title, type, tags, createdAt, modifiedAt: ...;
  expiresAt: string | null;
  protected: boolean;   // = password != null
}
```

## Feature 1 — Delete

**Storage** (`storage.ts`):

```ts
delete(id: string): Promise<void>
```

- Validates `isValidId`; throws `NotFoundError` if `<id>.html` does not exist
  (mirrors `update`'s contract).
- Removes `<id>.html` then `<id>.json`; a missing `.json` is ignored (best-effort,
  consistent with the "skip orphaned metadata" handling in `list`).

**API** (`server.ts`): `DELETE /api/artifacts/:id`

- `401` if bearer token invalid.
- `404` (`not_found`) if the artifact does not exist.
- `200 {id}` on success.

**Plumbing:** `HostClient.delete(id)` → `KubernetesPublisher.delete(id)` →
`PublishService.delete(id)` → MCP tool `pagedrop_delete { id }`.

## Feature 2 — TTL

**Specifying expiry.** `publish` (and `protect`) accept optional `ttlSeconds`.
Resolution, computed server-side using the storage's injectable `now`:

| `ttlSeconds` | Result |
|---|---|
| `> 0` | `expiresAt = now + ttlSeconds` |
| `0` | never expires (explicitly overrides the global default) |
| omitted / `undefined` | apply `PAGEDROP_DEFAULT_TTL_SECONDS` if set, else never |

> **Note on `ttlSeconds: 0`.** `0` means **never expires** and explicitly
> overrides the global default — it does *not* mean "expire immediately". This
> is deliberate (a caller opting a specific artifact out of the install-wide
> default) and is called out here because it inverts the convention in some
> caching systems. Negative values are rejected as `bad_request`.

**Enforcement — lazy check + background reaper.**

- *Lazy (authoritative):* `get`, `list`, and `search` treat an artifact whose
  `expiresAt <= now` as non-existent. An expired page is **never served** —
  `GET /p/:id` returns `404` — even if the reaper has not run yet.
- *Reaper:* `storage.deleteExpired()` scans the data dir and deletes expired
  `.html`/`.json` pairs. `server.start()` schedules it on an interval
  (`PAGEDROP_REAPER_INTERVAL_SECONDS`, default `300`). The timer is `unref()`'d
  so it never blocks process exit, and is cleared when the server closes.

`now` remains injectable in `createStorage(dataDir, { now })` so expiry is
deterministically testable without real time.

**Delete vs. expiry.** `delete` operates on **physical presence**, not logical
expiry: deleting an expired-but-not-yet-reaped artifact removes its files and
returns `200`; deleting when no files exist returns `404`. So an expired
artifact is a harmless 404 on the *view* path (lazy check) but is still
explicitly deletable/cleanable via the API until the reaper collects it.

## Feature 3 — Password-protected shares

**Setting a password.** The plaintext password travels over the
bearer-authenticated internal API and is hashed **server-side** — never in the
MCP process. A password can be set at publish time (`password`) or later via
`protect` (see Feature 4).

**Hashing parameters.** `scrypt` (node:crypto) with a per-artifact 16-byte
random salt and fixed, documented cost parameters:

- `N = 16384` (2^14), `r = 8`, `p = 1`, `keylen = 32`.
- `maxmem` is raised (e.g. `64 * 1024 * 1024`) so the default N does not throw.

These are hardcoded (not env-tunable — YAGNI for a single-tenant self-hosted
store) and chosen to balance a view server on modest hardware against offline
cracking. Stored form: `{ salt: <hex>, hash: <hex> }`. Verification derives the
key from the submitted password + stored salt and compares with `timingSafeEqual`.

**Minimum length.** User-supplied passwords must be **≥ 8 characters**
(`bad_request` otherwise). Auto-generated passphrases always satisfy this.

**Unlock flow — form + signed cookie** (view server, `/p/:id`):

- `GET /p/:id`:
  - Load meta; if missing or expired → `404`.
  - If not protected → serve content (unchanged behavior).
  - If protected and a **valid signed cookie** for this id is present → serve content.
  - If protected and no valid cookie → render a styled password form, HTTP `401`.
- `POST /p/:id`:
  - Parse `application/x-www-form-urlencoded` body (size-capped, e.g. 4 KB).
  - Verify the submitted password against the stored hash (`timingSafeEqual`).
  - Success → `Set-Cookie` (see below) and `302` redirect to `GET /p/:id`.
  - Failure → re-render the form with an error, HTTP `401`, after a small fixed
    delay (e.g. 250 ms) to blunt trivial online guessing.

**Brute-force stance.** A fixed per-attempt delay plus the ≥8-char minimum is
the in-scope mitigation. Full per-IP/per-id rate limiting needs shared state
across replicas and is **out of scope** (documented as a residual risk;
operators fronting the view server with a WAF/ingress rate limit is the
recommended defense-in-depth).

**Cookie signing.**

- Cookie name is bound to the artifact id (e.g. `pd_auth_<id>`).
- `payload` is the fixed-format string `"<id>:<expiryEpochSeconds>"` (the id
  charset is `[a-z0-9-]`, so the `:` delimiter is unambiguous).
- Value = `base64url(payload) "." base64url(HMAC-SHA256(payload, secret))`.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Secure`, and `Max-Age` matching the
  payload expiry (short-lived, e.g. 1 hour).
  - The `Secure` attribute is on by default and can be dropped via
    `PAGEDROP_COOKIE_SECURE=false` (chart: `protection.cookieSecure`). This is
    **only** for HTTP-only deployments (no TLS anywhere in front of the view
    server): a `Secure` cookie is never stored/returned by the browser over
    plain `http://`, so the unlock form would otherwise loop forever. Leave it
    on wherever TLS terminates in front — dropping it exposes the unlock cookie
    to interception on a plain connection.
- Verification recomputes the HMAC (constant-time compare) and checks the
  embedded expiry and id. Any mismatch → treated as no cookie (re-prompt).
- Secret comes from `PAGEDROP_COOKIE_SECRET`.
  - If `PAGEDROP_DEFAULT_PROTECT` is on and the secret is unset → **fail fast at
    startup**. Default-protect makes password gating load-bearing, and a
    per-process secret would break unlock sessions across a rolling deploy or any
    second replica.
  - Otherwise (opt-in password use, secret unset) → fall back to a **random
    per-process secret** with a logged warning: cookies won't survive a restart
    and won't validate across replicas (including the brief two-pod overlap of a
    rolling update). Fine for dev / single-pod experimentation; set the secret
    for anything real.

## Feature 4 — Managing protection after publish

A dedicated management operation keeps `publish`/`update` clean (the existing
`PUT /api/artifacts/:id` requires an `html` body, so protection is not folded
into it).

**API:** `POST /api/artifacts/:id/protect` with body:

```jsonc
{
  "password": "hunter2" | null,  // value = set; null = clear; omitted = unchanged
  "ttlSeconds": 3600 | null      // value = set expiry; null = clear expiry; omitted = unchanged
}
```

- `404` if the artifact does not exist; `401` on bad token.
- When `PAGEDROP_DEFAULT_PROTECT` is on and `password` is omitted on an artifact
  that currently has none, a passphrase is generated (same rule as publish).
- Returns the safe DTO; if a password was generated, the response includes the
  one-time plaintext `password`.

**Plumbing:** `Publisher.setProtection(id, opts)` → `HostClient.setProtection` →
MCP tool `pagedrop_protect { id, password?, ttlSeconds? }`.

## Feature 5 — Auto-generated default passwords

**Config flag** `PAGEDROP_DEFAULT_PROTECT` (bool, default off). When on, any
`publish`/`protect` that does not specify a password gets a server-generated
memorable passphrase. Intended for public / no-SSO installations where every
page should be gated by default.

**Resolution order:** explicit `password` → else if `PAGEDROP_DEFAULT_PROTECT` →
generate → else no password. Omitting the flag is the only way to publish an
unprotected page on such an install; this is documented.

**Passphrase format** (`src/host/passphrase.ts`, CSPRNG only — `crypto.randomInt`,
never `Math.random`):

- 4 lowercase English words drawn from a bundled wordlist.
- 3 separators, one between each adjacent pair of words. The *easy* separator set
  is digits `2`–`9` (0 and 1 excluded to avoid O/l confusion) — 8 chars — plus
  the symbols `- . _ ! # @` — 6 chars — for 14 total.
- **Guaranteed composition without rejection sampling** (bounded time): of the 3
  separator slots, pick one at random to hold a digit (from the 8 digits) and a
  different one to hold a symbol (from the 6 symbols); the remaining slot draws
  uniformly from all 14. This guarantees ≥1 digit and ≥1 symbol in exactly one
  pass — no retry loop.
- Example: `river-cloud7moon.stone`
- **Entropy ≈ 53 bits total**: ~41.4 from the words (`4 × log2(1296)`) plus
  ~11–12 from the separators. Strong for link-sharing while remaining typable
  on mobile.

**Wordlist.** Bundle the EFF short wordlist (~1296 words, purpose-built for
memorable passphrases, licensed CC BY 3.0) as a data file with attribution in
the file header and repo docs.

**Surfacing the plaintext.** A generated password is the only time the plaintext
can be revealed. `PublishResult` gains optional `password?: string`, populated
**only** when the server generated one. The MCP `describeResult` prints it, e.g.:

```
Password: river-cloud7moon.stone — share this separately from the link.
```

The stored hash is never returned.

## Interface changes (`src/core/types.ts`)

```ts
interface Artifact {
  // ...existing...
  ttlSeconds?: number;   // self-hosted only
  password?: string;     // self-hosted only; plaintext, hashed server-side
}

interface PublishResult {
  // ...existing...
  password?: string;     // present only when the server generated one
}

interface Publisher {
  publish(artifact: Artifact, scope?: SharingScope): Promise<PublishResult>;
  update(id: string, content: string): Promise<PublishResult>;
  delete(id: string): Promise<void>;                                       // NEW
  setProtection(id: string, opts: {                                        // NEW
    password?: string | null;
    ttlSeconds?: number | null;
  }): Promise<PublishResult>;
  list(): Promise<ArtifactRef[]>;
  search(query: string): Promise<ArtifactRef[]>;
  setSharing(id: string, scope: SharingScope): Promise<void>;
}
```

## Config changes (`src/host/config.ts`)

| Field | Env var | Default |
|---|---|---|
| `defaultTtlSeconds?` | `PAGEDROP_DEFAULT_TTL_SECONDS` | unset (never) |
| `reaperIntervalSeconds` | `PAGEDROP_REAPER_INTERVAL_SECONDS` | `300` |
| `cookieSecret` | `PAGEDROP_COOKIE_SECRET` | random per-process (warn); **required** if `defaultProtect` |
| `cookieSecure` | `PAGEDROP_COOKIE_SECURE` | `true` (drop `Secure` only for HTTP-only deploys) |
| `defaultProtect` | `PAGEDROP_DEFAULT_PROTECT` | `false` |

## MCP surface

- `pagedrop_delete { id }` — delete an artifact.
- `pagedrop_protect { id, password?, ttlSeconds? }` — set/clear password and/or expiry.
- `pagedrop_publish_doc|page|deck` gain optional `ttlSeconds` and `password` args.

Where the active backend does not support an option, the tool surfaces the
backend's `unsupported` error.

## Security notes

- Password hashes never leave the host; API and listings expose only `protected: boolean`.
- Passphrase generation and cookie secrets use CSPRNG exclusively.
- Cookie tokens are HMAC-signed, id-bound, and time-limited; compared in constant time.
- Password verification uses `timingSafeEqual`.
- App-level password protection is independent of any SSO proxy. Layering,
  bypass-for-external-sharing, or defense-in-depth is a deployment (Helm/ingress)
  decision and is documented in the host README, not enforced in code here.
- Form POST bodies are size-capped to avoid unbounded reads.
- User-supplied passwords require ≥8 chars; failed unlocks incur a fixed delay.
  Distributed rate limiting is out of scope (residual risk documented).
- A generated password is shown exactly once. To re-reveal, call `pagedrop_protect`
  to set a **new** password (the old plaintext is unrecoverable by design).

## Testing (TDD)

- **storage:** delete removes files + throws `NotFoundError`; expiry hides from
  `get`/`list`/`search`; `deleteExpired` removes only expired pairs; password
  round-trip; injected `now`.
- **passphrase:** format (4 words, 3 separators, ≥1 digit, ≥1 symbol), wordlist
  membership, distinct outputs across calls (seeded via injected RNG).
- **cookie:** sign→verify round-trip; tamper/expiry/wrong-id rejection.
- **server:** DELETE `200`/`404`/`401`; publish with `ttlSeconds` sets expiry;
  expired `GET /p/:id` → `404`; password flow (locked GET → form/401, wrong POST
  → 401, right POST → cookie + 302, GET with cookie → content); protect set/clear;
  default-protect generates and returns plaintext.
- **host-client / kubernetes-publisher:** delete/protect call correct
  method+path; publish passes `ttlSeconds`/`password`.
- **apps-script-publisher:** delete/setProtection throw `unsupported`; publish
  rejects `ttlSeconds`/`password`.
- **publish-service:** delete/protect validation.
- **mcp tools:** `pagedrop_delete`, `pagedrop_protect`, ttl/password args,
  generated-password surfacing.

## Out of scope

- TTL/delete/password on the Apps Script backend.
- Helm/ingress changes (documented, not coded).
- Multiple passwords per artifact; per-recipient links.
- Rotating the artifact password without knowing the id.
