import { describe, it, expect, afterEach, vi } from "vitest";
import { OAuth2Client } from "google-auth-library";
import {
  loadGoogleConfigFromEnv,
  createOAuthClient,
  loadPublisherConfigFromEnv,
} from "../../../src/adapters/google/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadGoogleConfigFromEnv", () => {
  it("throws when PAGEDROP_RENDERER_URL is unset", () => {
    vi.stubEnv("PAGEDROP_RENDERER_URL", undefined);
    vi.stubEnv("PAGEDROP_FOLDER_NAME", undefined);
    expect(() => loadGoogleConfigFromEnv()).toThrow(/PAGEDROP_RENDERER_URL/);
  });

  it("defaults folderName to PageDrop when PAGEDROP_FOLDER_NAME is unset", () => {
    vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
    vi.stubEnv("PAGEDROP_FOLDER_NAME", undefined);
    const config = loadGoogleConfigFromEnv();
    expect(config.folderName).toBe("PageDrop");
    expect(config.rendererBaseUrl).toBe("https://script.google.com/exec");
  });

  it("honors PAGEDROP_FOLDER_NAME when set", () => {
    vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
    vi.stubEnv("PAGEDROP_FOLDER_NAME", "MyFolder");
    const config = loadGoogleConfigFromEnv();
    expect(config.folderName).toBe("MyFolder");
    expect(config.rendererBaseUrl).toBe("https://script.google.com/exec");
  });

  it("sets domain from PAGEDROP_DOMAIN when present", () => {
    vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
    vi.stubEnv("PAGEDROP_DOMAIN", "example.com");
    const config = loadGoogleConfigFromEnv();
    expect(config.domain).toBe("example.com");
  });

  it("leaves domain undefined when PAGEDROP_DOMAIN is unset", () => {
    vi.stubEnv("PAGEDROP_RENDERER_URL", "https://script.google.com/exec");
    vi.stubEnv("PAGEDROP_DOMAIN", undefined);
    const config = loadGoogleConfigFromEnv();
    expect(config.domain).toBeUndefined();
  });
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

describe("createOAuthClient", () => {
  it("throws when GOOGLE_CLIENT_ID is missing", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "dummy-secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "dummy-refresh-token");
    let thrown: unknown;
    try {
      createOAuthClient();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("GOOGLE_CLIENT_ID");
    expect(message).toContain("GOOGLE_CLIENT_SECRET");
    expect(message).toContain("GOOGLE_REFRESH_TOKEN");
    expect(message).not.toContain("dummy-secret");
    expect(message).not.toContain("dummy-refresh-token");
  });

  it("throws when GOOGLE_CLIENT_SECRET is missing", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "dummy-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "dummy-refresh-token");
    expect(() => createOAuthClient()).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("throws when GOOGLE_REFRESH_TOKEN is missing", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "dummy-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "dummy-secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", undefined);
    expect(() => createOAuthClient()).toThrow(/GOOGLE_REFRESH_TOKEN/);
  });

  it("returns an OAuth2Client instance without throwing when all vars are set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "dummy-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "dummy-secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "dummy-refresh-token");
    const client = createOAuthClient();
    expect(client).toBeInstanceOf(OAuth2Client);
  });
});
