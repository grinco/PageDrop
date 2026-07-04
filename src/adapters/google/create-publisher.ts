import type { Publisher } from "../../core/types";
import { AppsScriptPublisher } from "./apps-script-publisher";
import { PublisherClient } from "./publisher-client";
import { GoogleAdapter } from "./google-adapter";
import { GoogleDriveClient } from "./google-drive-client";
import { GoogleSlidesClient } from "./google-slides-client";
import { createOAuthClient, loadGoogleConfigFromEnv, loadPublisherConfigFromEnv } from "./config";

export type Backend = "appsscript" | "gcp";

/**
 * Builds the configured {@link Publisher} backend.
 *
 * `PAGEDROP_BACKEND` selects between:
 *  - `appsscript` (default) — the GCP-free Apps Script publisher web app.
 *  - `gcp` — the direct Drive/Slides API path via a Google Cloud OAuth client.
 */
export function createPublisher(): Publisher {
  const backend = (process.env.PAGEDROP_BACKEND ?? "appsscript").trim().toLowerCase();
  switch (backend) {
    case "":
    case "appsscript": {
      const config = loadPublisherConfigFromEnv();
      const client = new PublisherClient(config.publisherUrl, config.secret);
      return new AppsScriptPublisher(client, { rendererBaseUrl: config.rendererBaseUrl });
    }
    case "gcp": {
      const auth = createOAuthClient();
      const config = loadGoogleConfigFromEnv();
      return new GoogleAdapter(
        new GoogleDriveClient(auth, config.domain),
        config,
        new GoogleSlidesClient(auth),
      );
    }
    default:
      throw new Error(
        `Unknown PAGEDROP_BACKEND "${backend}"; valid values are "appsscript" (default) or "gcp"`,
      );
  }
}
