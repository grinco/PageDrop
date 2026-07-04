// src/host/cookie.ts
//
// HMAC-signed unlock tokens for password-protected pages (Feature 3). The token
// carries the artifact id and an absolute expiry, so a stolen cookie is useless
// for another page and self-invalidates. Format:
//   base64url(payload) "." base64url(HMAC-SHA256(payload, secret))
// where payload is the string "<id>:<expiryEpochSeconds>".

import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (b: Buffer): string => b.toString("base64url");

function hmac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Sign an unlock token for `id` valid until `expEpochSeconds`. */
export function signCookie(id: string, expEpochSeconds: number, secret: string): string {
  const payload = `${id}:${expEpochSeconds}`;
  return `${b64url(Buffer.from(payload))}.${b64url(hmac(payload, secret))}`;
}

/** Verify a token: signature (constant-time), matching id, and not expired. */
export function verifyCookie(value: string, id: string, secret: string, nowEpochSeconds: number): boolean {
  const dot = value.indexOf(".");
  if (dot <= 0 || value.indexOf(".", dot + 1) !== -1) return false;
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);

  let payload: string;
  let sig: Buffer;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    return false;
  }

  const expected = hmac(payload, secret);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;

  const sep = payload.lastIndexOf(":");
  if (sep === -1) return false;
  const tokenId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (tokenId !== id || !Number.isFinite(exp)) return false;
  return exp > nowEpochSeconds;
}
