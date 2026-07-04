export type PublisherErrorCode =
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "unsupported"
  | "timeout"
  | "internal";

const DEFAULT_TIMEOUT_MS = 30_000;

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
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
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
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.fetchFn = fetchFn;
  }

  async call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: this.secret, action, ...payload }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new PublisherError("timeout", `publisher request timed out after ${this.timeoutMs}ms`);
      }
      throw new PublisherError("internal", `publisher request failed: ${(err as Error)?.message ?? err}`);
    }
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
