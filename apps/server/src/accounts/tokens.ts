import { createHash, randomBytes } from "node:crypto";

/** Unguessable random token (256 bits), URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** We store only hashes of tokens, so a leaked database can't be used to sign in. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
