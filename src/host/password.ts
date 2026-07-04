// src/host/password.ts
//
// Server-side password hashing for protected artifacts (Feature 3). Plaintext
// arrives over the bearer-authenticated API and is hashed here; only the salt +
// derived key are persisted. Verification is constant-time.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Persisted form of a password. Both fields are lowercase hex. */
export interface StoredPassword {
  salt: string;
  hash: string;
}

// Fixed scrypt cost parameters (documented in the design). N=2^14, r=8, p=1.
// maxmem is raised above the Node default so N=16384 does not throw.
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function derive(plain: string, salt: Buffer): Buffer {
  return scryptSync(plain, salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
}

/** Hash a plaintext password with a fresh random 16-byte salt. */
export function hashPassword(plain: string): StoredPassword {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: derive(plain, salt).toString("hex") };
}

/** Constant-time verification of a plaintext against a stored record. */
export function verifyPassword(plain: string, stored: StoredPassword): boolean {
  let saltBuf: Buffer;
  let expected: Buffer;
  try {
    saltBuf = Buffer.from(stored.salt, "hex");
    expected = Buffer.from(stored.hash, "hex");
  } catch {
    return false;
  }
  if (saltBuf.length === 0 || expected.length !== KEYLEN) return false;
  const actual = derive(plain, saltBuf);
  return timingSafeEqual(actual, expected);
}
