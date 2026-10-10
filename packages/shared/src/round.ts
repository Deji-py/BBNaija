/**
 * Nominations, voting and evictions (M8).
 *
 * A round is run by the server. Vote totals are NOT part of the synced house
 * state until Big Brother reveals them — anything in the synced state is
 * visible to every client, so a hidden result has to stay in server memory.
 */

/** How many of the most-nominated housemates face the public vote. Ties for the last place are included. */
export const NOMINATION_SLATE_SIZE = 2;
/** Housemates who must be in the house before nominations can start. With fewer, it's a finale. */
export const MIN_HOUSEMATES_TO_NOMINATE = 3;
/** Housemates who must be in the house for a finale vote. */
export const MIN_HOUSEMATES_FOR_FINALE = 2;

/** Lengths Big Brother can open a voting window for, in seconds. */
export const VOTE_LENGTHS_SEC = [60, 180, 300] as const;
export type VoteLengthSec = (typeof VOTE_LENGTHS_SEC)[number];

/** Sentinel stored on a nominee until the result is revealed. */
export const VOTES_HIDDEN = -1;

export function isVoteLength(seconds: number): seconds is VoteLengthSec {
  return (VOTE_LENGTHS_SEC as readonly number[]).includes(seconds);
}

/**
 * Who faces the public vote: the top `size` by nomination count, plus anyone
 * tied with the last of those. Ids are only used as a stable sort for ties.
 */
export function slateFromCounts(counts: ReadonlyArray<{ id: string; n: number }>, size: number): string[] {
  const ranked = [...counts].filter((c) => c.n > 0).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  if (ranked.length === 0 || size < 1) return [];
  const cutoff = ranked[Math.min(size, ranked.length) - 1];
  if (!cutoff) return [];
  return ranked.filter((c) => c.n >= cutoff.n).map((c) => c.id);
}

/** Where the admin console is in the ceremony. Drives which buttons are shown. */
export type RoundStep =
  | "idle"
  | "nominating"
  | "needs-nominee"
  | "ready-to-vote"
  | "voting"
  | "ready-to-reveal"
  | "evicting"
  | "crowned";

export interface RoundBallotView {
  name: string;
  /** Display names they nominated. Empty if they haven't yet. */
  picks: string[];
}

export interface RoundChoice {
  /** Session id (canAdd) or nominee token (a tie-break). */
  id: string;
  name: string;
}

/** Server → Big Brother console only. Never forwarded to housemates or viewers. */
export interface RoundAdminView {
  step: RoundStep;
  text: string;
  /** "" | "save" | "finale" */
  kind: string;
  /** How many viewers have voted. Who they voted for stays hidden until the reveal. */
  votesCast: number;
  ballots: RoundBallotView[];
  /** Housemates Big Brother can add so the slate reaches two nominees. */
  canAdd: RoundChoice[];
  /** Set when the reveal is a tie and Big Brother has to choose. */
  tie: RoundChoice[];
}

/** Server → the housemate who may nominate. Only they receive it. */
export interface NominationStatusMessage {
  /** False once Big Brother has closed nominations. */
  open: boolean;
  /** How many housemates they must name (2 with Extra nomination power, otherwise 1). */
  slots: number;
  submitted: boolean;
  pickedNames: string[];
  choices: Array<{ id: string; name: string; immune: boolean }>;
}

export interface NominateMessage {
  /** Session ids of the housemates being nominated. */
  nomineeIds: string[];
}

export interface VoteMessage {
  /** Nominee token from the synced round (stable even if they disconnect). */
  token: string;
}

export interface VoteAckMessage {
  ok: boolean;
  text: string;
  /** Token they voted for, or "" when the vote was rejected. */
  token: string;
}

export interface AdminOpenVotingMessage {
  seconds: number;
}

export interface AdminRevealMessage {
  /** Set only to break a tie. */
  token?: string;
}

/** One nominee, as synced to every client. `votes` is -1 until the reveal. */
export interface NomineeView {
  token: string;
  /** Session id while they're in the house, otherwise "". */
  playerId: string;
  name: string;
  color: string;
  votes: number;
}

export interface RoundView {
  /** free | nominations | voting | eviction | finale */
  phase: string;
  round: number;
  /** "" | "save" | "finale" */
  kind: string;
  /** Server time (ms) voting closes. 0 until a window is opened. */
  voteEndsAt: number;
  votingOpen: boolean;
  nominees: NomineeView[];
  evictedName: string;
  winnerName: string;
  winnerColor: string;
}
