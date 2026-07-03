import { describe, it, expect } from "vitest";
import { PublishService } from "../../src/core/publish-service";
import { FakePublisher } from "../fakes/fake-publisher";

describe("PublishService", () => {
  it("publishes a doc with the right artifact type and default domain scope", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    const res = await svc.publishDoc("Report", "# Hi", ["q3"]);
    expect(res.id).toBe("file-1");
    expect(fake.published[0].artifact.type).toBe("doc");
    expect(fake.published[0].artifact.tags).toEqual(["q3"]);
    expect(fake.published[0].scope).toBe("domain");
  });

  it("publishes page and deck with matching types", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    await svc.publishPage("P", "<h1>x</h1>");
    await svc.publishDeck("D", "<section>s</section>");
    expect(fake.published.map((p) => p.artifact.type)).toEqual(["page", "deck"]);
  });

  it("rejects empty title or content", async () => {
    const svc = new PublishService(new FakePublisher());
    await expect(svc.publishDoc("  ", "x")).rejects.toThrow(/title/i);
    await expect(svc.publishDoc("T", "  ")).rejects.toThrow(/content/i);
  });

  it("republishes by id", async () => {
    const fake = new FakePublisher();
    const svc = new PublishService(fake);
    await svc.republish("file-9", "<h1>new</h1>");
    expect(fake.updated[0]).toEqual({ id: "file-9", content: "<h1>new</h1>" });
  });

  it("rejects empty search query", async () => {
    const svc = new PublishService(new FakePublisher());
    await expect(svc.search("  ")).rejects.toThrow(/query/i);
  });
});
