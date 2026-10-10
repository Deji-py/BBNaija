import { LOGIN_LINK_MINUTES, SESSION_DAYS, isValidEmail, type PublicUser } from "@bbn/shared";
import { PUBLIC_URL, isProduction } from "../config.js";
import { db } from "../db/client.js";
import { emailConfigured, sendSignInEmail } from "../email/brevo.js";
import { RateLimiter } from "../systems/rateLimit.js";
import { hashToken, newToken } from "./tokens.js";

/** At most 3 sign-in emails per address, refilling one every 5 minutes. */
const linkLimiter = new RateLimiter(3, 5 * 60_000);

export class AuthError extends Error {
  constructor(
    readonly status: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export function toPublicUser(u: { id: string; email: string; displayName: string | null }): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName };
}

/**
 * Starts a magic-link sign-in. Production sends it through Brevo; development
 * returns it to the page and prints it in the server log.
 */
export async function requestLoginLink(rawEmail: unknown, requestOrigin: string | null): Promise<{ devLink?: string }> {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!isValidEmail(email)) throw new AuthError("BAD_REQUEST", "Please enter a valid email address.");
  if (!linkLimiter.allow(email)) throw new AuthError("TOO_MANY_REQUESTS", "Too many sign-in links. Try again in a few minutes.");
  if (isProduction && !emailConfigured()) throw new AuthError("SERVICE_UNAVAILABLE", "Email sign-in isn't set up yet.");

  const token = newToken();
  await db.loginToken.create({
    data: { email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LOGIN_LINK_MINUTES * 60_000) },
  });
  // In production the base must be the fixed PUBLIC_URL — never the request's Origin header,
  // or an attacker could get a victim's link pointed at their own site.
  const base = PUBLIC_URL ?? safeOrigin(requestOrigin) ?? "http://localhost:5173";
  const link = `${base}/auth?token=${encodeURIComponent(token)}`;
  if (isProduction) {
    try {
      await sendSignInEmail(email, link);
    } catch (err) {
      console.error(`[auth] sign-in email failed: ${err instanceof Error ? err.message : "unknown error"}`);
      throw new AuthError("SERVICE_UNAVAILABLE", "We couldn't send the sign-in email. Please try again.");
    }
    return {};
  }
  console.log(`[auth] sign-in link for ${email}: ${link}`);
  return { devLink: link };
}

/** Exchanges a sign-in link token (single use, short-lived) for a session. */
export async function verifyLoginLink(rawToken: unknown): Promise<{ sessionToken: string; user: PublicUser }> {
  if (typeof rawToken !== "string" || rawToken.length > 200) throw new AuthError("BAD_REQUEST", "Invalid sign-in link.");
  const login = await db.loginToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!login || login.usedAt || login.expiresAt < new Date()) {
    throw new AuthError("UNAUTHORIZED", "This sign-in link has expired or was already used. Request a new one.");
  }
  // Mark used first; the conditional update makes double-clicks race-safe.
  const claimed = await db.loginToken.updateMany({ where: { id: login.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new AuthError("UNAUTHORIZED", "This sign-in link was already used.");

  const user = await db.user.upsert({ where: { email: login.email }, update: {}, create: { email: login.email } });
  if (user.bannedAt) throw new AuthError("FORBIDDEN", "This account has been banned.");

  const sessionToken = newToken();
  await db.session.create({
    data: { userId: user.id, tokenHash: hashToken(sessionToken), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) },
  });
  return { sessionToken, user: toPublicUser(user) };
}

/** The signed-in user for a session token, or null. Banned users count as signed out. */
export async function userFromSession(token: unknown) {
  if (typeof token !== "string" || !token || token.length > 200) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.bannedAt) return null;
  return session.user;
}

export async function signOut(token: unknown): Promise<void> {
  if (typeof token !== "string") return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** `Authorization: Bearer <token>` → token. */
export function bearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? null;
}

function safeOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
