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
