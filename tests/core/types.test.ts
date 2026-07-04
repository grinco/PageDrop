import { describe, it, expect } from "vitest";
import type { Artifact, PublishResult, Publisher } from "../../src/core/types";

describe("core types", () => {
  it("shapes an Artifact and PublishResult", () => {
    const a: Artifact = { type: "doc", title: "T", content: "# Hi" };
    const r: PublishResult = { id: "file-1", editUrl: "https://x" };
    expect(a.type).toBe("doc");
    expect(r.id).toBe("file-1");
  });

  it("allows a Publisher implementation to satisfy the interface", () => {
    const p: Publisher = {
      publish: async () => ({ id: "file-1" }),
      update: async () => ({ id: "file-1" }),
      delete: async () => {},
      setProtection: async () => ({ id: "file-1" }),
      list: async () => [],
      search: async () => [],
      setSharing: async () => {},
    };
    expect(typeof p.publish).toBe("function");
  });
});
