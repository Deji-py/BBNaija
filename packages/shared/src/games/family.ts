import { defineGame, intField, isObj, rollDie, scoreLine, topSeats, type GameResult } from "./types.js";

/** Family games: Ayo (Yoruba mancala), Snakes & Ladders, Ludo, Yacht dice and Pig. */

// ------------------------------------------------------------ Ayo Olopon

/**
 * Two rows of six pits, four seeds each. Seat 0 owns pits 0–5, seat 1 owns 6–11;
 * seeds are sown anticlockwise (increasing index). Rules follow Oware/Ayo:
 * capture 2s and 3s at the end of a sowing in the opponent's row (and the
 * chain of 2s and 3s behind it), never all of their seeds at once, and you
 * must give an empty opponent seeds when you can.
 */
export interface AyoState {
  pits: number[];
  stores: number[];
  turn: number;
  last: number;
  /** Pits captured on the last move (for highlighting). */
  took: number[];
  moves: number;
  over: GameResult | null;
}

const ownsPit = (seat: number, pit: number) => Math.floor(pit / 6) === seat;

function sow(pits: number[], from: number): { pits: number[]; last: number } {
  const out = [...pits];
  let seeds = out[from]!;
  out[from] = 0;
  let i = from;
  while (seeds > 0) {
    i = (i + 1) % 12;
    if (i === from) continue; // a big house skips the pit it came from
    out[i]! += 1;
    seeds--;
  }
  return { pits: out, last: i };
}

function ayoLegal(s: AyoState, seat: number): number[] {
  const own = [0, 1, 2, 3, 4, 5].map((k) => seat * 6 + k).filter((p) => s.pits[p]! > 0);
  const oppEmpty = s.pits.every((v, p) => ownsPit(seat, p) || v === 0);
  if (!oppEmpty) return own;
  // They have nothing: you must feed them if any move does.
  const feeding = own.filter((p) => sow(s.pits, p).pits.some((v, q) => !ownsPit(seat, q) && v > 0));
  return feeding;
}

function ayoFinish(s: AyoState, text: string): void {
  // Each player keeps the seeds left on their own side.
  s.pits.forEach((v, p) => {
    s.stores[Math.floor(p / 6)]! += v;
    s.pits[p] = 0;
  });
  s.over = s.stores[0] === s.stores[1] ? { winners: [], text: `Draw, ${scoreLine(s.stores)}` } : { winners: topSeats(s.stores), text: `${text} (${scoreLine(s.stores)})` };
}

export const ayo = defineGame<AyoState>({
  id: "ayo",
  name: "Ayo Olopon",
  icon: "🥥",
  rules: "Pick a pit on your side to sow its seeds anticlockwise. End in their row on 2 or 3 seeds to capture. First past 24 wins.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ pits: Array(12).fill(4), stores: [0, 0], turn: 0, last: -1, took: [], moves: 0, over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const pit = intField(m, "pit", 0, 11);
    if (pit === null || !ownsPit(seat, pit)) return "Pick a pit on your side";
    if (!ayoLegal(s, seat).includes(pit)) return s.pits[pit] ? "You must give your opponent seeds" : "That pit is empty";
    const sown = sow(s.pits, pit);
    const pits = sown.pits;
    let took: number[] = [];
    for (let i = sown.last; !ownsPit(seat, i) && (pits[i] === 2 || pits[i] === 3); i = (i + 11) % 12) took.push(i);
    // Grand slam: capturing every seed they have is not allowed — capture nothing.
    const theirTotal = pits.reduce((sum, v, p) => (ownsPit(seat, p) ? sum : sum + v), 0);
    const takenTotal = took.reduce((sum, p) => sum + pits[p]!, 0);
    if (takenTotal === theirTotal) took = [];
    for (const p of took) {
      s.stores[seat]! += pits[p]!;
      pits[p] = 0;
    }
    s.pits = pits;
    s.took = took;
    s.last = pit;
    s.moves++;
    if (s.stores[seat]! > 24) {
      ayoFinish(s, "Over half the seeds");
      return null;
    }
    s.turn = 1 - seat;
    if (!ayoLegal(s, s.turn).length) ayoFinish(s, "No moves left");
    else if (s.moves >= 300) ayoFinish(s, "Move limit");
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => ayoLegal(s, seat).map((pit) => ({ pit })),
});

// ------------------------------------------------------------ Snakes & Ladders

/** Square → where you end up (ladders go up, snakes go down). */
export const JUMPS: Readonly<Record<number, number>> = {
  1: 38,
  4: 14,
  9: 31,
  21: 42,
  28: 84,
  36: 44,
  51: 67,
  71: 91,
  80: 100,
  16: 6,
  47: 26,
  49: 11,
  56: 53,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  98: 78,
};

export interface SnakesState {
  pos: number[];
  turn: number;
  roll: number;
  /** What happened on the last roll, e.g. "Ada climbed a ladder to 38". */
  note: string;
  lastSeat: number;
  over: GameResult | null;
}

export const snakes = defineGame<SnakesState>({
  id: "snakes",
  name: "Snakes & Ladders",
  icon: "🐍",
  rules: "Roll and race to 100. Ladders take you up, snakes take you down. Overshoot 100 and you bounce back.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({ pos: Array(players).fill(0), turn: 0, roll: 0, note: "", lastSeat: -1, over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    if (!isObj(m) || m.roll !== true) return "Roll the die";
    const roll = rollDie(rng);
    let to = s.pos[seat]! + roll;
    if (to > 100) to = 200 - to;
    const jump = JUMPS[to];
    s.note = jump ? (jump > to ? `ladder to ${jump}` : `snake down to ${jump}`) : `moved to ${to}`;
    s.pos[seat] = jump ?? to;
    s.roll = roll;
    s.lastSeat = seat;
    if (s.pos[seat] === 100) s.over = { winners: [seat], text: "Reached 100!" };
    else if (roll !== 6) s.turn = (seat + 1) % s.pos.length; // a six rolls again
    return null;
  },
  result: (s) => s.over,
  moves: () => [{ roll: true }],
});

// ------------------------------------------------------------ Ludo

/** The shared 52-square track on a 15×15 grid, as [col, row], clockwise from red's start. */
export const LUDO_TRACK: ReadonlyArray<readonly [number, number]> = (() => {
  const t: Array<[number, number]> = [];
  for (let c = 1; c <= 5; c++) t.push([c, 6]);
  for (let r = 5; r >= 0; r--) t.push([6, r]);
  t.push([7, 0]);
  for (let r = 0; r <= 5; r++) t.push([8, r]);
  for (let c = 9; c <= 14; c++) t.push([c, 6]);
  t.push([14, 7]);
  for (let c = 14; c >= 9; c--) t.push([c, 8]);
  for (let r = 9; r <= 14; r++) t.push([8, r]);
  t.push([7, 14]);
  for (let r = 14; r >= 9; r--) t.push([6, r]);
  for (let c = 5; c >= 0; c--) t.push([c, 8]);
  t.push([0, 7]);
  t.push([0, 6]);
  return t;
})();

/** Colour slots: 0 red (top-left), 1 green (top-right), 2 yellow (bottom-right), 3 blue (bottom-left). */
export const LUDO_START = [0, 13, 26, 39];
/** Each colour's five home-column squares, then the centre. */
export const LUDO_HOME: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [1, 2, 3, 4, 5].map((c) => [c, 7] as const),
  [1, 2, 3, 4, 5].map((r) => [7, r] as const),
  [13, 12, 11, 10, 9].map((c) => [c, 7] as const),
  [13, 12, 11, 10, 9].map((r) => [7, r] as const),
];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
/** Progress: -1 in base, 0–50 on the track, 51–55 home column, 56 home. */
export const LUDO_HOME_STEP = 56;

export interface LudoState {
  /** Colour slot per seat (2 players sit opposite each other). */
  colors: number[];
  tokens: number[][];
  turn: number;
  /** Die value waiting to be used, or 0 when it's time to roll. */
  roll: number;
  lastRoll: number;
  note: string;
  over: GameResult | null;
}

/** Track square of a token, or -1 if it's in base or the home column. */
export function ludoSquare(color: number, progress: number): number {
  return progress >= 0 && progress <= 50 ? (LUDO_START[color]! + progress) % 52 : -1;
}

function ludoMovable(s: LudoState, seat: number, roll: number): number[] {
  return s.tokens[seat]!.flatMap((p, k) => {
    if (p === -1) return roll === 6 ? [k] : [];
    if (p === LUDO_HOME_STEP) return [];
    return p + roll <= LUDO_HOME_STEP ? [k] : [];
  });
}

export const ludo = defineGame<LudoState>({
  id: "ludo",
  name: "Ludo",
  icon: "🎲",
  rules: "Roll a 6 to bring a token out. Land on an opponent to send them home (stars and starts are safe). Get all four home to win. Sixes, captures and reaching home roll again.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({
    colors: players === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, players),
    tokens: Array.from({ length: players }, () => [-1, -1, -1, -1]),
    turn: 0,
    roll: 0,
    lastRoll: 0,
    note: "",
    over: null,
  }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    const next = () => (s.turn = (seat + 1) % s.tokens.length);
    if (s.roll === 0) {
      if (!isObj(m) || m.roll !== true) return "Roll the die";
      const roll = rollDie(rng);
      s.lastRoll = roll;
      if (!ludoMovable(s, seat, roll).length) {
        s.note = roll === 6 ? "rolled a 6 but can't move" : `rolled ${roll} — no move`;
        if (roll !== 6) next();
        return null;
      }
      s.roll = roll;
      s.note = `rolled ${roll}`;
      return null;
    }
    const k = intField(m, "token", 0, 3);
    if (k === null || !ludoMovable(s, seat, s.roll).includes(k)) return "Pick a token that can move";
    const color = s.colors[seat]!;
    const tokens = s.tokens[seat]!;
    const roll = s.roll;
    s.roll = 0;
    tokens[k] = tokens[k] === -1 ? 0 : tokens[k]! + roll;
    let again = roll === 6;
    if (tokens[k] === LUDO_HOME_STEP) {
      again = true;
      s.note = "got a token home!";
    }
    const square = ludoSquare(color, tokens[k]!);
    if (square >= 0 && !SAFE.has(square)) {
      s.tokens.forEach((theirs, other) => {
        if (other === seat) return;
        theirs.forEach((p, j) => {
          if (ludoSquare(s.colors[other]!, p) === square) {
            theirs[j] = -1;
            again = true;
            s.note = "captured a token!";
          }
        });
      });
    }
    if (tokens.every((p) => p === LUDO_HOME_STEP)) {
      s.over = { winners: [seat], text: "All four tokens home!" };
      return null;
    }
    if (!again) next();
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => (s.roll === 0 ? [{ roll: true }] : ludoMovable(s, seat, s.roll).map((token) => ({ token }))),
});

// ------------------------------------------------------------ Yacht (dice poker)

export const YACHT_CATEGORIES = [
  "Ones",
  "Twos",
  "Threes",
  "Fours",
  "Fives",
  "Sixes",
  "Three of a kind",
  "Four of a kind",
  "Full house",
  "Small straight",
  "Large straight",
  "Yacht",
  "Chance",
] as const;

export function yachtScore(dice: number[], cat: number): number {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d]! += 1;
  const sum = dice.reduce((a, b) => a + b, 0);
  const has = (n: number) => counts.some((c) => c >= n);
  const run = (len: number) => {
    let best = 0;
    let cur = 0;
    for (let v = 1; v <= 6; v++) {
      cur = counts[v]! > 0 ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    return best >= len;
  };
  if (cat <= 5) return counts[cat + 1]! * (cat + 1);
  switch (cat) {
    case 6:
      return has(3) ? sum : 0;
    case 7:
      return has(4) ? sum : 0;
    case 8:
      return counts.includes(3) && counts.includes(2) ? 25 : 0;
    case 9:
      return run(4) ? 30 : 0;
    case 10:
      return run(5) ? 40 : 0;
    case 11:
      return has(5) ? 50 : 0;
    default:
      return sum;
  }
}

/** Upper-section bonus: 35 for 63 or more in ones–sixes. */
export function yachtTotal(card: Array<number | null>): number {
  const upper = card.slice(0, 6).reduce<number>((a, b) => a + (b ?? 0), 0);
  return card.reduce<number>((a, b) => a + (b ?? 0), 0) + (upper >= 63 ? 35 : 0);
}

export interface YachtState {
  dice: number[];
  held: boolean[];
  rollsLeft: number;
  cards: Array<Array<number | null>>;
  turn: number;
  over: GameResult | null;
}

export const yacht = defineGame<YachtState>({
  id: "yacht",
  name: "Yacht Dice",
  icon: "🎯",
  rules: "Roll five dice up to three times, holding any you like, then score them in one of 13 boxes. Highest total wins.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    cards: Array.from({ length: players }, () => Array(13).fill(null)),
    turn: 0,
    over: null,
  }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    if (!isObj(m)) return "Roll or score";
    if (m.roll === true) {
      if (s.rollsLeft === 0) return "No rolls left — pick a box to score";
      const hold = Array.isArray(m.hold) && s.rollsLeft < 3 ? m.hold.slice(0, 5).map((h) => h === true) : [false, false, false, false, false];
      s.held = [0, 1, 2, 3, 4].map((i) => !!hold[i]);
      s.dice = s.dice.map((d, i) => (s.held[i] ? d : rollDie(rng)));
      s.rollsLeft--;
      return null;
    }
    const cat = intField(m, "score", 0, 12);
    if (cat === null) return "Pick a box to score";
    if (s.rollsLeft === 3) return "Roll first";
    const card = s.cards[seat]!;
    if (card[cat] !== null) return "You've already used that box";
    card[cat] = yachtScore(s.dice, cat);
    s.rollsLeft = 3;
    s.held = [false, false, false, false, false];
    s.turn = (seat + 1) % s.cards.length;
    if (s.cards.every((c) => c.every((v) => v !== null))) {
      const totals = s.cards.map(yachtTotal);
      const winners = topSeats(totals);
      s.over = { winners: winners.length === totals.length ? [] : winners, text: `Totals ${scoreLine(totals)}` };
    }
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => {
    const scores = s.cards[seat]!.flatMap((v, score) => (v === null && s.rollsLeft < 3 ? [{ score }] : []));
    return s.rollsLeft > 0 ? [{ roll: true, hold: [true, false, true, false, false] }, ...scores] : scores;
  },
});

// ------------------------------------------------------------ Pig

const PIG_TARGET = 50;

export interface PigState {
  scores: number[];
  pot: number;
  turn: number;
  roll: number;
  note: string;
  over: GameResult | null;
}

export const pig = defineGame<PigState>({
  id: "pig",
  name: "Pig",
  icon: "🐷",
  rules: `Roll as often as you dare — each roll adds to your pot, but a 1 wipes it. Hold to bank it. First to ${PIG_TARGET} wins.`,
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({ scores: Array(players).fill(0), pot: 0, turn: 0, roll: 0, note: "", over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    const next = () => {
      s.pot = 0;
      s.turn = (seat + 1) % s.scores.length;
    };
    if (isObj(m) && m.roll === true) {
      const roll = rollDie(rng);
      s.roll = roll;
      if (roll === 1) {
        s.note = "rolled a 1 — pot lost!";
        next();
      } else {
        s.pot += roll;
        s.note = `rolled ${roll}`;
        if (s.scores[seat]! + s.pot >= PIG_TARGET) {
          s.scores[seat]! += s.pot;
          s.over = { winners: [seat], text: `Reached ${PIG_TARGET}!` };
        }
      }
      return null;
    }
    if (isObj(m) && m.hold === true) {
      if (s.pot === 0) return "Roll at least once";
      s.scores[seat]! += s.pot;
      s.note = `banked ${s.pot}`;
      next();
      return null;
    }
    return "Roll or hold";
  },
  result: (s) => s.over,
  moves: (s) => (s.pot >= 12 ? [{ hold: true }] : [{ roll: true }]),
});
