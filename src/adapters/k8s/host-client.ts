export class K8sHostError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "K8sHostError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RemoteItem {
  id: string;
  title: string;
  type: string;
  createdAt?: string;
  modifiedAt?: string;
  tags?: string[];
}

export class HostClient {
  private readonly fetchFn: FetchLike;
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.fetchFn = fetchFn;
  }

  private base(): string {
    return this.apiUrl.replace(/\/+$/, "");
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await this.fetchFn(`${this.base()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new K8sHostError(0, `host request timed out after ${this.timeoutMs}ms`);
      }
      throw new K8sHostError(0, `host request failed: ${(err as Error)?.message ?? err}`);
    }
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!res.ok) throw new K8sHostError(res.status, `host returned HTTP ${res.status}`);
        throw new K8sHostError(res.status, "malformed response from host");
      }
    }
    if (!res.ok) {
      const err = parsed.error as { message?: string } | undefined;
      throw new K8sHostError(res.status, err?.message ?? `host returned HTTP ${res.status}`);
    }
    return parsed;
  }

  async publish(body: { type: string; title: string; html: string; tags?: string[] }): Promise<{ id: string }> {
    return (await this.call("POST", "/publish", body)) as { id: string };
  }
  async update(id: string, body: { html: string; title?: string }): Promise<{ id: string }> {
    return (await this.call("PUT", `/artifacts/${encodeURIComponent(id)}`, body)) as { id: string };
  }
  async list(): Promise<{ items: RemoteItem[] }> {
    return (await this.call("GET", "/artifacts")) as unknown as { items: RemoteItem[] };
  }
  async search(q: string): Promise<{ items: RemoteItem[] }> {
    return (await this.call("GET", `/search?q=${encodeURIComponent(q)}`)) as unknown as { items: RemoteItem[] };
  }
}
