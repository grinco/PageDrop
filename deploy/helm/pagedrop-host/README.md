# pagedrop-host Helm chart

Deploys the PageDrop Kubernetes static-host backend: a single pod serving
rendered artifacts on a viewing port (`:8080`, place behind your SSO proxy) and
a token-gated write API (`:8081`, reached by the PageDrop MCP server).

## Install

```
helm install pagedrop deploy/helm/pagedrop-host \
  --set image.repository=<your-registry>/pagedrop-host \
  --set image.tag=0.1.0 \
  --set token.value=$(openssl rand -hex 32)
```

This installs with the viewing ingress **disabled**. Set the same token as
`PAGEDROP_K8S_TOKEN` in the MCP server's environment (`PAGEDROP_BACKEND=kubernetes`,
`PAGEDROP_K8S_API_URL`, `PAGEDROP_K8S_BASE_URL`).

## Putting viewing behind SSO (worked example: oauth2-proxy)

The viewing ingress is disabled by default because enabling it without an SSO
proxy in front would expose published pages unauthenticated. You must enable
it together with your proxy's annotations in the same install/upgrade:

```
--set viewIngress.enabled=true \
--set viewIngress.host=pagedrop.internal.example.com \
--set-json 'viewIngress.annotations={"nginx.ingress.kubernetes.io/auth-url":"https://oauth2-proxy.internal/oauth2/auth","nginx.ingress.kubernetes.io/auth-signin":"https://oauth2-proxy.internal/oauth2/start?rd=$escaped_request_uri"}'
```

The API ingress must NOT carry these annotations — the headless MCP server
cannot complete interactive SSO. Keep `apiIngress.enabled=false` and reach the
Service in-cluster when possible, or restrict it via `networkPolicy.allowedCIDRs`
and a private load balancer.

## Restricting direct access to the viewing port (8080)

By default, port 8080 is reachable by any in-cluster pod — SSO only fronts
the ingress, it does not gate pod-to-pod traffic. If you want to restrict
direct access to just your SSO proxy's source, set one of:

```
--set 'networkPolicy.viewAllowedCIDRs={10.0.0.0/8}'
```

or a pod selector via `networkPolicy.viewAllowedPodSelectors`.

## Write-API NetworkPolicy is deny-by-default

The chart's `NetworkPolicy` allows port `8080` (viewing) unconditionally, but
port `8081` (write API) is **deny-by-default**: if both
`networkPolicy.allowedCIDRs` and `networkPolicy.allowedPodSelectors` are
empty, no ingress rule for port 8081 is rendered at all, so nothing can reach
it — including your own MCP server. You MUST set one of:

```
--set 'networkPolicy.allowedCIDRs={10.0.0.0/8}'
```

or a pod selector via `networkPolicy.allowedPodSelectors`, to permit your MCP
client's traffic. Alternatively, set `networkPolicy.enabled=false` to disable
the policy entirely and rely on other network controls.

## Artifact lifecycle (TTL) and cleanup

Artifacts can expire. A publish may set a per-artifact `ttlSeconds`, and the
chart can set an install-wide default:

```
--set lifecycle.defaultTtlSeconds=604800   # 7 days; empty = never expire by default
--set lifecycle.reaperIntervalSeconds=300  # background sweep cadence
```

Expired artifacts are hidden from viewing/listing immediately (a `GET /p/:id`
returns `404`) and deleted from disk by the background reaper. A publish can opt
a specific artifact out of the default with `ttlSeconds: 0` ("never"). Artifacts
can also be removed explicitly via `DELETE /api/artifacts/:id` (the
`pagedrop_delete` MCP tool).

## Password-protected pages

Pages can be gated by a per-artifact password, enforced by the view server:
`GET /p/:id` returns a password form (HTTP 401) until the visitor submits the
correct password, which sets a short-lived, HMAC-signed, HttpOnly cookie scoped
to that page. Passwords are set at publish time (`password`), or later via
`POST /api/artifacts/:id/protect` (the `pagedrop_protect` MCP tool); they are
hashed server-side with scrypt and never returned.

**Password protection is independent of your SSO proxy.** It is an application
gate enforced in-pod regardless of ingress, so it works as defense-in-depth
behind SSO, or as the sole gate if you deliberately expose the viewing port
without SSO. If you expose it without SSO, front it with an ingress/WAF rate
limit — the app applies only a small per-attempt delay and an 8-char minimum,
not distributed rate limiting.

### Cookie signing secret (required for multi-replica / restarts)

Unlock cookies are signed with `PAGEDROP_COOKIE_SECRET`. If unset, the host uses
a random per-process secret and cookies won't survive a restart or validate
across replicas (including the brief two-pod overlap of a rolling update). Set a
stable secret for any real deployment:

```
--set protection.cookieSecret.value=$(openssl rand -hex 32)
# or point at a Secret you manage:
--set protection.cookieSecret.existingSecret=my-secret --set protection.cookieSecret.existingSecretKey=cookieSecret
```

### Protect every page by default (public / no-SSO installs)

For an install with no SSO where every page should be gated, enable
default-protect. Each publish without an explicit password then gets an
auto-generated, memorable passphrase (four EFF words joined by digit/symbol
separators, e.g. `river-cloud7moon.stone`), returned once in the publish result:

```
--set protection.defaultProtect=true \
--set protection.cookieSecret.value=$(openssl rand -hex 32)
```

`defaultProtect=true` **requires** a `cookieSecret` — the chart refuses to render
without one.

## Token rotation

1. Update the Secret: `helm upgrade ... --set token.value=<new>` (or edit the
   referenced `existingSecret`).
2. Update every MCP client's `PAGEDROP_K8S_TOKEN` to the new value.

Because there is a single shared token, rotate both sides close together;
requests with the old token return `401` after the pod restarts.

## Constraints

- Single writer: the PVC is `ReadWriteOnce` and the Deployment runs one replica
  (`Recreate` strategy). Not horizontally scalable without a `ReadWriteMany`
  volume or a database.
- `list`/`search` scan the data dir; suitable for hundreds–low-thousands of
  artifacts.
