// tests/host/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage, NotFoundError, ValidationError, isValidId } from "../../src/host/storage";

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

describe("storage delete", () => {
  it("removes both files and 404s afterward; missing id throws NotFound", async () => {
    const s = createStorage(dir, { suffix: () => "d1" });
    const { id } = await s.publish({ type: "page", title: "Doomed", html: "<p>x</p>" });
    await s.delete(id);
    expect(await s.get(id)).toBeNull();
    expect(await s.getMeta(id)).toBeNull();
    expect(await s.list()).toEqual([]);
    await expect(s.delete(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.delete("never-existed")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes a still-on-disk but expired artifact (physical presence, not expiry)", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const s = createStorage(dir, { now: () => new Date(clock).toISOString(), suffix: () => "d2" });
    const { id } = await s.publish({ type: "page", title: "Old", html: "<p>x</p>", ttlSeconds: 60 });
    clock += 120_000; // now expired
    expect(await s.get(id)).toBeNull(); // lazy-hidden from view
    await s.delete(id); // but still deletable
    await expect(s.delete(id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("storage TTL / expiry", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("sets expiresAt from ttlSeconds and hides expired from get/list/search", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const s = createStorage(dir, { now: () => iso(clock), suffix: () => "t1" });
    const { id } = await s.publish({ type: "page", title: "Ephemeral", html: "<p>secret</p>", ttlSeconds: 60 });
    const meta = await s.getMeta(id);
    expect(meta?.expiresAt).toBe(iso(clock + 60_000));

    clock += 30_000; // still alive
    expect(await s.get(id)).toBe("<p>secret</p>");
    expect((await s.list()).map((m) => m.id)).toContain(id);

    clock += 60_000; // now past expiry
    expect(await s.get(id)).toBeNull();
    expect(await s.getMeta(id)).toBeNull();
    expect(await s.list()).toEqual([]);
    expect(await s.search("secret")).toEqual([]);
  });

  it("applies the global default when ttlSeconds is omitted, and 0 means never", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const s = createStorage(dir, {
      now: () => iso(clock), suffix: () => "t2", defaultTtlSeconds: 100,
    });
    const def = await s.publish({ type: "page", title: "Def", html: "<p>d</p>" });
    expect((await s.getMeta(def.id))?.expiresAt).toBe(iso(clock + 100_000));

    const forever = await s.publish({ type: "page", title: "Keep", html: "<p>k</p>", ttlSeconds: 0 });
    expect((await s.getMeta(forever.id))?.expiresAt).toBeUndefined();

    clock += 1_000_000;
    expect(await s.get(def.id)).toBeNull(); // default-TTL one expired
    expect(await s.get(forever.id)).toBe("<p>k</p>"); // opted out, still here
  });

  it("rejects a negative ttl", async () => {
    const s = createStorage(dir, { suffix: () => "t3" });
    await expect(
      s.publish({ type: "page", title: "Bad", html: "<p>x</p>", ttlSeconds: -5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("deleteExpired removes only expired pairs and returns the count", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    let n = 0;
    const s = createStorage(dir, { now: () => iso(clock), suffix: () => `r${n++}` });
    const gone = await s.publish({ type: "page", title: "Gone", html: "<p>g</p>", ttlSeconds: 10 });
    const stay = await s.publish({ type: "page", title: "Stay", html: "<p>s</p>" });
    clock += 20_000;
    expect(await s.deleteExpired()).toBe(1);
    // Idempotent: nothing left to reap.
    expect(await s.deleteExpired()).toBe(0);
    // Physical files for the expired one are gone; the survivor remains.
    await expect(s.delete(gone.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await s.get(stay.id)).toBe("<p>s</p>");
  });
});

describe("storage password protection", () => {
  it("stores a hashed password on publish; getMeta exposes it, list does not verify", async () => {
    const s = createStorage(dir, { suffix: () => "p1" });
    const { id, password } = await s.publish({
      type: "page", title: "Secret", html: "<p>x</p>", password: "hunter2xx",
    });
    expect(password).toBeUndefined(); // caller supplied it; nothing generated
    const meta = await s.getMeta(id);
    expect(meta?.password?.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(meta?.password?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a too-short user-supplied password", async () => {
    const s = createStorage(dir, { suffix: () => "p2" });
    await expect(
      s.publish({ type: "page", title: "Short", html: "<p>x</p>", password: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an empty password on publish instead of treating it as 'not supplied'", async () => {
    const s = createStorage(dir, { suffix: () => "e1" });
    await expect(
      s.publish({ type: "page", title: "Empty", html: "<p>x</p>", password: "" }),
    ).rejects.toThrow(/must not be empty/);
  });

  it("rejects a whitespace-only password on publish", async () => {
    const s = createStorage(dir, { suffix: () => "e2" });
    await expect(
      s.publish({ type: "page", title: "Blank", html: "<p>x</p>", password: "        " }),
    ).rejects.toThrow(/must not be empty/);
  });

  it("does not silently lock a page when an empty password meets defaultProtect", async () => {
    // The bug: "" fell through to the auto-generate branch, so a caller asking
    // for no password got a locked page with a server-chosen passphrase.
    const s = createStorage(dir, {
      suffix: () => "e3", defaultProtect: true, genPassword: () => "river-cloud7moon.stone",
    });
    await expect(
      s.publish({ type: "page", title: "Empty", html: "<p>x</p>", password: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an empty password on setProtection rather than silently doing nothing", async () => {
    const s = createStorage(dir, { suffix: () => "e4" });
    const { id } = await s.publish({ type: "page", title: "Mut", html: "<p>x</p>", password: "letmein12" });
    await expect(s.setProtection(id, { password: "" })).rejects.toThrow(/must not be empty/);
    // The existing password is untouched by the rejected call.
    expect((await s.getMeta(id))?.password).toBeDefined();
  });

  it("auto-generates and returns a passphrase when defaultProtect is on", async () => {
    const s = createStorage(dir, {
      suffix: () => "p3", defaultProtect: true, genPassword: () => "river-cloud7moon.stone",
    });
    const { id, password } = await s.publish({ type: "page", title: "Auto", html: "<p>x</p>" });
    expect(password).toBe("river-cloud7moon.stone");
    expect((await s.getMeta(id))?.password).toBeDefined();
  });

  it("setProtection sets, clears, and re-times protection", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const s = createStorage(dir, { now: () => new Date(clock).toISOString(), suffix: () => "p4" });
    const { id } = await s.publish({ type: "page", title: "Mut", html: "<p>x</p>" });

    await s.setProtection(id, { password: "letmein12" });
    expect((await s.getMeta(id))?.password).toBeDefined();

    await s.setProtection(id, { ttlSeconds: 60 });
    expect((await s.getMeta(id))?.expiresAt).toBe(new Date(clock + 60_000).toISOString());

    await s.setProtection(id, { password: null, ttlSeconds: null });
    const meta = await s.getMeta(id);
    expect(meta?.password).toBeUndefined();
    expect(meta?.expiresAt).toBeUndefined();

    await expect(s.setProtection("missing-id", { password: "whatever1" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
