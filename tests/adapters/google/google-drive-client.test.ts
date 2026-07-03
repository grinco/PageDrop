import { describe, it, expect } from "vitest";
import { escapeDriveQueryValue } from "../../../src/adapters/google/google-drive-client";

describe("escapeDriveQueryValue", () => {
  it("escapes a plain single quote", () => {
    expect(escapeDriveQueryValue("O'Brien")).toBe("O\\'Brien");
  });

  it("doubles backslashes before escaping quotes, preserving parity", () => {
    // Input: \' or x   (backslash, quote, space, o, r, space, x)
    // Backslashes must be escaped FIRST so the pre-existing backslash
    // doesn't flip the parity of the escape in front of the quote.
    expect(escapeDriveQueryValue("\\' or x")).toBe("\\\\\\' or x");
  });

  it("leaves a value with no special characters unchanged", () => {
    expect(escapeDriveQueryValue("plain-name_123")).toBe("plain-name_123");
  });
});
