import { defineGame, intField, isObj, shuffle, topSeats, type GameResult, type Rng } from "./types.js";

/** Card games: Naija Whot! and Blackjack. */

// ------------------------------------------------------------ Whot!

export const WHOT_SHAPES = ["circle", "triangle", "cross", "square", "star"] as const;
export type WhotShape = (typeof WHOT_SHAPES)[number];

export interface WhotCard {
  shape: WhotShape | "whot";
  n: number;
}

function whotDeck(): WhotCard[] {
  const deck: WhotCard[] = [];
  const add = (shape: WhotShape, ns: number[]) => ns.forEach((n) => deck.push({ shape, n }));
  add("circle", [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
  add("triangle", [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
  add("cross", [1, 2, 3, 5, 7, 10, 11, 13, 14]);
  add("square", [1, 2, 3, 5, 7, 10, 11, 13, 14]);
  add("star", [1, 2, 3, 4, 5, 7, 8]);
  for (let i = 0; i < 5; i++) deck.push({ shape: "whot", n: 20 });
  return deck;
}

/** What the special cards do, for the rules line and the client's hints. */
export const WHOT_SPECIALS: Readonly<Record<number, string>> = {
  1: "Hold on — play again",
  2: "Pick two",
  5: "Pick three",
  8: "Suspension — next player misses a turn",
  14: "General market — everyone else picks one",
  20: "Whot — ask for any shape",
};

export interface WhotState {
  hands: WhotCard[][];
  market: WhotCard[];
  pile: WhotCard[];
  /** Shape asked for with a Whot card, or "". */
  request: WhotShape | "";
  turn: number;
  note: string;
  lastSeat: number;
  over: GameResult | null;
}

const top = (s: WhotState) => s.pile[s.pile.length - 1]!;

function whotPlayable(s: WhotState, card: WhotCard): boolean {
  if (card.shape === "whot") return true;
  if (s.request) return card.shape === s.request;
  const t = top(s);
  return card.shape === t.shape || card.n === t.n;
}

/** Deal `n` cards from the market to a seat, reshuffling the pile when the market runs out. Returns how many were dealt. */
function pick(s: WhotState, seat: number, n: number, rng: Rng): number {
  let dealt = 0;
  for (let i = 0; i < n; i++) {
    if (!s.market.length && s.pile.length > 1) {
      const keep = s.pile.pop()!;
      s.market = shuffle(s.pile, rng);
      s.pile = [keep];
    }
    const card = s.market.pop();
    if (!card) break;
    s.hands[seat]!.push(card);
    dealt++;
  }
  return dealt;
}

/** Market's dry: lowest total in hand wins ("tender"). */
function tender(s: WhotState): void {
  const totals = s.hands.map((h) => h.reduce((a, c) => a + c.n, 0));
  const low = Math.min(...totals);
  s.over = { winners: topSeats(totals.map((t) => -t)), text: `Market finished — lowest hand (${low}) wins` };
}

export const whot = defineGame<WhotState>({
  id: "whot",
  name: "Whot!",
  icon: "🃏",
  rules: "Match the shape or number on top. 1 hold on, 2 pick two, 5 pick three, 8 suspension, 14 general market, 20 Whot (ask for a shape). First to empty their hand wins.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players, rng) => {
    const market = shuffle(whotDeck(), rng);
    const hands = Array.from({ length: players }, () => market.splice(-5));
    // Start on an ordinary card.
    let first = market.findIndex((c) => !(c.n in WHOT_SPECIALS));
    if (first < 0) first = 0;
    const pile = market.splice(first, 1);
    return { hands, market, pile, request: "", turn: 0, note: "", lastSeat: -1, over: null };
  },
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    const players = s.hands.length;
    const nextSeat = (k: number) => (seat + k) % players;
    const hand = s.hands[seat]!;
    s.lastSeat = seat;
    if (isObj(m) && m.draw === true) {
      if (!pick(s, seat, 1, rng)) {
        tender(s);
        return null;
      }
      s.note = "went to market";
      s.turn = nextSeat(1);
      return null;
    }
    const i = intField(m, "play", 0, hand.length - 1);
    if (i === null) return "Play a card or go to market";
    const card = hand[i]!;
    if (!whotPlayable(s, card)) return s.request ? `Whot asked for ${s.request}` : "Match the shape or the number";
    let shape: WhotShape | "" = "";
    if (card.shape === "whot") {
      const asked = isObj(m) ? m.shape : undefined;
      if (!WHOT_SHAPES.includes(asked as WhotShape)) return "Choose the shape you want";
      shape = asked as WhotShape;
    }
    hand.splice(i, 1);
    s.pile.push(card);
    s.request = shape;
    if (!hand.length) {
      s.over = { winners: [seat], text: "Check up! Last card played" };
      return null;
    }
    switch (card.n) {
      case 1:
        s.note = "Hold on!";
        s.turn = seat;
        break;
      case 2:
      case 5: {
        const victim = nextSeat(1);
        const n = card.n === 2 ? 2 : 3;
        pick(s, victim, n, rng);
        s.note = `Pick ${n === 2 ? "two" : "three"}!`;
        s.turn = nextSeat(2);
        break;
      }
      case 8:
        s.note = "Suspension!";
        s.turn = nextSeat(2);
        break;
      case 14:
        for (let k = 1; k < players; k++) pick(s, nextSeat(k), 1, rng);
        s.note = "General market!";
        s.turn = seat;
        break;
      case 20:
        s.note = `Whot! I need ${shape}`;
        s.turn = nextSeat(1);
        break;
      default:
        s.note = "";
        s.turn = nextSeat(1);
    }
    if (hand.length === 1) s.note = `${s.note ? s.note + " " : ""}Last card!`;
    return null;
  },
  result: (s) => s.over,
  view: (s, seat) => ({
    ...s,
    hands: undefined,
    market: undefined,
    hand: seat === null ? [] : s.hands[seat],
    counts: s.hands.map((h) => h.length),
    marketCount: s.market.length,
    top: top(s),
    pile: undefined,
  }),
  moves: (s, seat) => {
    const out: unknown[] = [];
    s.hands[seat]!.forEach((card, play) => {
      if (whotPlayable(s, card)) out.push(card.shape === "whot" ? { play, shape: "star" } : { play });
    });
    // You may always go to market, but tests only do it when stuck, so games end.
    return out.length ? out : [{ draw: true }];
  },
});

// ------------------------------------------------------------ Blackjack

export interface Card {
  /** 1 = ace … 13 = king. */
  r: number;
  /** 0 ♠, 1 ♥, 2 ♦, 3 ♣ */
  s: number;
}

export const BLACKJACK_ROUNDS = 5;
const BET = 10;

export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += c.r === 1 ? 11 : Math.min(10, c.r);
    if (c.r === 1) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export interface BlackjackState {
  shoe: Card[];
  hands: Card[][];
  dealer: Card[];
  bets: number[];
  chips: number[];
  /** Seats still deciding this round, in order; the first one is up. */
  waiting: number[];
  round: number;
  /** Outcome of the round just finished, per seat (+/- chips), for the client to show. */
  lastRound: { dealer: Card[]; hands: Card[][]; deltas: number[] } | null;
  over: GameResult | null;
}

function newShoe(rng: Rng): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < 4; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) shoe.push({ r, s });
  return shuffle(shoe, rng);
}

function draw(state: BlackjackState, rng: Rng): Card {
  if (state.shoe.length < 20) state.shoe = newShoe(rng);
  return state.shoe.pop()!;
}

function deal(s: BlackjackState, rng: Rng): void {
  s.round++;
  s.hands = s.hands.map(() => [draw(s, rng), draw(s, rng)]);
  s.dealer = [draw(s, rng), draw(s, rng)];
  s.bets = s.hands.map(() => BET);
  // Naturals (21 in two cards) stand automatically.
  s.waiting = s.hands.map((_, i) => i).filter((i) => handValue(s.hands[i]!) < 21);
  if (!s.waiting.length) settle(s, rng);
}

function settle(s: BlackjackState, rng: Rng): void {
  const anyAlive = s.hands.some((h) => handValue(h) <= 21);
  while (anyAlive && handValue(s.dealer) < 17) s.dealer.push(draw(s, rng));
  const dealer = handValue(s.dealer);
  const dealerNatural = dealer === 21 && s.dealer.length === 2;
  const deltas = s.hands.map((h, i) => {
    const v = handValue(h);
    const bet = s.bets[i]!;
    const natural = v === 21 && h.length === 2;
    if (v > 21) return -bet;
    if (natural && !dealerNatural) return Math.round(bet * 1.5);
    if (dealerNatural && !natural) return -bet;
    if (dealer > 21 || v > dealer) return bet;
    return v === dealer ? 0 : -bet;
  });
  deltas.forEach((d, i) => (s.chips[i]! += d));
  s.lastRound = { dealer: [...s.dealer], hands: s.hands.map((h) => [...h]), deltas };
  if (s.round >= BLACKJACK_ROUNDS) {
    const winners = topSeats(s.chips);
    s.over = { winners: s.chips.length > 1 && winners.length === s.chips.length ? [] : winners, text: `Chips: ${s.chips.join(" · ")}` };
    s.waiting = [];
    return;
  }
  deal(s, rng);
}

export const blackjack = defineGame<BlackjackState>({
  id: "blackjack",
  name: "Blackjack",
  icon: "🂡",
  rules: `Beat the dealer without going over 21. Hit for a card, stand to stop, double to bet twice on one more card. ${BLACKJACK_ROUNDS} hands — most chips wins. Play alone or together.`,
  minPlayers: 1,
  maxPlayers: 4,
  setup: (players, rng) => {
    const s: BlackjackState = {
      shoe: newShoe(rng),
      hands: Array.from({ length: players }, () => []),
      dealer: [],
      bets: [],
      chips: Array(players).fill(100),
      waiting: [],
      round: 0,
      lastRound: null,
      over: null,
    };
    deal(s, rng);
    return s;
  },
  turn: (s) => (s.over ? [] : s.waiting.slice(0, 1)),
  move(s, seat, m, rng) {
    if (s.waiting[0] !== seat) return "Wait for your turn";
    const hand = s.hands[seat]!;
    const done = () => {
      s.waiting.shift();
      if (!s.waiting.length) settle(s, rng);
    };
    if (isObj(m) && m.hit === true) {
      hand.push(draw(s, rng));
      if (handValue(hand) >= 21) done();
      return null;
    }
    if (isObj(m) && m.double === true) {
      if (hand.length !== 2) return "You can only double on your first two cards";
      s.bets[seat] = BET * 2;
      hand.push(draw(s, rng));
      done();
      return null;
    }
    if (isObj(m) && m.stand === true) {
      done();
      return null;
    }
    return "Hit, stand or double";
  },
  result: (s) => s.over,
  // The dealer's second card stays face down while anyone is still playing; the shoe is never shown.
  view: (s) => ({ ...s, shoe: undefined, dealer: s.waiting.length ? [s.dealer[0], null] : s.dealer }),
  moves: (s, seat) => (s.waiting[0] === seat ? [{ hit: true }, { stand: true }, ...(s.hands[seat]!.length === 2 ? [{ double: true }] : [])] : []),
});
