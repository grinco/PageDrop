import { describe, it, expect } from "vitest";
import { registerTools } from "../../src/mcp/tools";
import { PublishService } from "../../src/core/publish-service";
import { FakePublisher } from "../fakes/fake-publisher";

function makeHost() {
  const names: string[] = [];
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const host = {
    tool(name: string, _desc: string, _schema: Record<string, unknown>, handler: any) {
      names.push(name);
      handlers[name] = handler;
    },
  };
  return { host, names, handlers };
}

describe("registerTools", () => {
  it("registers all six PageDrop tools", () => {
    const { host, names } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    expect(names.sort()).toEqual(
      [
        "pagedrop_list",
        "pagedrop_publish_deck",
        "pagedrop_publish_doc",
        "pagedrop_publish_page",
        "pagedrop_republish",
        "pagedrop_search",
      ].sort(),
    );
  });

  it("publish_doc handler returns links in its text content", async () => {
    const { host, handlers } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    const out = await handlers["pagedrop_publish_doc"]({ title: "R", markdown: "# hi" });
    expect(out.content[0].type).toBe("text");
    expect(out.content[0].text).toContain("https://edit");
  });

  it("describes public sharing accurately", async () => {
    const { host, handlers } = makeHost();
    const publisher = new FakePublisher();
    publisher.sharing = "public";
    registerTools(host, new PublishService(publisher));
    const out = await handlers["pagedrop_publish_doc"]({ title: "R", markdown: "# hi" });
    expect(out.content[0].text).toContain("publicly");
  });

  it("describes domain sharing accurately", async () => {
    const { host, handlers } = makeHost();
    const publisher = new FakePublisher();
    publisher.sharing = "domain";
    registerTools(host, new PublishService(publisher));
    const out = await handlers["pagedrop_publish_doc"]({ title: "R", markdown: "# hi" });
    expect(out.content[0].text).toContain("organization");
  });
});
