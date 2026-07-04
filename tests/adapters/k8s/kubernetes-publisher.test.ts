import { describe, it, expect } from "vitest";
import { KubernetesPublisher } from "../../../src/adapters/k8s/kubernetes-publisher";
import type { HostClient } from "../../../src/adapters/k8s/host-client";

class FakeHost {
  public calls: { m: string; args: unknown[] }[] = [];
  publishReturn: { id: string; password?: string } = { id: "q3-abc123" };
  protectReturn: { id: string; password?: string } = { id: "a" };
  getReturn: { id: string; title: string; type: string } = { id: "q3-abc123", title: "Q3", type: "page" };
  async publish(body: unknown) { this.calls.push({ m: "publish", args: [body] }); return this.publishReturn; }
  async get(id: string) { this.calls.push({ m: "get", args: [id] }); return this.getReturn; }
  async update(id: string, body: unknown) { this.calls.push({ m: "update", args: [id, body] }); return { id }; }
  async delete(id: string) { this.calls.push({ m: "delete", args: [id] }); }
  async setProtection(id: string, body: unknown) { this.calls.push({ m: "setProtection", args: [id, body] }); return this.protectReturn; }
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

  it("updates a page verbatim and returns the stable view URL", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.update("q3-abc123", "<h1>new</h1>");
    expect(host.last().m).toBe("update");
    const body = host.last().args[1] as { html: string };
    expect(body.html).toContain("<h1>new</h1>");
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/q3-abc123");
  });

  it("re-renders a doc's Markdown on republish (looks up the artifact's type first)", async () => {
    const host = new FakeHost();
    host.getReturn = { id: "notes-abc123", title: "Notes", type: "doc" };
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await pub.update("notes-abc123", "# Hi\n\ntext");
    expect(host.calls.map((c) => c.m)).toEqual(["get", "update"]);
    const body = host.last().args[1] as { html: string };
    expect(body.html).toContain("<h1>Hi</h1>");
    expect(body.html).not.toContain("# Hi");
    expect(body.html).toContain("<title>Notes</title>");
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

  it("forwards ttlSeconds/password on publish and surfaces a generated password", async () => {
    const host = new FakeHost();
    host.publishReturn = { id: "q3-abc123", password: "river-cloud7moon.stone" };
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.publish({ type: "page", title: "Q3", content: "<h1>x</h1>", ttlSeconds: 60, password: "opensesame" });
    const body = host.last().args[0] as { ttlSeconds?: number; password?: string };
    expect(body.ttlSeconds).toBe(60);
    expect(body.password).toBe("opensesame");
    expect(res.password).toBe("river-cloud7moon.stone");
  });

  it("delegates delete to the host", async () => {
    const host = new FakeHost();
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    await pub.delete("q3-abc123");
    expect(host.last()).toEqual({ m: "delete", args: ["q3-abc123"] });
  });

  it("delegates setProtection and returns a generated password with the view URL", async () => {
    const host = new FakeHost();
    host.protectReturn = { id: "a", password: "river-cloud7moon.stone" };
    const pub = new KubernetesPublisher(host as unknown as HostClient, config);
    const res = await pub.setProtection("a", { password: null, ttlSeconds: 3600 });
    expect(host.last()).toEqual({ m: "setProtection", args: ["a", { password: null, ttlSeconds: 3600 }] });
    expect(res.viewUrl).toBe("https://pagedrop.internal/p/a");
    expect(res.password).toBe("river-cloud7moon.stone");
  });
});
