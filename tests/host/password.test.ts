import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, type StoredPassword } from "../../src/host/password";

describe("password hashing", () => {
  it("round-trips: a hashed password verifies against its plaintext", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("emits hex salt (16 bytes) and hash (32 bytes)", () => {
    const stored = hashPassword("hunter2xx");
    expect(stored.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses a fresh random salt per call", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("verify tolerates malformed stored records without throwing", () => {
    const bad = { salt: "zz", hash: "" } as StoredPassword;
    expect(verifyPassword("x", bad)).toBe(false);
  });
});
