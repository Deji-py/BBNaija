import { createHash, timingSafeEqual } from "node:crypto";

const DEV_ADMIN_SECRET = "bigbrother";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Secret for the Big Brother console (/bigbrother). Set ADMIN_SECRET in
 * apps/server/.env (see .env.example). Development falls back to a known
 * default with a warning; production refuses to start without one.
 */
const adminSecret = process.env.ADMIN_SECRET ?? (isProduction ? undefined : DEV_ADMIN_SECRET);
if (!adminSecret) throw new Error("ADMIN_SECRET must be set in production");
if (!process.env.ADMIN_SECRET) {
  console.warn(`[config] ADMIN_SECRET not set — using the development default "${DEV_ADMIN_SECRET}". Never do this in production.`);
}

const adminHash = createHash("sha256").update(adminSecret).digest();

/** Constant-time comparison, so response timing doesn't leak how much of a guess was right. */
export function isAdminSecret(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  return timingSafeEqual(createHash("sha256").update(candidate).digest(), adminHash);
}
