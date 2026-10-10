import { defineGame, intField, isObj, type GameResult } from "./types.js";

/** Classic strategy boards: checkers (draughts), Nine Men's Morris and Go. */

const EMPTY = -1;

// ------------------------------------------------------------ Checkers (English draughts)

/**
 * 8×8, pieces on dark squares. Seat 0 starts on rows 5–7 and moves up; seat 1
 * on rows 0–2 and moves down. Values: -1 empty, seat (0/1) for a man, seat + 2 for a king.
 * Captures are compulsory, and a capturing piece keeps jumping while it can.
 */
export interface CheckersState {
  board: number[];
  turn: number;
  /** Square of the piece that must keep jumping this turn, or -1. */
  chain: number;
  last: { from: number; to: number } | null;
  /** Moves since the last capture or crowning (draw at 80). */
  quiet: number;
  over: GameResult | null;
}

const owner = (v: number) => (v < 0 ? -1 : v % 2);
const isKing = (v: number) => v >= 2;

function checkerSteps(board: number[], from: number, jumpsOnly: boolean): Array<{ from: number; to: number; jump: number }> {
  const v = board[from]!;
  const who = owner(v);
  const r = Math.floor(from / 8);
  const c = from % 8;
  const forward = who === 0 ? -1 : 1;
  const rows = isKing(v) ? [-1, 1] : [forward];
  const out: Array<{ from: number; to: number; jump: number }> = [];
  for (const dr of rows) {
    for (const dc of [-1, 1]) {
      const r1 = r + dr;
      const c1 = c + dc;
      if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
      const mid = r1 * 8 + c1;
      if (board[mid] === EMPTY) {
        if (!jumpsOnly) out.push({ from, to: mid, jump: -1 });
        continue;
      }
      if (owner(board[mid]!) !== 1 - who) continue;
      const r2 = r + 2 * dr;
      const c2 = c + 2 * dc;
      if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
      if (board[r2 * 8 + c2] === EMPTY) out.push({ from, to: r2 * 8 + c2, jump: mid });
    }
  }
  return out;
}

export function checkersMoves(s: CheckersState, who: number): Array<{ from: number; to: number; jump: number }> {
  if (s.chain >= 0) return checkerSteps(s.board, s.chain, true);
  const all = s.board.flatMap((v, i) => (owner(v) === who ? checkerSteps(s.board, i, false) : []));
  const jumps = all.filter((m) => m.jump >= 0);
  return jumps.length ? jumps : all;
}

export const checkers = defineGame<CheckersState>({
  id: "checkers",
  name: "Checkers",
  icon: "⛀",
  rules: "Move diagonally forward. Jumping is compulsory and you keep jumping while you can. Reach the far side to be crowned.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => {
    const board = Array(64).fill(EMPTY);
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8);
      if ((r + (i % 8)) % 2 === 1) board[i] = r < 3 ? 1 : r > 4 ? 0 : EMPTY;
    }
    return { board, turn: 0, chain: -1, last: null, quiet: 0, over: null };
  },
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const from = intField(m, "from", 0, 63);
    const to = intField(m, "to", 0, 63);
    if (from === null || to === null) return "Pick a piece and a square";
    const legal = checkersMoves(s, seat).find((x) => x.from === from && x.to === to);
    if (!legal) {
      const anyJump = checkersMoves(s, seat).some((x) => x.jump >= 0);
      return anyJump ? "You must take — jumping is compulsory" : "That move isn't allowed";
    }
    const piece = s.board[from]!;
    s.board[to] = piece;
    s.board[from] = EMPTY;
    s.last = { from, to };
    const row = Math.floor(to / 8);
    const crowned = !isKing(piece) && ((seat === 0 && row === 0) || (seat === 1 && row === 7));
    if (crowned) s.board[to] = piece + 2;
    if (legal.jump >= 0) s.board[legal.jump] = EMPTY;
    s.quiet = legal.jump >= 0 || crowned ? 0 : s.quiet + 1;
    // Keep jumping with the same piece if it can (a newly crowned king stops).
    if (legal.jump >= 0 && !crowned && checkerSteps(s.board, to, true).length) {
      s.chain = to;
      return null;
    }
    s.chain = -1;
    s.turn = 1 - seat;
    if (!checkersMoves(s, s.turn).length) s.over = { winners: [seat], text: "No moves left for the other side" };
    else if (s.quiet >= 80) s.over = { winners: [], text: "Draw — 40 moves each without a capture" };
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => checkersMoves(s, seat).map(({ from, to }) => ({ from, to })),
});

// ------------------------------------------------------------ Nine Men's Morris

/**
 *  0-----------1-----------2
 *  |   3-------4-------5   |
 *  |   |   6---7---8   |   |
 *  9--10--11       12--13--14
 *  |   |  15--16--17   |   |
 *  |  18------19------20   |
 * 21----------22----------23
 */
export const MORRIS_ADJ: readonly number[][] = [
  [1, 9],
  [0, 2, 4],
  [1, 14],
  [4, 10],
  [1, 3, 5, 7],
  [4, 13],
  [7, 11],
  [4, 6, 8],
  [7, 12],
  [0, 10, 21],
  [3, 9, 11, 18],
  [6, 10, 15],
  [8, 13, 17],
  [5, 12, 14, 20],
  [2, 13, 23],
  [11, 16],
  [15, 17, 19],
  [12, 16],
  [10, 19],
  [16, 18, 20, 22],
  [13, 19],
  [9, 22],
  [19, 21, 23],
  [14, 22],
];

const MILLS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
  [12, 13, 14],
  [15, 16, 17],
  [18, 19, 20],
  [21, 22, 23],
  [0, 9, 21],
  [3, 10, 18],
  [6, 11, 15],
  [1, 4, 7],
  [16, 19, 22],
  [8, 12, 17],
  [5, 13, 20],
  [2, 14, 23],
];

export interface MorrisState {
  board: number[];
  inHand: number[];
  turn: number;
  /** After forming a mill, the same player removes an opposing piece. */
  removing: boolean;
  quiet: number;
  last: number;
  over: GameResult | null;
}

function inMill(board: number[], p: number): boolean {
  return MILLS.some((m) => m.includes(p) && m.every((q) => board[q] === board[p]));
}

const countOn = (s: MorrisState, who: number) => s.board.filter((v) => v === who).length;

function morrisMoves(s: MorrisState, who: number): unknown[] {
  if (s.removing) {
    const theirs = s.board.flatMap((v, p) => (v === 1 - who ? [p] : []));
    const free = theirs.filter((p) => !inMill(s.board, p));
    return (free.length ? free : theirs).map((remove) => ({ remove }));
  }
  if (s.inHand[who]! > 0) return s.board.flatMap((v, place) => (v === EMPTY ? [{ place }] : []));
  const flying = countOn(s, who) === 3;
  const out: unknown[] = [];
  s.board.forEach((v, from) => {
    if (v !== who) return;
    const targets = flying ? s.board.flatMap((t, i) => (t === EMPTY ? [i] : [])) : MORRIS_ADJ[from]!.filter((t) => s.board[t] === EMPTY);
    for (const to of targets) out.push({ from, to });
  });
  return out;
}

function morrisEndTurn(s: MorrisState, seat: number): void {
  s.turn = 1 - seat;
  const opp = s.turn;
  if (s.inHand[opp] === 0 && countOn(s, opp) < 3) s.over = { winners: [seat], text: "Down to two pieces" };
  else if (!morrisMoves(s, opp).length) s.over = { winners: [seat], text: "No moves left" };
  else if (s.quiet >= 100) s.over = { winners: [], text: "Draw — 50 moves each without a mill" };
}

export const morris = defineGame<MorrisState>({
  id: "morris",
  name: "Nine Men's Morris",
  icon: "⭕",
  rules: "Place your 9 pieces, then slide them along the lines. Three in a line (a mill) lets you take an enemy piece. Down to 3, you can fly anywhere.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(24).fill(EMPTY), inHand: [9, 9], turn: 0, removing: false, quiet: 0, last: -1, over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    if (!isObj(m)) return "Pick a point";
    if (s.removing) {
      const p = intField(m, "remove", 0, 23);
      if (p === null || !morrisMoves(s, seat).some((x) => (x as { remove: number }).remove === p)) return "Take one of their pieces (not from a mill, if you can help it)";
      s.board[p] = EMPTY;
      s.removing = false;
      s.quiet = 0;
      morrisEndTurn(s, seat);
      return null;
    }
    let landed: number;
    if (s.inHand[seat]! > 0) {
      const p = intField(m, "place", 0, 23);
      if (p === null || s.board[p] !== EMPTY) return "Place a piece on an empty point";
      s.board[p] = seat;
      s.inHand[seat]! -= 1;
      landed = p;
    } else {
      const from = intField(m, "from", 0, 23);
      const to = intField(m, "to", 0, 23);
      if (from === null || to === null || !morrisMoves(s, seat).some((x) => (x as { from: number }).from === from && (x as { to: number }).to === to))
        return "Slide one of your pieces to a free neighbouring point";
      s.board[to] = seat;
      s.board[from] = EMPTY;
      landed = to;
    }
    s.last = landed;
    s.quiet++;
    if (inMill(s.board, landed)) {
      s.removing = true;
      return null;
    }
    morrisEndTurn(s, seat);
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => morrisMoves(s, seat),
});

// ------------------------------------------------------------ Go (9×9)

export const GO = 9;
const KOMI = 6.5;

export interface GoState {
  board: number[];
  turn: number;
  /** Point that can't be played right now (simple ko), or -1. */
  ko: number;
  passes: number;
  captures: number[];
  last: number;
  /** Final area scores, once the game ends. */
  score: number[] | null;
  over: GameResult | null;
}

function goNeighbours(i: number): number[] {
  const r = Math.floor(i / GO);
  const c = i % GO;
  const out: number[] = [];
  if (r > 0) out.push(i - GO);
  if (r < GO - 1) out.push(i + GO);
  if (c > 0) out.push(i - 1);
  if (c < GO - 1) out.push(i + 1);
  return out;
}

/** The group containing `i` and whether it has any liberty. */
function group(board: number[], i: number): { stones: number[]; liberties: number } {
  const who = board[i];
  const stones = [i];
  const seen = new Set([i]);
  const libs = new Set<number>();
  for (let k = 0; k < stones.length; k++) {
    for (const n of goNeighbours(stones[k]!)) {
      if (board[n] === EMPTY) libs.add(n);
      else if (board[n] === who && !seen.has(n)) {
        seen.add(n);
        stones.push(n);
      }
    }
  }
  return { stones, liberties: libs.size };
}

/** Tries a stone at `cell`. Returns the new board and captured stones, or an error. */
function goPlay(s: GoState, cell: number, who: number): { board: number[]; captured: number[] } | string {
  if (s.board[cell] !== EMPTY) return "That point is taken";
  if (cell === s.ko) return "Ko — you can't retake straight away";
  const board = [...s.board];
  board[cell] = who;
  const captured: number[] = [];
  for (const n of goNeighbours(cell)) {
    if (board[n] === 1 - who) {
      const g = group(board, n);
      if (g.liberties === 0) for (const st of g.stones) if (board[st] !== EMPTY) (board[st] = EMPTY), captured.push(st);
    }
  }
  if (group(board, cell).liberties === 0) return "That would be suicide";
  return { board, captured };
}

/** Area scoring: stones plus empty regions that touch only one colour. */
export function goScore(board: number[]): number[] {
  const score = [0, 0];
  const seen = new Set<number>();
  board.forEach((v, i) => {
    if (v !== EMPTY) score[v]! += 1;
    else if (!seen.has(i)) {
      const region = [i];
      seen.add(i);
      const borders = new Set<number>();
      for (let k = 0; k < region.length; k++) {
        for (const n of goNeighbours(region[k]!)) {
          if (board[n] === EMPTY) {
            if (!seen.has(n)) seen.add(n), region.push(n);
          } else borders.add(board[n]!);
        }
      }
      if (borders.size === 1) score[[...borders][0]!]! += region.length;
    }
  });
  score[1]! += KOMI;
  return score;
}

export const go = defineGame<GoState>({
  id: "go",
  name: "Go (9×9)",
  icon: "⚪",
  rules: "Surround territory and capture stones by taking their last liberty. Two passes in a row end the game. White gets 6.5 points komi.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(GO * GO).fill(EMPTY), turn: 0, ko: -1, passes: 0, captures: [0, 0], last: -1, score: null, over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    if (isObj(m) && m.pass === true) {
      s.passes++;
      s.ko = -1;
      s.last = -1;
      s.turn = 1 - seat;
      if (s.passes >= 2) {
        const score = goScore(s.board);
        s.score = score;
        s.over = { winners: [score[0]! > score[1]! ? 0 : 1], text: `Black ${score[0]} – White ${score[1]}` };
      }
      return null;
    }
    const cell = intField(m, "cell", 0, GO * GO - 1);
    if (cell === null) return "Pick a point";
    const played = goPlay(s, cell, seat);
    if (typeof played === "string") return played;
    s.board = played.board;
    s.captures[seat]! += played.captured.length;
    // Simple ko: a single stone that captured a single stone can't be recaptured at once.
    s.ko = played.captured.length === 1 && group(s.board, cell).stones.length === 1 ? played.captured[0]! : -1;
    s.passes = 0;
    s.last = cell;
    s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => {
    const out: unknown[] = s.board.flatMap((v, cell) => (v === EMPTY && typeof goPlay(s, cell, seat) !== "string" ? [{ cell }] : []));
    // Random test games pass now and then so they finish.
    out.push({ pass: true });
    return out;
  },
});
