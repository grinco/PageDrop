import { describe, it, expect, afterEach, vi } from "vitest";
import { loadPublisherConfigFromEnv } from "../../../src/adapters/google/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadPublisherConfigFromEnv", () => {
  const setAll = () => {
    vi.stubEnv("PAGEDROP_PUBLISHER_URL", "https://script.google.com/pub/exec");
    vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
    vi.stubEnv("PAGEDROP_PUBLISH_SECRET", "super-secret-value");
  };

  it("returns publisher, renderer, and secret when all are set", () => {
    setAll();
    const config = loadPublisherConfigFromEnv();
    expect(config).toEqual({
      publisherUrl: "https://script.google.com/pub/exec",
      rendererBaseUrl: "https://script.google.com/exec",
      secret: "super-secret-value",
    });
  });

  it("throws when PAGEDROP_PUBLISHER_URL is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_PUBLISHER_URL", undefined);
    expect(() => loadPublisherConfigFromEnv()).toThrow(/PAGEDROP_PUBLISHER_URL/);
  });

  it("throws when PAGEDROP_RENDERER_URL is missing", () => {
    setAll();
    vi.stubEnv("PAGEDROP_RENDERER_URL", undefined);
    expect(() => loadPublisherConfigFromEnv()).toThrow(/PAGEDROP_RENDERER_URL/);
  });

  it("throws when PAGEDROP_PUBLISH_SECRET is missing, without leaking any secret value", () => {
    setAll();
    vi.stubEnv("PAGEDROP_PUBLISH_SECRET", undefined);
    let thrown: unknown;
    try {
      loadPublisherConfigFromEnv();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("PAGEDROP_PUBLISH_SECRET");
    expect((thrown as Error).message).not.toContain("super-secret-value");
  });
});
