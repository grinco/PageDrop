export interface HostConfig {
  token: string;
  dataDir: string;
  viewPort: number;
  apiPort: number;
  /** Global default TTL applied when a publish omits ttlSeconds. Undefined = never. */
  defaultTtlSeconds?: number;
  /** How often the background reaper sweeps expired artifacts, in seconds. */
  reaperIntervalSeconds: number;
  /** Secret for signing unlock cookies. Undefined = random per-process fallback. */
  cookieSecret?: string;
  /** When true, publishes without an explicit password get an auto-generated one. */
  defaultProtect: boolean;
}

function boolEnv(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

function numEnv(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function loadHostConfigFromEnv(): HostConfig {
  const token = process.env.PAGEDROP_HOST_TOKEN;
  if (!token) {
    throw new Error("PAGEDROP_HOST_TOKEN is required (the write-API bearer token)");
  }

  const cookieSecret = process.env.PAGEDROP_COOKIE_SECRET || undefined;
  const defaultProtect = boolEnv(process.env.PAGEDROP_DEFAULT_PROTECT);
  if (defaultProtect && !cookieSecret) {
    // Default-protect makes password gating load-bearing; a per-process cookie
    // secret would break unlock sessions across a rolling deploy or any replica.
    throw new Error(
      "PAGEDROP_COOKIE_SECRET is required when PAGEDROP_DEFAULT_PROTECT is enabled",
    );
  }

  return {
    token,
    dataDir: process.env.PAGEDROP_HOST_DATA_DIR ?? "/data",
    viewPort: Number(process.env.PAGEDROP_HOST_VIEW_PORT ?? "8080"),
    apiPort: Number(process.env.PAGEDROP_HOST_API_PORT ?? "8081"),
    defaultTtlSeconds: numEnv(process.env.PAGEDROP_DEFAULT_TTL_SECONDS),
    reaperIntervalSeconds: numEnv(process.env.PAGEDROP_REAPER_INTERVAL_SECONDS) ?? 300,
    cookieSecret,
    defaultProtect,
  };
}
