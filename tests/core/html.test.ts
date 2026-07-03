import { describe, it, expect } from "vitest";
import { wrapHtmlDocument } from "../../src/core/html";

describe("wrapHtmlDocument", () => {
  it("wraps a fragment into a full HTML document with the title", () => {
    const out = wrapHtmlDocument("<h1>Hi</h1>", "My Report");
    expect(out.toLowerCase()).toContain("<!doctype html>");
    expect(out).toContain("<title>My Report</title>");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("is idempotent when given a full document", () => {
    const full = "<!DOCTYPE html><html><head></head><body>x</body></html>";
    expect(wrapHtmlDocument(full, "ignored")).toBe(full);
  });
});
