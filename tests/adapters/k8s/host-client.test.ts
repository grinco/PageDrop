import { describe, it, expect } from "vitest";
import { HostClient, K8sHostError } from "../../../src/adapters/k8s/host-client";

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("HostClient", () => {
  it("POSTs publish with a bearer header and returns the id", async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, init });
      return res({ id: "q3-abc123" }, 201);
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    const out = await client.publish({ type: "page", title: "Q3", html: "<h1>x</h1>" });
    expect(out).toEqual({ id: "q3-abc123" });
    expect(calls[0].url).toBe("https://api.internal/api/publish");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ type: "page", title: "Q3", html: "<h1>x</h1>" });
  });

  it("maps a non-2xx response to K8sHostError carrying the status", async () => {
    const fetchFn = async () => res({ error: { code: "not_found", message: "nope" } }, 404);
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await expect(client.update("missing", { html: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(client.update("missing", { html: "x" })).rejects.toBeInstanceOf(K8sHostError);
  });

  it("lists and searches", async () => {
    const fetchFn = async (url: string) =>
      res({ items: [{ id: "a", title: "A", type: "page" }] });
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    expect((await client.list()).items).toHaveLength(1);
    expect((await client.search("a")).items[0].id).toBe("a");
  });

  it("passes an abort signal so a hung request cannot block forever", async () => {
    let seenSignal: unknown;
    const fetchFn = async (_url: string, init: { signal?: unknown }) => {
      seenSignal = init.signal;
      return res({ items: [] });
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await client.list();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("wraps a network failure or timeout in a K8sHostError", async () => {
    const fetchFn = async () => {
      throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await expect(client.list()).rejects.toBeInstanceOf(K8sHostError);
  });

  it("maps a generic (non-timeout) network failure to a K8sHostError", async () => {
    const fetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await expect(client.list()).rejects.toBeInstanceOf(K8sHostError);
  });

  it("forwards ttlSeconds and password on publish and returns a generated password", async () => {
    let sent: unknown;
    const fetchFn = async (_url: string, init: { body?: string }) => {
      sent = JSON.parse(init.body as string);
      return res({ id: "q3-abc123", password: "river-cloud7moon.stone" }, 201);
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    const out = await client.publish({ type: "page", title: "Q3", html: "<h1>x</h1>", ttlSeconds: 60, password: "opensesame" });
    expect(sent).toMatchObject({ ttlSeconds: 60, password: "opensesame" });
    expect(out.password).toBe("river-cloud7moon.stone");
  });

  it("DELETEs an artifact by id", async () => {
    const calls: { url: string; init: { method: string } }[] = [];
    const fetchFn = async (url: string, init: { method: string }) => {
      calls.push({ url, init });
      return res({ id: "gone-1" });
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    await client.delete("gone-1");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe("https://api.internal/api/artifacts/gone-1");
  });

  it("POSTs setProtection to the /protect subresource", async () => {
    const calls: { url: string; init: { method: string; body?: string } }[] = [];
    const fetchFn = async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, init });
      return res({ id: "p1", password: "gen" });
    };
    const client = new HostClient("https://api.internal/api", "tok", fetchFn);
    const out = await client.setProtection("p1", { password: null, ttlSeconds: 60 });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe("https://api.internal/api/artifacts/p1/protect");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ password: null, ttlSeconds: 60 });
    expect(out.password).toBe("gen");
  });
});
