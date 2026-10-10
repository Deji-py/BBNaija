import { createHmac, randomBytes } from "node:crypto";
import { MAX_EXTRA_VOTES, votePack, type VotePackId } from "@bbn/shared";
import { db } from "../db/client.js";
import { RateLimiter } from "./rateLimit.js";

/** At most 3 checkout attempts a minute per account. */
const checkoutLimiter = new RateLimiter(3, 20_000);

export function paymentsEnabled(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export class PaymentError extends Error {
  constructor(
    readonly status: "BAD_REQUEST" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Starts a Paystack test (or live) checkout for one pack, against the season's
 * open voting window. The secret key never leaves the server.
 */
export async function startCheckout(userId: string, email: string, seasonId: string, packId: string, origin: string): Promise<string> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaymentError("SERVICE_UNAVAILABLE", "Paid votes aren't set up yet.");
  if (!checkoutLimiter.allow(userId)) throw new PaymentError("TOO_MANY_REQUESTS", "Too many payment attempts. Try again in a minute.");
  const pack = votePack(packId);
  if (!pack) throw new PaymentError("BAD_REQUEST", "That vote pack doesn't exist.");

  const window = await db.voteWindow.findFirst({
    where: { seasonId, revealedAt: null, closesAt: { gt: new Date() } },
    orderBy: { round: "desc" },
  });
  if (!window) throw new PaymentError("BAD_REQUEST", "Voting isn't open right now.");

  const already = await extraVotes(userId, window.id);
  if (already + pack.votes > MAX_EXTRA_VOTES) {
    throw new PaymentError("BAD_REQUEST", `You can add at most ${MAX_EXTRA_VOTES} extra votes in one window.`);
  }

  const reference = `bbn_${randomBytes(12).toString("hex")}`;
  await db.purchase.create({
    data: {
      userId,
      seasonId,
      voteWindowId: window.id,
      packId: pack.id,
      votes: pack.votes,
      amountKobo: pack.amountKobo,
      reference,
    },
  });

  const callback = `${origin.replace(/\/+$/, "")}/watch/${seasonId}`;
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: pack.amountKobo,
      reference,
      callback_url: callback,
      metadata: { purchaseReference: reference, packId: pack.id satisfies VotePackId },
    }),
  });
  const body = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url?: string } };
  if (!res.ok || !body.status || !body.data?.authorization_url) {
    throw new PaymentError("SERVICE_UNAVAILABLE", body.message || "Couldn't start the payment.");
  }
  return body.data.authorization_url;
}

/** Confirms a Paystack reference and, if it matches our row, marks the pack paid. */
export async function verifyCheckout(userId: string, reference: string): Promise<string> {
  const purchase = await db.purchase.findUnique({ where: { reference } });
  if (!purchase || purchase.userId !== userId) throw new PaymentError("NOT_FOUND", "No payment with that reference.");
  if (purchase.status === "paid") return "Those extra votes are already on your account.";
  const paid = await paystackSucceeded(reference, purchase.amountKobo);
  if (!paid) throw new PaymentError("BAD_REQUEST", "Paystack hasn't confirmed that payment.");
  await markPaid(purchase.id);
  return `${purchase.votes} extra votes are ready for this voting window.`;
}

/** Paystack webhook: the signature is HMAC-SHA512 of the raw body. */
export async function handlePaystackWebhook(rawBody: string, signature: string | null): Promise<void> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length || expected !== signature) return;
  let event: { event?: string; data?: { reference?: string; amount?: number } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return;
  }
  if (event.event !== "charge.success" || !event.data?.reference) return;
  const purchase = await db.purchase.findUnique({ where: { reference: event.data.reference } });
  if (!purchase || purchase.status === "paid") return;
  if (event.data.amount !== purchase.amountKobo) return;
  await markPaid(purchase.id);
}

/** Extra votes this account has paid for in a window (capped). */
export async function extraVotes(userId: string, voteWindowId: string): Promise<number> {
  const rows = await db.purchase.findMany({
    where: { userId, voteWindowId, status: "paid" },
    select: { votes: true },
  });
  return Math.min(MAX_EXTRA_VOTES, rows.reduce((sum, row) => sum + row.votes, 0));
}

async function markPaid(id: string): Promise<void> {
  const purchase = await db.purchase.update({ where: { id }, data: { status: "paid", paidAt: new Date() } });
  if (!purchase.voteWindowId) return;
  const extra = await extraVotes(purchase.userId, purchase.voteWindowId);
  await db.vote.updateMany({
    where: { voteWindowId: purchase.voteWindowId, userId: purchase.userId },
    data: { weight: 1 + extra, paid: extra > 0 },
  });
}

async function paystackSucceeded(reference: string, amountKobo: number): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { status?: boolean; data?: { status?: string; amount?: number } };
  return body.status === true && body.data?.status === "success" && body.data.amount === amountKobo;
}

export interface SeasonStats {
  watchingNow: number;
  watchMinutes: number;
  signedInViewers: number;
  votes: number;
  voteWeight: number;
}

/** Watch time and votes for the console. "Watching now" is open sessions, which includes crashes until they time out on the next leave. */
export async function seasonStats(seasonId: string): Promise<SeasonStats> {
  const [open, closed, viewers, votes] = await Promise.all([
    db.watchSession.findMany({ where: { seasonId, endedAt: null }, select: { startedAt: true } }),
    db.watchSession.findMany({ where: { seasonId, endedAt: { not: null } }, select: { startedAt: true, endedAt: true } }),
    db.watchSession.findMany({ where: { seasonId, userId: { not: null } }, select: { userId: true }, distinct: ["userId"] }),
    db.vote.findMany({ where: { window: { seasonId } }, select: { weight: true } }),
  ]);
  const now = Date.now();
  let ms = 0;
  for (const row of open) ms += now - row.startedAt.getTime();
  for (const row of closed) if (row.endedAt) ms += row.endedAt.getTime() - row.startedAt.getTime();
  return {
    watchingNow: open.length,
    watchMinutes: Math.round(ms / 60_000),
    signedInViewers: viewers.length,
    votes: votes.length,
    voteWeight: votes.reduce((sum, vote) => sum + vote.weight, 0),
  };
}
