import { describe, it, expect, afterEach, vi } from "vitest";
import { loadK8sConfigFromEnv } from "../../../src/adapters/k8s/config";

afterEach(() => vi.unstubAllEnvs());

function setAll() {
  vi.stubEnv("PAGEDROP_K8S_API_URL", "https://pagedrop-api.internal/api");
  vi.stubEnv("PAGEDROP_K8S_BASE_URL", "https://pagedrop.internal");
  vi.stubEnv("PAGEDROP_K8S_TOKEN", "super-secret");
}

describe("loadK8sConfigFromEnv", () => {
  it("returns all three values when set", () => {
    setAll();
    expect(loadK8sConfigFromEnv()).toEqual({
      apiUrl: "https://pagedrop-api.internal/api",
      baseUrl: "https://pagedrop.internal",
      token: "super-secret",
    });
  });

  it("throws without leaking the token when PAGEDROP_K8S_TOKEN is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_K8S_TOKEN", undefined);
    let thrown: unknown;
    try { loadK8sConfigFromEnv(); } catch (e) { thrown = e; }
    expect((thrown as Error).message).toContain("PAGEDROP_K8S_TOKEN");
    expect((thrown as Error).message).not.toContain("super-secret");
  });

  it("throws when PAGEDROP_K8S_API_URL is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_K8S_API_URL", undefined);
    expect(() => loadK8sConfigFromEnv()).toThrow(/PAGEDROP_K8S_API_URL/);
  });
});
