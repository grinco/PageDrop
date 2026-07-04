import { describe, it, expect } from "vitest";
import { AppsScriptPublisher } from "../../../src/adapters/google/apps-script-publisher";
import type { PublisherRpc } from "../../../src/adapters/google/publisher-client";

class FakeRpc implements PublisherRpc {
  public calls: { action: string; payload: Record<string, unknown> }[] = [];
  public responses: Record<string, Record<string, unknown>> = {};
  async call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ action, payload });
    return this.responses[action] ?? {};
  }
  last() {
    return this.calls[this.calls.length - 1];
  }
}

const config = { rendererBaseUrl: "https://script.google.com/exec" };

describe("AppsScriptPublisher — publish", () => {
  it("sends a page as wrapped HTML and composes a renderer view URL", async () => {
    const rpc = new FakeRpc();
    rpc.responses.publish = { id: "file-1", type: "page", sharing: "domain" };
    const publisher = new AppsScriptPublisher(rpc, config);

    const res = await publisher.publish({ type: "page", title: "Dashboard", content: "<h1>x</h1>" });

    const { action, payload } = rpc.last();
    expect(action).toBe("publish");
    expect(payload.type).toBe("page");
    expect(payload.title).toBe("Dashboard");
    expect(payload.scope).toBe("domain");
    expect(String(payload.html)).toContain("<h1>x</h1>");
    expect(String(payload.html).toLowerCase()).toContain("<!doctype html>");
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toBeUndefined();
    expect(res.sharing).toBe("domain");
  });

  it("renders a doc's Markdown to HTML before wrapping", async () => {
    const rpc = new FakeRpc();
    rpc.responses.publish = { id: "file-2", type: "doc" };
    const publisher = new AppsScriptPublisher(rpc, config);

    const res = await publisher.publish({ type: "doc", title: "Notes", content: "# Hi\n\ntext" });

    expect(String(rpc.last().payload.html)).toContain("<h1>Hi</h1>");
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-2");
  });

  it("passes through the sharing scope the server reports", async () => {
    const rpc = new FakeRpc();
    rpc.responses.publish = { id: "file-3", sharing: "public" };
    const publisher = new AppsScriptPublisher(rpc, config);

    const res = await publisher.publish({ type: "page", title: "P", content: "<p>x</p>" });

    expect(res.sharing).toBe("public");
  });
});

describe("AppsScriptPublisher — update", () => {
  it("sends wrapped HTML for an id and returns the stable view URL", async () => {
    const rpc = new FakeRpc();
    rpc.responses.update = { id: "file-1", name: "P.html" };
    const publisher = new AppsScriptPublisher(rpc, config);

    const res = await publisher.update("file-1", "<h1>new</h1>");

    const { action, payload } = rpc.last();
    expect(action).toBe("update");
    expect(payload.id).toBe("file-1");
    expect(String(payload.html)).toContain("<h1>new</h1>");
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
  });
});

describe("AppsScriptPublisher — list/search", () => {
  it("maps listed items to refs with composed view URLs and preserved types", async () => {
    const rpc = new FakeRpc();
    rpc.responses.list = {
      items: [
        { id: "a", title: "Page A", type: "page" },
        { id: "b", title: "Doc B", type: "doc" },
      ],
    };
    const publisher = new AppsScriptPublisher(rpc, config);

    const refs = await publisher.list();

    expect(refs).toEqual([
      { id: "a", title: "Page A", type: "page", viewUrl: "https://script.google.com/exec?id=a" },
      { id: "b", title: "Doc B", type: "doc", viewUrl: "https://script.google.com/exec?id=b" },
    ]);
  });

  it("forwards the query to the search action", async () => {
    const rpc = new FakeRpc();
    rpc.responses.search = { items: [{ id: "a", title: "Budget", type: "page" }] };
    const publisher = new AppsScriptPublisher(rpc, config);

    const hits = await publisher.search("budget");

    expect(rpc.last()).toEqual({ action: "search", payload: { query: "budget" } });
    expect(hits[0].title).toBe("Budget");
    expect(hits[0].viewUrl).toBe("https://script.google.com/exec?id=a");
  });
});

describe("AppsScriptPublisher — setSharing", () => {
  it("forwards id and scope to the setSharing action", async () => {
    const rpc = new FakeRpc();
    const publisher = new AppsScriptPublisher(rpc, config);

    await publisher.setSharing("file-1", "domain");

    expect(rpc.last()).toEqual({ action: "setSharing", payload: { id: "file-1", scope: "domain" } });
  });
});
