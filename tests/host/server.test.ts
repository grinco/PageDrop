import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../../src/host/storage";
import { createApiHandler } from "../../src/host/server";

let dir: string;
let server: Server;
let base: string;
const TOKEN = "test-token";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pagedrop-api-"));
  server = createServer(createApiHandler(createStorage(dir), TOKEN));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("host write API", () => {
  it("rejects requests without a valid token", async () => {
    const res = await fetch(`${base}/api/artifacts`);
    expect(res.status).toBe(401);
  });

  it("publishes, lists, searches, and updates", async () => {
    const pub = await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ type: "page", title: "Q3", html: "<h1>hi</h1>" }),
    });
    expect(pub.status).toBe(201);
    const { id } = await pub.json();
    expect(id).toMatch(/^q3-/);

    const list = await (await fetch(`${base}/api/artifacts`, { headers: auth })).json();
    expect(list.items).toHaveLength(1);

    const found = await (await fetch(`${base}/api/search?q=hi`, { headers: auth })).json();
    expect(found.items).toHaveLength(1);

    const upd = await fetch(`${base}/api/artifacts/${id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ html: "<h1>bye</h1>" }),
    });
    expect(upd.status).toBe(200);
  });

  it("GETs a single artifact's metadata (type) and 404s when absent", async () => {
    const { id } = await (await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ type: "doc", title: "Notes", html: "<h1>hi</h1>" }),
    })).json();

    const got = await fetch(`${base}/api/artifacts/${id}`, { headers: auth });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ id, type: "doc", title: "Notes" });

    expect((await fetch(`${base}/api/artifacts/missing-000000`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/api/artifacts/${id}`)).status).toBe(401); // token required
  });

  it("returns 404 when updating a nonexistent artifact (never creates)", async () => {
    const res = await fetch(`${base}/api/artifacts/missing-000000`, {
      method: "PUT", headers: auth, body: JSON.stringify({ html: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("serves /healthz and /readyz without a token", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  it("deletes an artifact and 404s on a repeat or unknown id", async () => {
    const { id } = await (await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth, body: JSON.stringify({ type: "page", title: "Doomed", html: "<p>x</p>" }),
    })).json();
    const del = await fetch(`${base}/api/artifacts/${id}`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(200);
    expect((await del.json()).id).toBe(id);
    expect((await fetch(`${base}/api/artifacts/${id}`, { method: "DELETE", headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/api/artifacts/missing-000000`, { method: "DELETE", headers: auth })).status).toBe(404);
  });

  it("rejects delete without a token", async () => {
    expect((await fetch(`${base}/api/artifacts/whatever`, { method: "DELETE" })).status).toBe(401);
  });

  it("400s on an invalid password or ttl", async () => {
    const short = await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth, body: JSON.stringify({ type: "page", title: "S", html: "<p>x</p>", password: "short" }),
    });
    expect(short.status).toBe(400);
    const negTtl = await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth, body: JSON.stringify({ type: "page", title: "S", html: "<p>x</p>", ttlSeconds: -1 }),
    });
    expect(negTtl.status).toBe(400);
  });

  it("never leaks the password hash; exposes protected + expiresAt in listings", async () => {
    await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ type: "page", title: "Locked", html: "<p>x</p>", password: "opensesame" }),
    });
    const list = await (await fetch(`${base}/api/artifacts`, { headers: auth })).json();
    expect(list.items).toHaveLength(1);
    const item = list.items[0];
    expect(item.protected).toBe(true);
    expect("password" in item).toBe(false);
    expect(item).toHaveProperty("expiresAt");
  });

  it("sets protection on an existing artifact via /protect", async () => {
    const { id } = await (await fetch(`${base}/api/publish`, {
      method: "POST", headers: auth, body: JSON.stringify({ type: "page", title: "Mut", html: "<p>x</p>" }),
    })).json();
    const res = await fetch(`${base}/api/artifacts/${id}/protect`, {
      method: "POST", headers: auth, body: JSON.stringify({ password: "letmein12", ttlSeconds: 3600 }),
    });
    expect(res.status).toBe(200);
    const list = await (await fetch(`${base}/api/artifacts`, { headers: auth })).json();
    expect(list.items[0].protected).toBe(true);
    expect((await fetch(`${base}/api/artifacts/missing/protect`, {
      method: "POST", headers: auth, body: JSON.stringify({ password: "letmein12" }),
    })).status).toBe(404);
  });
});

// The write API accepts a configurable request-body cap so inlined-image pages
// (up to tens of MB) are not rejected by the old hardcoded 1 MB ceiling.
describe("host write API request-body cap", () => {
  async function withCappedApi(
    maxBodyBytes: number,
    run: (base: string) => Promise<void>,
  ): Promise<void> {
    const d = await mkdtemp(join(tmpdir(), "pagedrop-cap-"));
    const s = createServer(createApiHandler(createStorage(d), TOKEN, undefined, maxBodyBytes));
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const addr = s.address();
    const b = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
    try {
      await run(b);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
      await rm(d, { recursive: true, force: true });
    }
  }

  it("rejects a body over the configured cap with a 400 bad_request", async () => {
    await withCappedApi(512, async (b) => {
      const res = await fetch(`${b}/api/publish`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ type: "page", title: "Big", html: "<p>" + "x".repeat(1000) + "</p>" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    });
  });

  it("accepts a multi-megabyte body when the cap is raised above 1 MB", async () => {
    await withCappedApi(8 * 1024 * 1024, async (b) => {
      // ~3 MB of HTML — comfortably past the old 1 MB hard cap.
      const html = "<p>" + "a".repeat(3 * 1024 * 1024) + "</p>";
      const res = await fetch(`${b}/api/publish`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ type: "page", title: "Roomy", html }),
      });
      expect(res.status).toBe(201);
    });
  });
});

import { createViewHandler as makeView } from "../../src/host/server";

describe("password-protected viewing", () => {
  it("gates a protected page behind a form, then unlocks with a signed cookie", async () => {
    const storage = createStorage(dir);
    const { id } = await storage.publish({ type: "page", title: "Secret", html: "<h1>classified</h1>", password: "opensesame" });
    const view = createServer(makeView(storage, dir, { cookieSecret: "sekret", failDelayMs: 0 }));
    await new Promise<void>((r) => view.listen(0, "127.0.0.1", r));
    const addr = view.address();
    const vbase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

    // No cookie → password form, not the content.
    const locked = await fetch(`${vbase}/p/${id}`);
    expect(locked.status).toBe(401);
    const form = await locked.text();
    expect(form).toContain('name="password"');
    expect(form).not.toContain("classified");

    // Wrong password → still locked.
    const wrong = await fetch(`${vbase}/p/${id}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=nope", redirect: "manual",
    });
    expect(wrong.status).toBe(401);

    // Right password → redirect + Set-Cookie.
    const ok = await fetch(`${vbase}/p/${id}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=opensesame", redirect: "manual",
    });
    expect(ok.status).toBe(302);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`pd_auth_${id}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    // Secure by default so the cookie is only sent over HTTPS.
    expect(cookie.toLowerCase()).toContain("secure");

    // Present the cookie → content served.
    const jar = cookie.split(";")[0];
    const unlocked = await fetch(`${vbase}/p/${id}`, { headers: { Cookie: jar } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toBe("<h1>classified</h1>");

    await new Promise<void>((r) => view.close(() => r()));
  });

  it("omits the Secure attribute when cookieSecure is disabled (HTTP-only deploys)", async () => {
    const storage = createStorage(dir);
    const { id } = await storage.publish({ type: "page", title: "Secret", html: "<h1>classified</h1>", password: "opensesame" });
    const view = createServer(makeView(storage, dir, { cookieSecret: "sekret", failDelayMs: 0, cookieSecure: false }));
    await new Promise<void>((r) => view.listen(0, "127.0.0.1", r));
    const addr = view.address();
    const vbase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

    const ok = await fetch(`${vbase}/p/${id}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=opensesame", redirect: "manual",
    });
    expect(ok.status).toBe(302);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`pd_auth_${id}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).not.toContain("secure");

    // The unlock cookie is still accepted over the (plain HTTP) test connection.
    const jar = cookie.split(";")[0];
    const unlocked = await fetch(`${vbase}/p/${id}`, { headers: { Cookie: jar } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toBe("<h1>classified</h1>");

    await new Promise<void>((r) => view.close(() => r()));
  });

  it("still serves unprotected pages directly", async () => {
    const storage = createStorage(dir);
    const { id } = await storage.publish({ type: "page", title: "Open", html: "<h1>public</h1>" });
    const view = createServer(makeView(storage, dir, { cookieSecret: "sekret", failDelayMs: 0 }));
    await new Promise<void>((r) => view.listen(0, "127.0.0.1", r));
    const addr = view.address();
    const vbase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
    const page = await fetch(`${vbase}/p/${id}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<h1>public</h1>");
    await new Promise<void>((r) => view.close(() => r()));
  });
});

import { createViewHandler } from "../../src/host/server";

describe("host viewing surface", () => {
  it("serves published HTML at /p/:id and escapes titles in the index", async () => {
    const storage = createStorage(dir);
    const { id } = await storage.publish({ type: "page", title: "<script>evil</script>", html: "<h1>real page</h1>" });
    const view = createServer(createViewHandler(storage));
    await new Promise<void>((r) => view.listen(0, "127.0.0.1", r));
    const addr = view.address();
    const vbase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

    const page = await fetch(`${vbase}/p/${id}`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<h1>real page</h1>");

    const index = await (await fetch(`${vbase}/`)).text();
    expect(index).toContain("&lt;script&gt;evil&lt;/script&gt;");
    expect(index).not.toContain("<script>evil");

    expect((await fetch(`${vbase}/p/does-not-exist`)).status).toBe(404);
    await new Promise<void>((r) => view.close(() => r()));
  });

  it("readyz reflects data dir writability", async () => {
    const storage = createStorage(dir);

    const badView = createServer(createViewHandler(storage, join(dir, "does-not-exist")));
    await new Promise<void>((r) => badView.listen(0, "127.0.0.1", r));
    const badAddr = badView.address();
    const badBase = typeof badAddr === "object" && badAddr ? `http://127.0.0.1:${badAddr.port}` : "";
    expect((await fetch(`${badBase}/readyz`)).status).toBe(503);
    await new Promise<void>((r) => badView.close(() => r()));

    const goodView = createServer(createViewHandler(storage, dir));
    await new Promise<void>((r) => goodView.listen(0, "127.0.0.1", r));
    const goodAddr = goodView.address();
    const goodBase = typeof goodAddr === "object" && goodAddr ? `http://127.0.0.1:${goodAddr.port}` : "";
    expect((await fetch(`${goodBase}/readyz`)).status).toBe(200);
    await new Promise<void>((r) => goodView.close(() => r()));
  });
});
