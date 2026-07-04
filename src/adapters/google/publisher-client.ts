export type PublisherErrorCode =
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "unsupported"
  | "internal";

export class PublisherError extends Error {
  constructor(
    public readonly code: PublisherErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = "PublisherError";
  }
}

/** Minimal shape of `fetch` we depend on — keeps us off the DOM lib types. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** RPC the {@link AppsScriptPublisher} depends on. */
export interface PublisherRpc {
  call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Transport to the Apps Script publisher web app. POSTs `{secret, action, ...payload}`
 * as JSON, unwraps the `{ok, data|error}` envelope, and throws {@link PublisherError}
 * on `ok:false`, a non-200 status, or a non-JSON body.
 */
export class PublisherClient implements PublisherRpc {
  private readonly fetchFn: FetchLike;

  constructor(
    private readonly url: string,
    private readonly secret: string,
    fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {
    this.fetchFn = fetchFn;
  }

  async call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: this.secret, action, ...payload }),
    });
    if (!res.ok) {
      throw new PublisherError("internal", `publisher returned HTTP ${res.status}`);
    }
    const text = await res.text();
    let env: { ok?: unknown; data?: unknown; error?: { code?: string; message?: string } };
    try {
      env = JSON.parse(text);
    } catch {
      throw new PublisherError("internal", "malformed response from publisher (not JSON)");
    }
    if (!env || typeof env.ok !== "boolean") {
      throw new PublisherError("internal", "malformed response from publisher (no ok field)");
    }
    if (!env.ok) {
      throw new PublisherError(env.error?.code ?? "internal", env.error?.message ?? "publisher error");
    }
    return (env.data ?? {}) as Record<string, unknown>;
  }
}
