// src/host/passphrase.ts
//
// Memorable passphrase generator for auto-protected artifacts (Feature 5).
// Format: four lowercase words joined by three single-character separators, e.g.
//   river-cloud7moon.stone
// Composition (>=1 digit and >=1 symbol) is guaranteed by construction — one
// separator slot is reserved for a digit and another for a symbol — so there is
// no rejection-sampling retry loop. ~53 bits of entropy (~41 words + ~12 seps).

import { randomInt } from "node:crypto";
import { WORDLIST } from "./wordlist";

/** Digits 2–9. 0 and 1 are excluded to avoid O/l visual confusion. */
const DIGITS = "23456789";
/** Memorable, easy-to-type symbols. */
const SYMBOLS = "-._!#@";
const ALL_SEPARATORS = DIGITS + SYMBOLS;

// Exclude the single hyphenated wordlist entry ("yo-yo") so a word never
// contains a separator character — keeps generated passphrases unambiguous.
const WORDS = WORDLIST.filter((w) => /^[a-z]+$/.test(w));

/** Returns a uniformly random integer in [0, max). Defaults to a CSPRNG. */
export type Rng = (max: number) => number;

const pick = (rng: Rng, s: string): string => s[rng(s.length)];

/**
 * Generate a memorable, composition-guaranteed passphrase.
 * @param rng injectable for deterministic testing; defaults to `crypto.randomInt`.
 */
export function generatePassphrase(rng: Rng = (max) => randomInt(max)): string {
  const words = Array.from({ length: 4 }, () => WORDS[rng(WORDS.length)]);

  const seps: string[] = new Array(3);
  const digitSlot = rng(3);
  seps[digitSlot] = pick(rng, DIGITS);

  const remaining = [0, 1, 2].filter((i) => i !== digitSlot);
  const symbolSlot = remaining[rng(remaining.length)];
  seps[symbolSlot] = pick(rng, SYMBOLS);

  const lastSlot = [0, 1, 2].find((i) => i !== digitSlot && i !== symbolSlot)!;
  seps[lastSlot] = pick(rng, ALL_SEPARATORS);

  return words[0] + seps[0] + words[1] + seps[1] + words[2] + seps[2] + words[3];
}
