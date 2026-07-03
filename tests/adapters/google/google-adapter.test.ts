import { describe, it, expect } from "vitest";
import { GoogleAdapter } from "../../../src/adapters/google/google-adapter";
import { FakeDriveClient } from "../../fakes/fake-drive-client";
import { FakeSlidesClient } from "../../fakes/fake-slides-client";

const config = { folderName: "PageDrop", rendererBaseUrl: "https://script.google.com/exec" };

describe("GoogleAdapter — doc", () => {
  it("publishes markdown as a native Google Doc and shares it", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const res = await adapter.publish({ type: "doc", title: "Q3 Report", content: "# Hi\n\ntext" });
    expect(res.id).toBe("file-1");
    expect(res.editUrl).toContain("docs.google.com/document");
    expect(res.viewUrl).toBeUndefined();
    expect(drive.shared.has("file-1")).toBe(true);
  });
});

describe("GoogleAdapter — page", () => {
  it("stores HTML as a blob and returns a renderer view URL", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const res = await adapter.publish({ type: "page", title: "Dashboard", content: "<h1>x</h1>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toBeUndefined();
    expect(drive.shared.has("file-1")).toBe(true);
  });
});

describe("GoogleAdapter — deck", () => {
  it("returns a view URL and, when Slides is configured, an edit URL", async () => {
    const drive = new FakeDriveClient();
    const slides = new FakeSlidesClient();
    const adapter = new GoogleAdapter(drive, config, slides);
    const res = await adapter.publish({ type: "deck", title: "Kickoff", content: "<section>1</section>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toContain("docs.google.com/presentation");
    expect(slides.created[0].viewUrl).toBe("https://script.google.com/exec?id=file-1");
  });

  it("still succeeds when Slides creation fails (best-effort)", async () => {
    const drive = new FakeDriveClient();
    const slides = new FakeSlidesClient();
    slides.shouldFail = true;
    const adapter = new GoogleAdapter(drive, config, slides);
    const res = await adapter.publish({ type: "deck", title: "Kickoff", content: "<section>1</section>" });
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-1");
    expect(res.editUrl).toBeUndefined();
  });
});

describe("GoogleAdapter — list/search/update", () => {
  it("lists published artifacts with derived types", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    await adapter.publish({ type: "doc", title: "Doc A", content: "# a" });
    await adapter.publish({ type: "page", title: "Page B", content: "<h1>b</h1>" });
    const refs = await adapter.list();
    const types = refs.map((r) => r.type).sort();
    expect(types).toEqual(["doc", "page"]);
    const doc = refs.find((r) => r.type === "doc")!;
    expect(doc.editUrl).toContain("docs.google.com/document");
    const page = refs.find((r) => r.type === "page")!;
    expect(page.viewUrl).toContain("script.google.com/exec?id=");
  });

  it("searches by title substring", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    await adapter.publish({ type: "page", title: "Budget Dashboard", content: "<h1>x</h1>" });
    await adapter.publish({ type: "page", title: "Roadmap", content: "<h1>y</h1>" });
    const hits = await adapter.search("budget");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toContain("Budget");
  });

  it("updates an HTML page and returns its view URL", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const pub = await adapter.publish({ type: "page", title: "P", content: "<h1>old</h1>" });
    const res = await adapter.update(pub.id, "<h1>new</h1>");
    expect(res.viewUrl).toBe(`https://script.google.com/exec?id=${pub.id}`);
  });

  it("refuses to update a native Doc in the POC", async () => {
    const drive = new FakeDriveClient();
    const adapter = new GoogleAdapter(drive, config);
    const pub = await adapter.publish({ type: "doc", title: "D", content: "# x" });
    await expect(adapter.update(pub.id, "# y")).rejects.toThrow(/HTML pages\/decks only/i);
  });
});
