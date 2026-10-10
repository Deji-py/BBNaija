/**
 * Paid vote packs. Prices are in kobo (Paystack's unit: 100 kobo = ₦1).
 * One free vote is separate; a pack adds extra weight on that same vote.
 * Change the price before a real launch, and check paid-voting rules first.
 */
export const VOTE_PACKS = [
  { id: "save5", votes: 5, amountKobo: 50_000, label: "5 extra votes", priceLabel: "₦500" },
] as const;

export type VotePackId = (typeof VOTE_PACKS)[number]["id"];

/** Extra (paid) votes one account can add in a single voting window. */
export const MAX_EXTRA_VOTES = 10;

export function votePack(id: string): (typeof VOTE_PACKS)[number] | undefined {
  return VOTE_PACKS.find((p) => p.id === id);
}
