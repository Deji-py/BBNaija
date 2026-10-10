import { defineGame, intField, isObj, scoreLine, shuffle, topSeats, type GameResult, type Rng } from "./types.js";

/** Quick party games: Memory, Hangman, Rock–Paper–Scissors, Trivia, Code Breaker and Battleship. */

/** Winners from scores, or a draw when everyone tied. */
function byScore(scores: number[], text: string): GameResult {
  const winners = topSeats(scores);
  return { winners: winners.length === scores.length ? [] : winners, text: `${text} (${scoreLine(scores)})` };
}

// ------------------------------------------------------------ Memory

const MEMORY_FACES = ["🍍", "🥭", "🌶️", "🍌", "🥥", "🍉", "🎤", "🎧", "👑", "💎", "🔥", "⭐"];

export interface MemoryState {
  faces: string[];
  /** Who matched each card (-1 = still face down). */
  owner: number[];
  /** Cards turned up this turn (shown until the next flip after a miss). */
  up: number[];
  turn: number;
  scores: number[];
  over: GameResult | null;
}

export const memory = defineGame<MemoryState>({
  id: "memory",
  name: "Memory Match",
  icon: "🧠",
  rules: "Turn over two cards. A pair is yours and you go again; a miss passes the turn. Most pairs wins.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players, rng) => ({
    faces: shuffle([...MEMORY_FACES, ...MEMORY_FACES], rng),
    owner: Array(24).fill(-1),
    up: [],
    turn: 0,
    scores: Array(players).fill(0),
    over: null,
  }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const card = intField(m, "flip", 0, 23);
    if (s.up.length === 2) s.up = []; // the last miss turns back over
    if (card === null || s.owner[card] !== -1 || s.up.includes(card)) return "Pick a face-down card";
    s.up.push(card);
    if (s.up.length < 2) return null;
    const [a, b] = s.up as [number, number];
    if (s.faces[a] === s.faces[b]) {
      s.owner[a] = seat;
      s.owner[b] = seat;
      s.scores[seat]! += 1;
      s.up = [];
      if (s.owner.every((o) => o >= 0)) s.over = byScore(s.scores, "All pairs found");
    } else s.turn = (seat + 1) % s.scores.length;
    return null;
  },
  result: (s) => s.over,
  // Only cards that are face up (or matched) are revealed.
  view: (s) => ({ ...s, faces: s.faces.map((f, i) => (s.owner[i]! >= 0 || s.up.includes(i) ? f : "")) }),
  moves: (s) => s.owner.flatMap((o, flip) => (o === -1 && (s.up.length === 2 || !s.up.includes(flip)) ? [{ flip }] : [])),
});

// ------------------------------------------------------------ Hangman

const WORDS = [
  "jollof", "suya", "agbada", "danfo", "okada", "naija", "lagos", "abuja", "afrobeats", "plantain", "puffpuff", "chinchin",
  "egusi", "gele", "highlife", "nollywood", "housemate", "eviction", "nomination", "diary", "headofhouse", "veto",
  "kitchen", "jacuzzi", "challenge", "saturday", "giraffe", "pineapple", "football", "keyboard", "guitar", "mountain",
  "elephant", "chocolate", "umbrella", "sunshine", "festival", "microphone", "superstar", "harmattan",
];
export const HANGMAN_MAX_MISSES = 7;

export interface HangmanState {
  word: string;
  guessed: string[];
  misses: number;
  turn: number;
  scores: number[];
  over: GameResult | null;
}

export const hangman = defineGame<HangmanState>({
  id: "hangman",
  name: "Hangman",
  icon: "🪢",
  rules: `Take turns guessing letters. Each hit scores and you go again; ${HANGMAN_MAX_MISSES} misses and the house hangs. Finishing the word is worth 3.`,
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players, rng) => ({ word: WORDS[Math.floor(rng() * WORDS.length)]!, guessed: [], misses: 0, turn: 0, scores: Array(players).fill(0), over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const letter = isObj(m) && typeof m.letter === "string" ? m.letter.toLowerCase() : "";
    if (!/^[a-z]$/.test(letter)) return "Pick a letter";
    if (s.guessed.includes(letter)) return "That letter's been tried";
    s.guessed.push(letter);
    const hits = [...s.word].filter((ch) => ch === letter).length;
    if (hits) {
      s.scores[seat]! += hits;
      if ([...s.word].every((ch) => s.guessed.includes(ch))) {
        s.scores[seat]! += 3;
        s.over = byScore(s.scores, `Solved: ${s.word.toUpperCase()}`);
      }
    } else {
      s.misses++;
      s.turn = (seat + 1) % s.scores.length;
      if (s.misses >= HANGMAN_MAX_MISSES) s.over = byScore(s.scores, `Hanged! The word was ${s.word.toUpperCase()}`);
    }
    return null;
  },
  result: (s) => s.over,
  view: (s) => ({ ...s, word: s.over ? s.word : [...s.word].map((ch) => (s.guessed.includes(ch) ? ch : "_")).join("") }),
  moves: (s) => [..."etaoinshrdlucmfwypvbgkjqxz"].filter((l) => !s.guessed.includes(l)).map((letter) => ({ letter })),
});

// ------------------------------------------------------------ Rock–Paper–Scissors

export const RPS = ["rock", "paper", "scissors"] as const;
type RpsPick = (typeof RPS)[number];
const RPS_TARGET = 3;

export interface RpsState {
  picks: Array<RpsPick | null>;
  scores: number[];
  last: { picks: RpsPick[]; winner: number } | null;
  over: GameResult | null;
}

export const rps = defineGame<RpsState>({
  id: "rps",
  name: "Rock Paper Scissors",
  icon: "✊",
  rules: `Both pick in secret. Rock blunts scissors, scissors cut paper, paper wraps rock. First to ${RPS_TARGET}.`,
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ picks: [null, null], scores: [0, 0], last: null, over: null }),
  turn: (s) => (s.over ? [] : [0, 1].filter((i) => s.picks[i] === null)),
  move(s, seat, m) {
    const pick = isObj(m) ? m.pick : undefined;
    if (!RPS.includes(pick as RpsPick)) return "Pick rock, paper or scissors";
    if (s.picks[seat]) return "You've already picked";
    s.picks[seat] = pick as RpsPick;
    if (s.picks[0] && s.picks[1]) {
      const [a, b] = [RPS.indexOf(s.picks[0]), RPS.indexOf(s.picks[1])];
      const winner = a === b ? -1 : (a - b + 3) % 3 === 1 ? 0 : 1;
      if (winner >= 0) s.scores[winner]! += 1;
      s.last = { picks: [s.picks[0], s.picks[1]], winner };
      s.picks = [null, null];
      if (winner >= 0 && s.scores[winner] === RPS_TARGET) s.over = { winners: [winner], text: `First to ${RPS_TARGET} (${scoreLine(s.scores)})` };
    }
    return null;
  },
  result: (s) => s.over,
  // Your opponent's pick stays secret; you only see that they've picked.
  view: (s, seat) => ({ ...s, picks: s.picks.map((p, i) => (i === seat ? p : p ? "hidden" : null)) }),
  moves: () => RPS.map((pick) => ({ pick })),
});

// ------------------------------------------------------------ Trivia

interface Question {
  q: string;
  options: string[];
  answer: number;
}

const QUESTIONS: Question[] = [
  { q: "What is the capital of Nigeria?", options: ["Lagos", "Abuja", "Ibadan", "Kano"], answer: 1 },
  { q: "Which river joins the Niger at Lokoja?", options: ["Benue", "Ogun", "Kaduna", "Cross"], answer: 0 },
  { q: "What colours are on the Nigerian flag?", options: ["Green and white", "Red and green", "Green, white and red", "Blue and white"], answer: 0 },
  { q: "In what year did Nigeria become independent?", options: ["1957", "1960", "1963", "1966"], answer: 1 },
  { q: "What is Nigeria's currency?", options: ["Cedi", "Shilling", "Naira", "Rand"], answer: 2 },
  { q: "Jollof rice is mostly cooked with…", options: ["Coconut milk", "Tomato and pepper", "Palm wine", "Egusi"], answer: 1 },
  { q: "Which Nigerian city is famous as the 'Centre of Excellence'?", options: ["Lagos", "Port Harcourt", "Enugu", "Jos"], answer: 0 },
  { q: "Which music genre did Fela Kuti pioneer?", options: ["Highlife", "Afrobeat", "Juju", "Fuji"], answer: 1 },
  { q: "Nollywood is the film industry of…", options: ["Ghana", "Kenya", "Nigeria", "South Africa"], answer: 2 },
  { q: "Suya is made by grilling…", options: ["Spiced meat skewers", "Fish stew", "Yam", "Beans cakes"], answer: 0 },
  { q: "Which is the largest ethnic group in northern Nigeria?", options: ["Igbo", "Yoruba", "Hausa", "Ijaw"], answer: 2 },
  { q: "Zuma Rock is near which city?", options: ["Abuja", "Calabar", "Benin City", "Sokoto"], answer: 0 },
  { q: "What is the longest river in Africa?", options: ["Congo", "Niger", "Zambezi", "Nile"], answer: 3 },
  { q: "How many states does Nigeria have?", options: ["30", "36", "38", "40"], answer: 1 },
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], answer: 1 },
  { q: "How many players does a football team have on the pitch?", options: ["9", "10", "11", "12"], answer: 2 },
  { q: "What do you call Nigeria's national football team?", options: ["Black Stars", "Super Eagles", "Indomitable Lions", "Bafana Bafana"], answer: 1 },
  { q: "Which gas do plants take in for photosynthesis?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], answer: 2 },
  { q: "What is 12 × 12?", options: ["124", "144", "132", "154"], answer: 1 },
  { q: "Which ocean is on Nigeria's southern coast?", options: ["Indian", "Pacific", "Atlantic", "Arctic"], answer: 2 },
  { q: "'Ẹ káàárọ̀' means good morning in…", options: ["Igbo", "Hausa", "Yoruba", "Efik"], answer: 2 },
  { q: "'Nnọọ' means welcome in…", options: ["Igbo", "Yoruba", "Hausa", "Tiv"], answer: 0 },
  { q: "Which is the most spoken language in the world by native speakers?", options: ["English", "Spanish", "Mandarin Chinese", "Hindi"], answer: 2 },
  { q: "How many minutes are in a day?", options: ["1,240", "1,440", "1,640", "960"], answer: 1 },
  { q: "Which animal is called the 'king of the jungle'?", options: ["Tiger", "Elephant", "Lion", "Gorilla"], answer: 2 },
  { q: "Puff-puff is a kind of…", options: ["Fried dough ball", "Soup", "Drink", "Dance"], answer: 0 },
  { q: "The Eyo festival is held in…", options: ["Kano", "Lagos", "Calabar", "Osogbo"], answer: 1 },
  { q: "Which festival is famous in Osogbo?", options: ["Durbar", "Osun-Osogbo", "Argungu", "Ofala"], answer: 1 },
  { q: "The Argungu festival is about…", options: ["Fishing", "Wrestling", "Masquerades", "Boat racing"], answer: 0 },
  { q: "What is the boiling point of water at sea level?", options: ["90°C", "100°C", "110°C", "120°C"], answer: 1 },
  { q: "Which shape has three sides?", options: ["Square", "Pentagon", "Triangle", "Hexagon"], answer: 2 },
  { q: "What is the hardest natural substance?", options: ["Gold", "Iron", "Diamond", "Quartz"], answer: 2 },
  { q: "Which is Africa's most populous country?", options: ["Egypt", "Ethiopia", "Nigeria", "DR Congo"], answer: 2 },
  { q: "Which instrument has 88 keys?", options: ["Guitar", "Piano", "Violin", "Talking drum"], answer: 1 },
  { q: "The 'talking drum' is called ___ in Yoruba.", options: ["Gangan", "Udu", "Shekere", "Ogene"], answer: 0 },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], answer: 2 },
];
export const TRIVIA_QUESTIONS = 8;

export interface TriviaState {
  order: number[];
  index: number;
  answers: Array<number | null>;
  /** Seat that answered correctly first this question, or -1. */
  first: number;
  scores: number[];
  /** The previous question with everyone's answers, shown while the next one is up. */
  reveal: { q: string; options: string[]; answer: number; answers: Array<number | null> } | null;
  over: GameResult | null;
}

export const trivia = defineGame<TriviaState>({
  id: "trivia",
  name: "Naija Trivia",
  icon: "❓",
  rules: `${TRIVIA_QUESTIONS} questions. Everyone answers; a right answer scores 1, and the first right answer scores a bonus point.`,
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players, rng) => ({
    order: shuffle(QUESTIONS.map((_, i) => i), rng).slice(0, TRIVIA_QUESTIONS),
    index: 0,
    answers: Array(players).fill(null),
    first: -1,
    scores: Array(players).fill(0),
    reveal: null,
    over: null,
  }),
  turn: (s) => (s.over ? [] : s.answers.flatMap((a, i) => (a === null ? [i] : []))),
  move(s, seat, m) {
    const answer = intField(m, "answer", 0, 3);
    if (answer === null) return "Pick an answer";
    if (s.answers[seat] !== null) return "You've already answered";
    const q = QUESTIONS[s.order[s.index]!]!;
    s.answers[seat] = answer;
    if (answer === q.answer) {
      s.scores[seat]! += 1;
      if (s.first < 0) {
        s.first = seat;
        s.scores[seat]! += 1;
      }
    }
    if (s.answers.every((a) => a !== null)) {
      s.reveal = { ...q, answers: [...s.answers] };
      s.index++;
      s.answers = s.answers.map(() => null);
      s.first = -1;
      if (s.index >= s.order.length) s.over = byScore(s.scores, "Quiz over");
    }
    return null;
  },
  result: (s) => s.over,
  view: (s, seat) => {
    const q = s.index < s.order.length ? QUESTIONS[s.order[s.index]!]! : null;
    return {
      question: q ? { q: q.q, options: q.options } : null,
      number: s.index + 1,
      total: s.order.length,
      answered: s.answers.map((a) => a !== null),
      mine: seat === null ? null : s.answers[seat],
      scores: s.scores,
      reveal: s.reveal,
      over: s.over,
    };
  },
  moves: () => [0, 1, 2, 3].map((answer) => ({ answer })),
});

// ------------------------------------------------------------ Code Breaker

export const CODE_COLORS = 6;
export const CODE_LENGTH = 4;
const CODE_GUESSES = 8;

export interface CodeState {
  players: number;
  secret: number[];
  guesses: Array<{ seat: number; pegs: number[]; exact: number; near: number }>;
  turn: number;
  over: GameResult | null;
}

export function scoreCode(secret: number[], guess: number[]): { exact: number; near: number } {
  let exact = 0;
  const left = Array(CODE_COLORS).fill(0);
  const tried = Array(CODE_COLORS).fill(0);
  guess.forEach((g, i) => {
    if (g === secret[i]) exact++;
    else {
      left[secret[i]!]++;
      tried[g]++;
    }
  });
  const near = left.reduce((sum, n, c) => sum + Math.min(n, tried[c]), 0);
  return { exact, near };
}

export const codebreaker = defineGame<CodeState>({
  id: "codebreaker",
  name: "Code Breaker",
  icon: "🔐",
  rules: `Race to crack the same secret code of ${CODE_LENGTH} colours. ● = right colour, right place; ○ = right colour, wrong place. Everyone sees every guess.`,
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players, rng) => ({
    secret: Array.from({ length: CODE_LENGTH }, () => Math.floor(rng() * CODE_COLORS)),
    guesses: [],
    turn: 0,
    over: null,
    players,
  }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const pegs = isObj(m) && Array.isArray(m.pegs) ? m.pegs : null;
    if (!pegs || pegs.length !== CODE_LENGTH || !pegs.every((p) => Number.isInteger(p) && p >= 0 && p < CODE_COLORS)) return `Pick ${CODE_LENGTH} colours`;
    const { exact, near } = scoreCode(s.secret, pegs as number[]);
    s.guesses.push({ seat, pegs: pegs as number[], exact, near });
    const players = s.players;
    if (exact === CODE_LENGTH) s.over = { winners: [seat], text: "Code cracked!" };
    else if (s.guesses.length >= CODE_GUESSES * players) s.over = { winners: [], text: "Nobody cracked it" };
    else s.turn = (seat + 1) % players;
    return null;
  },
  result: (s) => s.over,
  view: (s) => ({ ...s, secret: s.over ? s.secret : null }),
  moves: (_s) => [{ pegs: [0, 1, 2, 3] }, { pegs: [4, 5, 0, 1] }, { pegs: [2, 2, 3, 3] }],
});

// ------------------------------------------------------------ Battleship

export const SEA = 10;
const FLEET = [5, 4, 3, 3, 2];

export interface BattleshipState {
  /** Ship cells per seat, one array per ship. */
  ships: number[][][];
  /** Shots fired at each seat's sea: cell → hit? */
  shots: Array<Record<number, boolean>>;
  ready: boolean[];
  turn: number;
  last: { seat: number; cell: number; hit: boolean; sunk: boolean } | null;
  over: GameResult | null;
}

function placeFleet(rng: Rng): number[][] {
  for (;;) {
    const taken = new Set<number>();
    const ships: number[][] = [];
    let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const across = rng() < 0.5;
        const r = Math.floor(rng() * (across ? SEA : SEA - len + 1));
        const c = Math.floor(rng() * (across ? SEA - len + 1 : SEA));
        const cells = Array.from({ length: len }, (_, k) => (across ? r * SEA + c + k : (r + k) * SEA + c));
        if (cells.some((x) => taken.has(x))) continue;
        cells.forEach((x) => taken.add(x));
        ships.push(cells);
        placed = true;
      }
      if (!placed) ok = false;
    }
    if (ok) return ships;
  }
}

const sunk = (ship: number[], shots: Record<number, boolean>) => ship.every((c) => shots[c]);

export const battleship = defineGame<BattleshipState>({
  id: "battleship",
  name: "Battleship",
  icon: "🚢",
  rules: "Shuffle your fleet until you like it, then press Ready. Take turns firing at the enemy sea. Sink all five ships to win.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: (_players, rng) => ({ ships: [placeFleet(rng), placeFleet(rng)], shots: [{}, {}], ready: [false, false], turn: 0, last: null, over: null }),
  turn: (s) => (s.over ? [] : s.ready.every(Boolean) ? [s.turn] : [0, 1].filter((i) => !s.ready[i])),
  move(s, seat, m, rng) {
    if (!s.ready.every(Boolean)) {
      if (s.ready[seat]) return "Waiting for your opponent to get ready";
      if (isObj(m) && m.shuffle === true) {
        s.ships[seat] = placeFleet(rng);
        return null;
      }
      if (isObj(m) && m.ready === true) {
        s.ready[seat] = true;
        return null;
      }
      return "Shuffle your fleet or press Ready";
    }
    const cell = intField(m, "cell", 0, SEA * SEA - 1);
    const target = 1 - seat;
    const shots = s.shots[target]!;
    if (cell === null || cell in shots) return "Fire at a square you haven't tried";
    const ship = s.ships[target]!.find((sh) => sh.includes(cell));
    shots[cell] = !!ship;
    s.last = { seat, cell, hit: !!ship, sunk: !!ship && sunk(ship, shots) };
    if (s.ships[target]!.every((sh) => sunk(sh, shots))) s.over = { winners: [seat], text: "Fleet destroyed!" };
    else s.turn = target;
    return null;
  },
  result: (s) => s.over,
  // You see your own ships; of theirs, only the ones you've sunk (or all, once it's over).
  view: (s, seat) => ({
    ...s,
    ships: s.ships.map((fleet, i) => (i === seat || s.over ? fleet : fleet.filter((sh) => sunk(sh, s.shots[i]!)))),
  }),
  moves: (s, seat) => {
    if (!s.ready.every(Boolean)) return s.ready[seat] ? [] : [{ ready: true }];
    const shots = s.shots[1 - seat]!;
    return Array.from({ length: SEA * SEA }, (_, cell) => cell).filter((c) => !(c in shots)).map((cell) => ({ cell }));
  },
});
