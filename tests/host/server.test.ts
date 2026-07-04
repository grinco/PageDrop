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
});
