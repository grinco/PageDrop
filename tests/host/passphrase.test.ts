import { describe, it, expect } from "vitest";
import { generatePassphrase } from "../../src/host/passphrase";
import { WORDLIST } from "../../src/host/wordlist";

// A deterministic stand-in for crypto.randomInt: pops the next value, clamped
// into [0, max) so a short queue can't produce an out-of-range index.
function seqRng(values: number[]): (max: number) => number {
  let i = 0;
  return (max: number) => {
    const v = values[Math.min(i++, values.length - 1)] ?? 0;
    return ((v % max) + max) % max;
  };
}

describe("generatePassphrase", () => {
  it("joins four wordlist words with three separators, deterministically", () => {
    // word0..3, digitSlot, digitChar, symbolSlot, symbolChar, lastChar
    const rng = seqRng([0, 1, 2, 3, 0, 0, 0, 0, 0]);
    expect(generatePassphrase(rng)).toBe("acid2acorn-acre2acts");
  });

  it("always contains at least one digit and one symbol", () => {
    for (let n = 0; n < 200; n++) {
      const p = generatePassphrase();
      expect(/[2-9]/.test(p)).toBe(true);
      expect(/[-._!#@]/.test(p)).toBe(true);
    }
  });

  it("uses exactly four words from the bundled wordlist", () => {
    const words = new Set(WORDLIST);
    for (let n = 0; n < 100; n++) {
      const parts = generatePassphrase().split(/[2-9\-._!#@]/);
      expect(parts).toHaveLength(4);
      for (const w of parts) expect(words.has(w)).toBe(true);
    }
  });

  it("never emits the ambiguous 0/1 digits", () => {
    for (let n = 0; n < 100; n++) {
      expect(/[01]/.test(generatePassphrase())).toBe(false);
    }
  });

  it("produces distinct output across calls", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 50; n++) seen.add(generatePassphrase());
    expect(seen.size).toBeGreaterThan(40); // ~53 bits of entropy → practically all unique
  });
});
