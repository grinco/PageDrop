import type { Publisher } from "../../core/types";
import { AppsScriptPublisher } from "./apps-script-publisher";
import { PublisherClient } from "./publisher-client";
import { GoogleAdapter } from "./google-adapter";
import { GoogleDriveClient } from "./google-drive-client";
import { GoogleSlidesClient } from "./google-slides-client";
import { createOAuthClient, loadGoogleConfigFromEnv, loadPublisherConfigFromEnv } from "./config";
import { KubernetesPublisher } from "../k8s/kubernetes-publisher";
import { HostClient } from "../k8s/host-client";
import { loadK8sConfigFromEnv } from "../k8s/config";

export type Backend = "appsscript" | "gcp" | "kubernetes";

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
    case "kubernetes": {
      const config = loadK8sConfigFromEnv();
      const client = new HostClient(config.apiUrl, config.token);
      return new KubernetesPublisher(client, { baseUrl: config.baseUrl });
    }
    default:
      throw new Error(
        `Unknown PAGEDROP_BACKEND "${backend}"; valid values are "appsscript" (default), "gcp", or "kubernetes"`,
      );
  }
}
