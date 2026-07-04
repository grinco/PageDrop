import { describe, it, expect, afterEach, vi } from "vitest";
import { loadHostConfigFromEnv } from "../../src/host/config";

afterEach(() => vi.unstubAllEnvs());

describe("loadHostConfigFromEnv", () => {
  it("returns defaults for dataDir and ports when only the token is set", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    vi.stubEnv("PAGEDROP_HOST_DATA_DIR", undefined);
    vi.stubEnv("PAGEDROP_HOST_VIEW_PORT", undefined);
    vi.stubEnv("PAGEDROP_HOST_API_PORT", undefined);
    expect(loadHostConfigFromEnv()).toEqual({
      token: "s3cret",
      dataDir: "/data",
      viewPort: 8080,
      apiPort: 8081,
    });
  });

  it("honors overrides", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    vi.stubEnv("PAGEDROP_HOST_DATA_DIR", "/srv/pagedrop");
    vi.stubEnv("PAGEDROP_HOST_VIEW_PORT", "9090");
    vi.stubEnv("PAGEDROP_HOST_API_PORT", "9091");
    const c = loadHostConfigFromEnv();
    expect(c.dataDir).toBe("/srv/pagedrop");
    expect(c.viewPort).toBe(9090);
    expect(c.apiPort).toBe(9091);
  });

  it("throws without leaking the token when PAGEDROP_HOST_TOKEN is unset", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", undefined);
    expect(() => loadHostConfigFromEnv()).toThrow(/PAGEDROP_HOST_TOKEN/);
  });
});
