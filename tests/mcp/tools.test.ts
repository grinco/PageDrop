import { describe, it, expect } from "vitest";
import { registerTools } from "../../src/mcp/tools";
import { PublishService } from "../../src/core/publish-service";
import { FakePublisher } from "../fakes/fake-publisher";

function makeHost() {
  const names: string[] = [];
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const descriptions: Record<string, string> = {};
  const schemas: Record<string, Record<string, any>> = {};
  const host = {
    tool(name: string, desc: string, schema: Record<string, unknown>, handler: any) {
      names.push(name);
      descriptions[name] = desc;
      schemas[name] = schema;
      handlers[name] = handler;
    },
  };
  return { host, names, handlers, descriptions, schemas };
}

describe("registerTools", () => {
  it("registers all PageDrop tools", () => {
    const { host, names } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    expect(names.sort()).toEqual(
      [
        "pagedrop_delete",
        "pagedrop_list",
        "pagedrop_protect",
        "pagedrop_publish_deck",
        "pagedrop_publish_doc",
        "pagedrop_publish_page",
        "pagedrop_republish",
        "pagedrop_search",
      ].sort(),
    );
  });

  it("delete handler removes by id", async () => {
    const { host, handlers } = makeHost();
    const fake = new FakePublisher();
    registerTools(host, new PublishService(fake));
    const out = await handlers["pagedrop_delete"]({ id: "file-9" });
    expect(fake.deleted).toEqual(["file-9"]);
    expect(out.content[0].text).toMatch(/deleted/i);
  });

  it("protect handler sets protection and reports a generated password", async () => {
    const { host, handlers } = makeHost();
    const fake = new FakePublisher();
    fake.generatedPassword = "river-cloud7moon.stone";
    registerTools(host, new PublishService(fake));
    const out = await handlers["pagedrop_protect"]({ id: "file-9" });
    expect(fake.protection[0].id).toBe("file-9");
    expect(out.content[0].text).toContain("river-cloud7moon.stone");
  });

  it("rejects an empty password at the schema boundary on every publish tool", () => {
    const { host, schemas } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    for (const tool of ["pagedrop_publish_doc", "pagedrop_publish_page", "pagedrop_publish_deck"]) {
      const field = schemas[tool].password;
      expect(field.safeParse("").success, `${tool} accepted ""`).toBe(false);
      expect(field.safeParse("short").success, `${tool} accepted a short password`).toBe(false);
      expect(field.safeParse("letmein12").success).toBe(true);
      expect(field.safeParse(undefined).success).toBe(true); // omitted is how you ask for no password
    }
  });

  it("lets pagedrop_protect clear with null but rejects an empty password", () => {
    const { host, schemas } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    const field = schemas["pagedrop_protect"].password;
    expect(field.safeParse(null).success).toBe(true); // null clears
    expect(field.safeParse(undefined).success).toBe(true); // omitted leaves unchanged
    expect(field.safeParse("").success).toBe(false);
    expect(field.safeParse("letmein12").success).toBe(true);
  });

  it("describes pagedrop_protect in the words a caller would use to change a password", () => {
    // Agents failed to find this tool when asked to "change the password" — the
    // name says "protect", so the description has to carry the vocabulary.
    const { host, descriptions } = makeHost();
    registerTools(host, new PublishService(new FakePublisher()));
    const d = descriptions["pagedrop_protect"].toLowerCase();
    for (const word of ["password", "change", "remove", "expiry"]) {
      expect(d, `protect description is missing "${word}"`).toContain(word);
    }
    // Publishing tools should point at it, so an agent that starts from publish
    // can still find the way to change protection later.
    for (const tool of ["pagedrop_publish_doc", "pagedrop_publish_page", "pagedrop_publish_deck"]) {
      expect(descriptions[tool], `${tool} does not mention pagedrop_protect`).toContain("pagedrop_protect");
    }
  });

  it("publish surfaces an auto-generated password in its output", async () => {
    const { host, handlers } = makeHost();
    const fake = new FakePublisher();
    fake.generatedPassword = "river-cloud7moon.stone";
    registerTools(host, new PublishService(fake));
    const out = await handlers["pagedrop_publish_page"]({ title: "P", html: "<h1>x</h1>" });
    expect(out.content[0].text).toContain("Password: river-cloud7moon.stone");
  });

  it("publish_page handler passes images through and inlines them", async () => {
    const { host, handlers } = makeHost();
    const fake = new FakePublisher();
    registerTools(host, new PublishService(fake));
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await handlers["pagedrop_publish_page"]({
      title: "P",
      html: '<img src="cid:hero">',
      images: [{ id: "hero", dataUri: png }],
    });
    expect(fake.published[0].artifact.content).toBe(`<img src="${png}">`);
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
