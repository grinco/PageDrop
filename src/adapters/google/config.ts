export function buildViewUrl(base: string, fileId: string): string {
  const trimmed = base.replace(/[?&]$/, "");
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}id=${encodeURIComponent(fileId)}`;
}

export interface PublisherConfig {
  publisherUrl: string;
  rendererBaseUrl: string;
  secret: string;
}

/**
 * Config for the GCP-free Apps Script publisher path. Reads only the deployment
 * URLs and shared secret — no Google OAuth credentials.
 */
export function loadPublisherConfigFromEnv(): PublisherConfig {
  const { PAGEDROP_PUBLISHER_URL, PAGEDROP_RENDERER_URL, PAGEDROP_PUBLISH_SECRET } = process.env;
  const missing = [
    ["PAGEDROP_PUBLISHER_URL", PAGEDROP_PUBLISHER_URL],
    ["PAGEDROP_RENDERER_URL", PAGEDROP_RENDERER_URL],
    ["PAGEDROP_PUBLISH_SECRET", PAGEDROP_PUBLISH_SECRET],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing publisher env vars: ${missing.join(", ")}`);
  }
  return {
    publisherUrl: PAGEDROP_PUBLISHER_URL as string,
    rendererBaseUrl: PAGEDROP_RENDERER_URL as string,
    secret: PAGEDROP_PUBLISH_SECRET as string,
  };
}
