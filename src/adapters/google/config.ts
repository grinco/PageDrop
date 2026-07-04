import { OAuth2Client } from "google-auth-library";

export interface GoogleConfig {
  folderName: string;
  rendererBaseUrl: string;
  domain?: string;
}

export function buildViewUrl(base: string, fileId: string): string {
  const trimmed = base.replace(/[?&]$/, "");
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}id=${encodeURIComponent(fileId)}`;
}

export function loadGoogleConfigFromEnv(): GoogleConfig {
  const rendererBaseUrl = process.env.PAGEDROP_RENDERER_URL;
  if (!rendererBaseUrl) {
    throw new Error("PAGEDROP_RENDERER_URL is required (the deployed Apps Script web app URL)");
  }
  return {
    folderName: process.env.PAGEDROP_FOLDER_NAME ?? "PageDrop",
    rendererBaseUrl,
    domain: process.env.PAGEDROP_DOMAIN,
  };
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

export function createOAuthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
    );
  }
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return client;
}
