import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/core/markdown";

describe("renderMarkdown", () => {
  it("converts a heading and paragraph to HTML", () => {
    const html = renderMarkdown("# Title\n\nHello **world**");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
  });
});
