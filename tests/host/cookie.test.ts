import { describe, it, expect } from "vitest";
import { signCookie, verifyCookie } from "../../src/host/cookie";

const SECRET = "test-cookie-secret";
const ID = "my-page-abc123";
const NOW = 1_000_000; // epoch seconds

describe("cookie signing", () => {
  it("verifies a freshly signed, unexpired token for the same id", () => {
    const token = signCookie(ID, NOW + 3600, SECRET);
    expect(verifyCookie(token, ID, SECRET, NOW)).toBe(true);
  });

  it("rejects an expired token", () => {
    const token = signCookie(ID, NOW - 1, SECRET);
    expect(verifyCookie(token, ID, SECRET, NOW)).toBe(false);
  });

  it("rejects a token minted for a different id", () => {
    const token = signCookie("other-page-xyz999", NOW + 3600, SECRET);
    expect(verifyCookie(token, ID, SECRET, NOW)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signCookie(ID, NOW + 3600, "different-secret");
    expect(verifyCookie(token, ID, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered payload or signature", () => {
    const token = signCookie(ID, NOW + 3600, SECRET);
    const [payload, sig] = token.split(".");
    expect(verifyCookie(`${payload}x.${sig}`, ID, SECRET, NOW)).toBe(false);
    expect(verifyCookie(`${payload}.${sig}x`, ID, SECRET, NOW)).toBe(false);
  });

  it("rejects malformed values without throwing", () => {
    expect(verifyCookie("", ID, SECRET, NOW)).toBe(false);
    expect(verifyCookie("no-dot-here", ID, SECRET, NOW)).toBe(false);
    expect(verifyCookie("a.b.c", ID, SECRET, NOW)).toBe(false);
  });
});
