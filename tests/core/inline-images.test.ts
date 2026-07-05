import { describe, it, expect } from "vitest";
import { inlineImages, DEFAULT_INLINE_IMAGE_LIMITS, type InlineImageLimits } from "../../src/core/inline-images";

// A valid 1x1 PNG data URI (small, matches the accepted data-URI shape).
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBD";

describe("inlineImages", () => {
  it("returns HTML unchanged when images is undefined or empty", () => {
    const html = '<p>hi</p><img src="cid:x">';
    expect(inlineImages(html, undefined)).toBe(html);
    expect(inlineImages(html, [])).toBe(html);
  });

  it("replaces a single cid: reference with the data URI", () => {
    const out = inlineImages('<img src="cid:hero" alt="x">', [{ id: "hero", dataUri: PNG }]);
    expect(out).toBe(`<img src="${PNG}" alt="x">`);
    expect(out).not.toContain("cid:");
  });

  it("replaces multiple references (incl. the same image twice) and single quotes", () => {
    const html = `<img src='cid:a'><img src="cid:b"><img src="cid:a">`;
    const out = inlineImages(html, [
      { id: "a", dataUri: PNG },
      { id: "b", dataUri: JPG },
    ]);
    expect(out).toBe(`<img src="${PNG}"><img src="${JPG}"><img src="${PNG}">`);
  });

  it("does not let a short id match inside a longer id (closing-quote anchored)", () => {
    // id "a" must NOT rewrite src="cid:ab"
    const html = '<img src="cid:ab">';
    const out = inlineImages(html, [{ id: "ab", dataUri: PNG }]);
    expect(out).toBe(`<img src="${PNG}">`);
  });

  it("throws when the HTML references an unknown image id", () => {
    expect(() => inlineImages('<img src="cid:missing">', [{ id: "present", dataUri: PNG }])).toThrow(
      /unknown image ids: missing/,
    );
  });

  it("throws when a supplied image is never referenced", () => {
    expect(() => inlineImages("<p>no images here</p>", [{ id: "orphan", dataUri: PNG }])).toThrow(
      /not referenced.*orphan/,
    );
  });

  it("throws on a malformed data URI", () => {
    expect(() => inlineImages('<img src="cid:x">', [{ id: "x", dataUri: "notadatauri" }])).toThrow(
      /malformed data URI/,
    );
  });

  it("throws on an invalid image id", () => {
    expect(() => inlineImages('<img src="cid:x">', [{ id: "Bad Id!", dataUri: PNG }])).toThrow(/invalid image id/);
  });

  it("throws on a duplicate image id", () => {
    expect(() =>
      inlineImages('<img src="cid:x">', [
        { id: "x", dataUri: PNG },
        { id: "x", dataUri: JPG },
      ]),
    ).toThrow(/duplicate image id/);
  });

  it("enforces the per-image byte cap", () => {
    // ~40 bytes of base64 → ~30 decoded bytes; cap at 10 bytes.
    const big = "data:image/png;base64," + "A".repeat(60);
    const limits: InlineImageLimits = { ...DEFAULT_INLINE_IMAGE_LIMITS, maxImageBytes: 10 };
    expect(() => inlineImages('<img src="cid:x">', [{ id: "x", dataUri: big }], limits)).toThrow(/bytes \(max 10\)/);
  });

  it("enforces the image-count cap", () => {
    const limits: InlineImageLimits = { ...DEFAULT_INLINE_IMAGE_LIMITS, maxImages: 1 };
    const html = '<img src="cid:a"><img src="cid:b">';
    expect(() =>
      inlineImages(
        html,
        [
          { id: "a", dataUri: PNG },
          { id: "b", dataUri: JPG },
        ],
        limits,
      ),
    ).toThrow(/too many images: 2 \(max 1\)/);
  });

  it("enforces the total-bytes cap", () => {
    const limits: InlineImageLimits = { ...DEFAULT_INLINE_IMAGE_LIMITS, maxTotalBytes: 5 };
    expect(() => inlineImages('<img src="cid:x">', [{ id: "x", dataUri: PNG }], limits)).toThrow(/images total/);
  });
});
