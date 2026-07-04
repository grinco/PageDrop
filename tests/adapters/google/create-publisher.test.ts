import { describe, it, expect, afterEach, vi } from "vitest";
import { createPublisher } from "../../../src/adapters/google/create-publisher";
import { AppsScriptPublisher } from "../../../src/adapters/google/apps-script-publisher";
import { GoogleAdapter } from "../../../src/adapters/google/google-adapter";
import { KubernetesPublisher } from "../../../src/adapters/k8s/kubernetes-publisher";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubAppsScriptEnv() {
  vi.stubEnv("PAGEDROP_PUBLISHER_URL", "https://script.google.com/pub/exec");
  vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
  vi.stubEnv("PAGEDROP_PUBLISH_SECRET", "a-secret");
}

function stubGcpEnv() {
  vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
  vi.stubEnv("GOOGLE_CLIENT_ID", "dummy-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "dummy-secret");
  vi.stubEnv("GOOGLE_REFRESH_TOKEN", "dummy-token");
}

describe("createPublisher", () => {
  it("defaults to the Apps Script backend when PAGEDROP_BACKEND is unset", () => {
    vi.stubEnv("PAGEDROP_BACKEND", undefined);
    stubAppsScriptEnv();
    expect(createPublisher()).toBeInstanceOf(AppsScriptPublisher);
  });

  it("selects the Apps Script backend for 'appsscript'", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "appsscript");
    stubAppsScriptEnv();
    expect(createPublisher()).toBeInstanceOf(AppsScriptPublisher);
  });

  it("selects the GCP backend for 'gcp'", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "gcp");
    stubGcpEnv();
    expect(createPublisher()).toBeInstanceOf(GoogleAdapter);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "  GCP ");
    stubGcpEnv();
    expect(createPublisher()).toBeInstanceOf(GoogleAdapter);
  });

  it("throws a clear error naming the valid values for an unknown backend", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "sharepoint");
    expect(() => createPublisher()).toThrow(/PAGEDROP_BACKEND.*appsscript.*gcp/is);
  });
});

function stubK8sEnv() {
  vi.stubEnv("PAGEDROP_K8S_API_URL", "https://api.internal/api");
  vi.stubEnv("PAGEDROP_K8S_BASE_URL", "https://pagedrop.internal");
  vi.stubEnv("PAGEDROP_K8S_TOKEN", "tok");
}

describe("createPublisher — kubernetes", () => {
  it("selects the Kubernetes backend for 'kubernetes'", () => {
    vi.stubEnv("PAGEDROP_BACKEND", "kubernetes");
    stubK8sEnv();
    expect(createPublisher()).toBeInstanceOf(KubernetesPublisher);
  });
});
