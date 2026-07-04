import { describe, it, expect, afterEach, vi } from "vitest";
import { loadHostConfigFromEnv } from "../../src/host/config";

afterEach(() => vi.unstubAllEnvs());

const clearOptional = () => {
  for (const k of [
    "PAGEDROP_HOST_DATA_DIR", "PAGEDROP_HOST_VIEW_PORT", "PAGEDROP_HOST_API_PORT",
    "PAGEDROP_DEFAULT_TTL_SECONDS", "PAGEDROP_REAPER_INTERVAL_SECONDS",
    "PAGEDROP_COOKIE_SECRET", "PAGEDROP_DEFAULT_PROTECT",
  ]) vi.stubEnv(k, undefined);
};

describe("loadHostConfigFromEnv", () => {
  it("returns defaults when only the token is set", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    clearOptional();
    expect(loadHostConfigFromEnv()).toEqual({
      token: "s3cret",
      dataDir: "/data",
      viewPort: 8080,
      apiPort: 8081,
      defaultTtlSeconds: undefined,
      reaperIntervalSeconds: 300,
      cookieSecret: undefined,
      defaultProtect: false,
    });
  });

  it("honors overrides", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    vi.stubEnv("PAGEDROP_HOST_DATA_DIR", "/srv/pagedrop");
    vi.stubEnv("PAGEDROP_HOST_VIEW_PORT", "9090");
    vi.stubEnv("PAGEDROP_HOST_API_PORT", "9091");
    vi.stubEnv("PAGEDROP_DEFAULT_TTL_SECONDS", "3600");
    vi.stubEnv("PAGEDROP_REAPER_INTERVAL_SECONDS", "60");
    vi.stubEnv("PAGEDROP_COOKIE_SECRET", "cookie-secret");
    vi.stubEnv("PAGEDROP_DEFAULT_PROTECT", "true");
    const c = loadHostConfigFromEnv();
    expect(c.dataDir).toBe("/srv/pagedrop");
    expect(c.viewPort).toBe(9090);
    expect(c.apiPort).toBe(9091);
    expect(c.defaultTtlSeconds).toBe(3600);
    expect(c.reaperIntervalSeconds).toBe(60);
    expect(c.cookieSecret).toBe("cookie-secret");
    expect(c.defaultProtect).toBe(true);
  });

  it("throws without leaking the token when PAGEDROP_HOST_TOKEN is unset", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", undefined);
    expect(() => loadHostConfigFromEnv()).toThrow(/PAGEDROP_HOST_TOKEN/);
  });

  it("fails fast when defaultProtect is on but no cookie secret is set", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    clearOptional();
    vi.stubEnv("PAGEDROP_DEFAULT_PROTECT", "true");
    expect(() => loadHostConfigFromEnv()).toThrow(/PAGEDROP_COOKIE_SECRET/);
  });

  it("allows defaultProtect when a cookie secret is provided", () => {
    vi.stubEnv("PAGEDROP_HOST_TOKEN", "s3cret");
    clearOptional();
    vi.stubEnv("PAGEDROP_DEFAULT_PROTECT", "true");
    vi.stubEnv("PAGEDROP_COOKIE_SECRET", "shared");
    expect(loadHostConfigFromEnv().defaultProtect).toBe(true);
  });
});
