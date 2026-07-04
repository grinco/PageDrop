import { describe, it, expect } from "vitest";
import { PublisherClient, PublisherError } from "../../../src/adapters/google/publisher-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("PublisherClient", () => {
  it("posts the secret and action merged with the payload, returning data on ok", async () => {
    const calls: { url: string; init: { method: string; body: string } }[] = [];
    const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, data: { id: "file-1", name: "X.html" } });
    };
    const client = new PublisherClient("https://pub/exec", "s3cret", fetchFn);

    const data = await client.call("publish", { type: "page", title: "X" });

    expect(data).toEqual({ id: "file-1", name: "X.html" });
    expect(calls[0].url).toBe("https://pub/exec");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      secret: "s3cret",
      action: "publish",
      type: "page",
      title: "X",
    });
  });

  it("throws PublisherError carrying the envelope error code on ok:false", async () => {
    const fetchFn = async () =>
      jsonResponse({ ok: false, error: { code: "unauthorized", message: "nope" } });
    const client = new PublisherClient("https://pub/exec", "bad", fetchFn);

    await expect(client.call("list", {})).rejects.toMatchObject({
      code: "unauthorized",
      message: "nope",
    });
  });

  it("throws on a non-200 response", async () => {
    const fetchFn = async () => new Response("<html>server error</html>", { status: 500 });
    const client = new PublisherClient("https://pub/exec", "s", fetchFn);

    await expect(client.call("list", {})).rejects.toBeInstanceOf(PublisherError);
  });

  it("throws on a non-JSON body", async () => {
    const fetchFn = async () => new Response("not json at all", { status: 200 });
    const client = new PublisherClient("https://pub/exec", "s", fetchFn);

    await expect(client.call("list", {})).rejects.toThrow(/malformed/i);
  });

  it("passes an abort signal so a hung request cannot block forever", async () => {
    let seenSignal: unknown;
    const fetchFn = async (_url: string, init: { signal?: unknown }) => {
      seenSignal = init.signal;
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    };
    const client = new PublisherClient("https://pub/exec", "s", fetchFn);
    await client.call("list", {});
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("wraps a network failure or timeout in a PublisherError", async () => {
    const fetchFn = async () => {
      throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    };
    const client = new PublisherClient("https://pub/exec", "s", fetchFn);
    await expect(client.call("list", {})).rejects.toBeInstanceOf(PublisherError);
    await expect(client.call("list", {})).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps a generic (non-timeout) network failure to an internal PublisherError", async () => {
    const fetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new PublisherClient("https://pub/exec", "s", fetchFn);
    await expect(client.call("list", {})).rejects.toMatchObject({ code: "internal" });
  });
});
