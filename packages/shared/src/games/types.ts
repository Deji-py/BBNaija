import type { GameId } from "../gameStations.js";

/**
 * Games framework. Each game is a set of pure functions over a plain-JSON
 * state object. The server owns the state and runs these; clients only send
 * moves and draw whatever view the server sends back. Moves arrive from
 * untrusted clients, so `move` validates everything and returns an error
 * message instead of throwing.
 */

/** Random numbers in [0, 1). The server passes Math.random; tests pass a seeded one. */
export type Rng = () => number;

export interface GameResult {
  /** Winning seats; empty means a draw. */
  winners: number[];
  /** Shown under the board, e.g. "Checkmate" or "Ada wins 5–3". Seat names are filled in by the client. */
  text: string;
}

export interface GameDef<S = any> {
  id: GameId;
  name: string;
  /** Emoji shown on signs and in the panel. */
  icon: string;
  /** One line of how to play, shown in the panel. */
  rules: string;
  minPlayers: number;
  maxPlayers: number;
  /** Stepped by the server several times a second (paddles, pucks, light cycles). */
  realtime?: boolean;
  setup(players: number, rng: Rng): S;
  /** Seats whose move is awaited right now ([] once the game is over). */
  turn(s: S): number[];
  /** Apply a move for `seat`, mutating `s`. Returns an error message for an illegal move. */
  move(s: S, seat: number, move: unknown, rng: Rng): string | null;
  /** Real-time games: advance `dt` seconds. */
  tick?(s: S, dt: number, rng: Rng): void;
  /** Real-time games: latest control input from a seat (e.g. paddle direction). */
  input?(s: S, seat: number, input: unknown): void;
  result(s: S): GameResult | null;
  /** What a seat (or a watcher, seat null) may see. Defaults to the whole state. */
  view?(s: S, seat: number | null): unknown;
  /** Every legal move for `seat` right now. Used by tests to play random games to the end. */
  moves?(s: S, seat: number): unknown[];
}

export function defineGame<S>(def: GameDef<S>): GameDef<S> {
  return def;
}

// ------------------------------------------------------------ helpers for game code

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** An integer field in [min, max], or null. */
export function intField(m: unknown, key: string, min: number, max: number): number | null {
  if (!isObj(m)) return null;
  const v = m[key];
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** A finite number field clamped to [min, max], or null. */
export function numField(m: unknown, key: string, min: number, max: number): number | null {
  if (!isObj(m)) return null;
  const v = m[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function rollDie(rng: Rng): number {
  return 1 + Math.floor(rng() * 6);
}

/** Seats with the highest score (all of them on a tie). */
export function topSeats(scores: number[]): number[] {
  const best = Math.max(...scores);
  return scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
}

/** "3–2" or "12 · 9 · 4" for result lines. */
export function scoreLine(scores: number[]): string {
  return scores.join(scores.length === 2 ? "–" : " · ");
}
