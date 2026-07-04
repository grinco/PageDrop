import { describe, it, expect } from "vitest";
import { KubernetesPublisher } from "../../../src/adapters/k8s/kubernetes-publisher";
import type { HostClient } from "../../../src/adapters/k8s/host-client";

class FakeHost {
  public calls: { m: string; args: unknown[] }[] = [];
  publishReturn = { id: "q3-abc123" };
  async publish(body: unknown) { this.calls.push({ m: "publish", args: [body] }); return this.publishReturn; }
  async update(id: string, body: unknown) { this.calls.push({ m: "update", args: [id, body] }); return { id }; }
  async list() { this.calls.push({ m: "list", args: [] }); return { items: [{ id: "a", title: "A", type: "page" }] }; }
  async search(q: string) { this.calls.push({ m: "search", args: [q] }); return { items: [{ id: "a", title: "A", type: "page" }] }; }
  last() { return this.calls[this.calls.length - 1]; }
}

const config = { baseUrl: "https://pagedrop.internal" };

describe("KubernetesPublisher", () => {
  it("publishes a page as wrapped HTML and composes a /p/ view URL", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.publish({ type: "page", title: "Q3", content: "<h1>x</h1>" });
    const body = host.last().args[0] as { type: string; title: string; html: string };
    expect(body.type).toBe("page");
    expect(body.html).toContain("<h1>x</h1>");
    expect(body.html.toLowerCase()).toContain("<!doctype html>");
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/q3-abc123");
    expect(res.editUrl).toBeUndefined();
    expect(res.sharing).toBe("domain");
  });

  it("renders a doc's Markdown before wrapping", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await pub.publish({ type: "doc", title: "Notes", content: "# Hi\n\ntext" });
    const body = host.last().args[0] as { html: string };
    expect(body.html).toContain("<h1>Hi</h1>");
  });

  it("updates and returns the stable view URL", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.update("q3-abc123", "<h1>new</h1>");
    expect(host.last().m).toBe("update");
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/q3-abc123");
  });

  it("maps list/search to refs with composed view URLs", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    expect(await pub.list()).toEqual([
      { id: "a", title: "A", type: "page", viewUrl: "https://pagedrop.internal/p/a" },
    ]);
    expect((await pub.search("a"))[0].viewUrl).toBe("https://pagedrop.internal/p/a");
  });

  it("treats setSharing('domain') as a no-op and rejects public", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await expect(pub.setSharing("a", "domain")).resolves.toBeUndefined();
    await expect(pub.setSharing("a", "public")).rejects.toThrow(/unsupported/i);
  });
});
