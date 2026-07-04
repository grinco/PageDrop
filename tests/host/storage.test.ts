// tests/host/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage, NotFoundError, isValidId } from "../../src/host/storage";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pagedrop-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("storage publish/get/update", () => {
  it("publishes and serves HTML, with a slug-based id", async () => {
    const s = createStorage(dir, { now: () => "2026-07-04T00:00:00.000Z", suffix: () => "abc123" });
    const { id } = await s.publish({ type: "page", title: "Q3 Report!", html: "<h1>hi</h1>" });
    expect(id).toBe("q3-report-abc123");
    expect(await s.get(id)).toBe("<h1>hi</h1>");
    expect(JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"))).toMatchObject({
      id, title: "Q3 Report!", type: "page", createdAt: "2026-07-04T00:00:00.000Z",
    });
  });

  it("returns null for a missing id and rejects traversal ids", async () => {
    const s = createStorage(dir);
    expect(await s.get("does-not-exist")).toBeNull();
    expect(await s.get("../etc/passwd")).toBeNull();
    expect(isValidId("../x")).toBe(false);
    expect(isValidId("q3-report-abc123")).toBe(true);
  });

  it("retries on id collision instead of overwriting", async () => {
    let n = 0;
    const suffixes = ["dupe01", "dupe01", "uniq02"]; // first two collide
    const s = createStorage(dir, { suffix: () => suffixes[n++] });
    const a = await s.publish({ type: "page", title: "T", html: "<p>a</p>" });
    const b = await s.publish({ type: "page", title: "T", html: "<p>b</p>" });
    expect(a.id).toBe("t-dupe01");
    expect(b.id).toBe("t-uniq02");
    expect(await s.get(a.id)).toBe("<p>a</p>"); // first not clobbered
    expect(await s.get(b.id)).toBe("<p>b</p>");
  });

  it("updates existing content and bumps modifiedAt, but 404s for a missing id", async () => {
    const times = ["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z"];
    let t = 0;
    const s = createStorage(dir, { now: () => times[Math.min(t++, times.length - 1)], suffix: () => "x1" });
    const { id } = await s.publish({ type: "page", title: "P", html: "<p>old</p>" });
    await s.update(id, { html: "<p>new</p>" });
    expect(await s.get(id)).toBe("<p>new</p>");
    const meta = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
    expect(meta.modifiedAt).toBe("2026-02-02T00:00:00.000Z");
    await expect(s.update("nope-000000", { html: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("storage list/search", () => {
  it("lists newest-first and skips orphaned metadata", async () => {
    const times = ["2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z"];
    let t = 0;
    const s = createStorage(dir, { now: () => times[Math.min(t++, 1)], suffix: () => `s${t}` });
    await s.publish({ type: "page", title: "First", html: "<p>1</p>" });
    await s.publish({ type: "doc", title: "Second", html: "<p>2</p>" });
    // Orphan: a .json with no matching .html must be ignored.
    await writeFile(join(dir, "ghost-000000.json"),
      JSON.stringify({ id: "ghost-000000", title: "Ghost", type: "page", tags: [], createdAt: "x", modifiedAt: "x" }));
    const items = await s.list();
    expect(items.map((i) => i.title)).toEqual(["Second", "First"]);
  });

  it("searches title and HTML content case-insensitively", async () => {
    const s = createStorage(dir, { suffix: () => Math.random().toString(16).slice(2, 8) });
    await s.publish({ type: "page", title: "Budget Dashboard", html: "<p>x</p>" });
    await s.publish({ type: "page", title: "Roadmap", html: "<p>quarterly REVENUE</p>" });
    expect((await s.search("budget")).map((i) => i.title)).toEqual(["Budget Dashboard"]);
    expect((await s.search("revenue")).map((i) => i.title)).toEqual(["Roadmap"]);
    expect(await s.search("nothing")).toEqual([]);
  });
});
