export interface K8sConfig {
  apiUrl: string;
  baseUrl: string;
  token: string;
}

export function loadK8sConfigFromEnv(): K8sConfig {
  const { PAGEDROP_K8S_API_URL, PAGEDROP_K8S_BASE_URL, PAGEDROP_K8S_TOKEN } = process.env;
  const missing = [
    ["PAGEDROP_K8S_API_URL", PAGEDROP_K8S_API_URL],
    ["PAGEDROP_K8S_BASE_URL", PAGEDROP_K8S_BASE_URL],
    ["PAGEDROP_K8S_TOKEN", PAGEDROP_K8S_TOKEN],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing k8s backend env vars: ${missing.join(", ")}`);
  return {
    apiUrl: PAGEDROP_K8S_API_URL as string,
    baseUrl: PAGEDROP_K8S_BASE_URL as string,
    token: PAGEDROP_K8S_TOKEN as string,
  };
}
