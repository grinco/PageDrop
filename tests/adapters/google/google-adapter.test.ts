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
