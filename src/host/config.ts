export interface HostConfig {
  token: string;
  dataDir: string;
  viewPort: number;
  apiPort: number;
}

export function loadHostConfigFromEnv(): HostConfig {
  const token = process.env.PAGEDROP_HOST_TOKEN;
  if (!token) {
    throw new Error("PAGEDROP_HOST_TOKEN is required (the write-API bearer token)");
  }
  return {
    token,
    dataDir: process.env.PAGEDROP_HOST_DATA_DIR ?? "/data",
    viewPort: Number(process.env.PAGEDROP_HOST_VIEW_PORT ?? "8080"),
    apiPort: Number(process.env.PAGEDROP_HOST_API_PORT ?? "8081"),
  };
}
