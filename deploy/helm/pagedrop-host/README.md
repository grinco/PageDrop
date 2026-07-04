# pagedrop-host Helm chart

Deploys the PageDrop Kubernetes static-host backend: a single pod serving
rendered artifacts on a viewing port (`:8080`, place behind your SSO proxy) and
a token-gated write API (`:8081`, reached by the PageDrop MCP server).

## Install

```
helm install pagedrop deploy/helm/pagedrop-host \
  --set image.repository=<your-registry>/pagedrop-host \
  --set image.tag=0.1.0 \
  --set token.value=$(openssl rand -hex 32) \
  --set viewIngress.host=pagedrop.internal.example.com
```

Set the same token as `PAGEDROP_K8S_TOKEN` in the MCP server's environment
(`PAGEDROP_BACKEND=kubernetes`, `PAGEDROP_K8S_API_URL`, `PAGEDROP_K8S_BASE_URL`).

## Putting viewing behind SSO (worked example: oauth2-proxy)

Inject your proxy's annotations onto the viewing ingress only:

```
--set-json 'viewIngress.annotations={"nginx.ingress.kubernetes.io/auth-url":"https://oauth2-proxy.internal/oauth2/auth","nginx.ingress.kubernetes.io/auth-signin":"https://oauth2-proxy.internal/oauth2/start?rd=$escaped_request_uri"}'
```

The API ingress must NOT carry these annotations — the headless MCP server
cannot complete interactive SSO. Keep `apiIngress.enabled=false` and reach the
Service in-cluster when possible, or restrict it via `networkPolicy.allowedCIDRs`
and a private load balancer.

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
