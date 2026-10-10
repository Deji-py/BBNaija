import { defineGame, intField, scoreLine, topSeats, type GameResult } from "./types.js";

/**
 * Grid games where players take turns claiming cells: tic-tac-toe, ultimate
 * tic-tac-toe, Connect Four, gomoku, Reversi, Hex, and dots & boxes.
 * Boards are flat arrays (index = row * width + col), -1 = empty.
 */

const EMPTY = -1;

/** If the stone just placed at `idx` makes a line of at least `n`, that line's cells. */
export function lineThrough(board: number[], w: number, h: number, idx: number, n: number): number[] | null {
  const who = board[idx];
  if (who === undefined || who === EMPTY) return null;
  const r0 = Math.floor(idx / w);
  const c0 = idx % w;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const) {
    const cells = [idx];
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (r >= 0 && r < h && c >= 0 && c < w && board[r * w + c] === who) {
        cells.push(r * w + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= n) return cells;
  }
  return null;
}

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Winner of a 3×3 board (values: seat, or -1 empty), or -1. */
function tttWinner(cells: number[]): { who: number; line: number[] } | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line as [number, number, number];
    if (cells[a]! >= 0 && cells[a] === cells[b] && cells[a] === cells[c]) return { who: cells[a]!, line };
  }
  return null;
}

// ------------------------------------------------------------ tic-tac-toe

interface TttState {
  board: number[];
  turn: number;
  line: number[];
  over: GameResult | null;
}

export const tictactoe = defineGame<TttState>({
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  icon: "❌",
  rules: "Get three in a row — across, down or diagonally.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(9).fill(EMPTY), turn: 0, line: [], over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const cell = intField(m, "cell", 0, 8);
    if (cell === null || s.board[cell] !== EMPTY) return "Pick an empty square";
    s.board[cell] = seat;
    const win = tttWinner(s.board);
    if (win) {
      s.line = win.line;
      s.over = { winners: [seat], text: "Three in a row!" };
    } else if (s.board.every((v) => v !== EMPTY)) s.over = { winners: [], text: "It's a draw" };
    else s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s) => s.board.flatMap((v, cell) => (v === EMPTY ? [{ cell }] : [])),
});

// ------------------------------------------------------------ ultimate tic-tac-toe

interface UltimateState {
  /** 81 cells: board b's cell c is at b * 9 + c. */
  cells: number[];
  /** Small board results: seat, -1 open, 2 drawn. */
  small: number[];
  /** Board the next move must go in, or -1 for any open board. */
  next: number;
  turn: number;
  line: number[];
  over: GameResult | null;
}

export const ultimate = defineGame<UltimateState>({
  id: "ultimate",
  name: "Ultimate Tic-Tac-Toe",
  icon: "#️⃣",
  rules: "Win small boards to claim squares of the big one. Where you play sends your opponent to that board.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ cells: Array(81).fill(EMPTY), small: Array(9).fill(EMPTY), next: -1, turn: 0, line: [], over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const cell = intField(m, "cell", 0, 80);
    if (cell === null || s.cells[cell] !== EMPTY) return "Pick an empty square";
    const board = Math.floor(cell / 9);
    if (s.small[board] !== EMPTY) return "That board is finished";
    if (s.next >= 0 && s.next !== board) return "You must play in the highlighted board";
    s.cells[cell] = seat;
    const own = s.cells.slice(board * 9, board * 9 + 9);
    if (tttWinner(own)) s.small[board] = seat;
    else if (own.every((v) => v !== EMPTY)) s.small[board] = 2;
    const big = tttWinner(s.small.map((v) => (v === 2 ? EMPTY : v)));
    if (big) {
      s.line = big.line;
      s.over = { winners: [seat], text: "Three boards in a row!" };
      return null;
    }
    if (s.small.every((v) => v !== EMPTY)) {
      const won = [0, 1].map((p) => s.small.filter((v) => v === p).length);
      s.over = won[0] === won[1] ? { winners: [], text: "It's a draw" } : { winners: topSeats(won), text: `Most boards won (${scoreLine(won)})` };
      return null;
    }
    const target = cell % 9;
    s.next = s.small[target] === EMPTY ? target : -1;
    s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s) =>
    s.cells.flatMap((v, cell) => {
      const board = Math.floor(cell / 9);
      return v === EMPTY && s.small[board] === EMPTY && (s.next < 0 || s.next === board) ? [{ cell }] : [];
    }),
});

// ------------------------------------------------------------ Connect Four

const C4_W = 7;
const C4_H = 6;

interface Connect4State {
  board: number[];
  turn: number;
  last: number;
  line: number[];
  over: GameResult | null;
}

export const connect4 = defineGame<Connect4State>({
  id: "connect4",
  name: "Connect Four",
  icon: "🔴",
  rules: "Drop discs into the columns. First to line up four wins.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(C4_W * C4_H).fill(EMPTY), turn: 0, last: -1, line: [], over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const col = intField(m, "col", 0, C4_W - 1);
    if (col === null) return "Pick a column";
    let row = C4_H - 1;
    while (row >= 0 && s.board[row * C4_W + col] !== EMPTY) row--;
    if (row < 0) return "That column is full";
    const idx = row * C4_W + col;
    s.board[idx] = seat;
    s.last = idx;
    const line = lineThrough(s.board, C4_W, C4_H, idx, 4);
    if (line) {
      s.line = line;
      s.over = { winners: [seat], text: "Four in a row!" };
    } else if (s.board.every((v) => v !== EMPTY)) s.over = { winners: [], text: "The board is full — draw" };
    else s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s) => Array.from({ length: C4_W }, (_, col) => col).filter((col) => s.board[col] === EMPTY).map((col) => ({ col })),
});

// ------------------------------------------------------------ Gomoku

const GOMOKU = 15;

interface GomokuState {
  board: number[];
  turn: number;
  last: number;
  line: number[];
  over: GameResult | null;
}

export const gomoku = defineGame<GomokuState>({
  id: "gomoku",
  name: "Gomoku",
  icon: "⚫",
  rules: "Take turns placing stones. Five or more in a row wins.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(GOMOKU * GOMOKU).fill(EMPTY), turn: 0, last: -1, line: [], over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const cell = intField(m, "cell", 0, GOMOKU * GOMOKU - 1);
    if (cell === null || s.board[cell] !== EMPTY) return "Pick an empty point";
    s.board[cell] = seat;
    s.last = cell;
    const line = lineThrough(s.board, GOMOKU, GOMOKU, cell, 5);
    if (line) {
      s.line = line;
      s.over = { winners: [seat], text: "Five in a row!" };
    } else if (s.board.every((v) => v !== EMPTY)) s.over = { winners: [], text: "It's a draw" };
    else s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s) => s.board.flatMap((v, cell) => (v === EMPTY ? [{ cell }] : [])),
});

// ------------------------------------------------------------ Reversi

const RV = 8;
const DIRS8 = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

interface ReversiState {
  board: number[];
  turn: number;
  last: number;
  /** Set when a player had no move and their turn was skipped. */
  passed: number;
  over: GameResult | null;
}

/** Discs that placing at `idx` would flip for `who`. */
export function reversiFlips(board: number[], idx: number, who: number): number[] {
  if (board[idx] !== EMPTY) return [];
  const r0 = Math.floor(idx / RV);
  const c0 = idx % RV;
  const flips: number[] = [];
  for (const [dr, dc] of DIRS8) {
    const run: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < RV && c >= 0 && c < RV && board[r * RV + c] === 1 - who) {
      run.push(r * RV + c);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < RV && c >= 0 && c < RV && board[r * RV + c] === who) flips.push(...run);
  }
  return flips;
}

function reversiHasMove(board: number[], who: number): boolean {
  return board.some((_, i) => reversiFlips(board, i, who).length > 0);
}

export const reversi = defineGame<ReversiState>({
  id: "reversi",
  name: "Reversi",
  icon: "⚪",
  rules: "Place a disc to trap a line of your opponent's discs — they flip to your colour. Most discs at the end wins.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => {
    const board = Array(RV * RV).fill(EMPTY);
    board[27] = 1;
    board[36] = 1;
    board[28] = 0;
    board[35] = 0;
    return { board, turn: 0, last: -1, passed: -1, over: null };
  },
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const cell = intField(m, "cell", 0, RV * RV - 1);
    if (cell === null) return "Pick a square";
    const flips = reversiFlips(s.board, cell, seat);
    if (!flips.length) return "That move doesn't flip anything";
    s.board[cell] = seat;
    for (const i of flips) s.board[i] = seat;
    s.last = cell;
    s.passed = -1;
    if (reversiHasMove(s.board, 1 - seat)) s.turn = 1 - seat;
    else if (reversiHasMove(s.board, seat)) s.passed = 1 - seat;
    else {
      const counts = [0, 1].map((p) => s.board.filter((v) => v === p).length);
      s.over = counts[0] === counts[1] ? { winners: [], text: `Draw (${scoreLine(counts)})` } : { winners: topSeats(counts), text: `${scoreLine(counts)} discs` };
    }
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => s.board.flatMap((_, cell) => (reversiFlips(s.board, cell, seat).length ? [{ cell }] : [])),
});

// ------------------------------------------------------------ Hex

export const HEX = 9;

interface HexState {
  board: number[];
  turn: number;
  last: number;
  path: number[];
  over: GameResult | null;
}

export function hexNeighbours(i: number): number[] {
  const r = Math.floor(i / HEX);
  const c = i % HEX;
  const out: number[] = [];
  for (const [dr, dc] of [
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
  ] as const) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < HEX && cc >= 0 && cc < HEX) out.push(rr * HEX + cc);
  }
  return out;
}

/** Seat 0 joins top to bottom, seat 1 left to right. Returns the winning chain, if any. */
function hexChain(board: number[], who: number): number[] | null {
  const starts = Array.from({ length: HEX }, (_, k) => (who === 0 ? k : k * HEX)).filter((i) => board[i] === who);
  const prev = new Map<number, number>(starts.map((i) => [i, -1]));
  const queue = [...starts];
  while (queue.length) {
    const i = queue.shift()!;
    const r = Math.floor(i / HEX);
    const c = i % HEX;
    if ((who === 0 && r === HEX - 1) || (who === 1 && c === HEX - 1)) {
      const path: number[] = [];
      for (let k = i; k !== -1; k = prev.get(k)!) path.push(k);
      return path;
    }
    for (const n of hexNeighbours(i)) {
      if (board[n] === who && !prev.has(n)) {
        prev.set(n, i);
        queue.push(n);
      }
    }
  }
  return null;
}

export const hex = defineGame<HexState>({
  id: "hex",
  name: "Hex",
  icon: "⬢",
  rules: "Red joins top to bottom, blue joins left to right. Build an unbroken chain across the board.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(HEX * HEX).fill(EMPTY), turn: 0, last: -1, path: [], over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const cell = intField(m, "cell", 0, HEX * HEX - 1);
    if (cell === null || s.board[cell] !== EMPTY) return "Pick an empty hex";
    s.board[cell] = seat;
    s.last = cell;
    const path = hexChain(s.board, seat);
    if (path) {
      s.path = path;
      s.over = { winners: [seat], text: "Connected!" };
    } else s.turn = 1 - seat;
    return null;
  },
  result: (s) => s.over,
  moves: (s) => s.board.flatMap((v, cell) => (v === EMPTY ? [{ cell }] : [])),
});

// ------------------------------------------------------------ Dots and boxes

export const DOTS_W = 5;
export const DOTS_H = 5;
/** Horizontal lines first ((H+1) rows of W), then vertical lines (H rows of W+1). */
export const DOTS_LINES = (DOTS_H + 1) * DOTS_W + DOTS_H * (DOTS_W + 1);

export const hLine = (r: number, c: number) => r * DOTS_W + c;
export const vLine = (r: number, c: number) => (DOTS_H + 1) * DOTS_W + r * (DOTS_W + 1) + c;

function boxEdges(b: number): number[] {
  const r = Math.floor(b / DOTS_W);
  const c = b % DOTS_W;
  return [hLine(r, c), hLine(r + 1, c), vLine(r, c), vLine(r, c + 1)];
}

interface DotsState {
  players: number;
  /** Who drew each line (-1 = not drawn). */
  lines: number[];
  boxes: number[];
  turn: number;
  scores: number[];
  over: GameResult | null;
}

export const dots = defineGame<DotsState>({
  id: "dots",
  name: "Dots & Boxes",
  icon: "🔲",
  rules: "Draw one line a turn. Close a box to claim it and go again. Most boxes wins.",
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({
    players,
    lines: Array(DOTS_LINES).fill(EMPTY),
    boxes: Array(DOTS_W * DOTS_H).fill(EMPTY),
    turn: 0,
    scores: Array(players).fill(0),
    over: null,
  }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const line = intField(m, "line", 0, DOTS_LINES - 1);
    if (line === null || s.lines[line] !== EMPTY) return "Pick an undrawn line";
    s.lines[line] = seat;
    let closed = 0;
    s.boxes.forEach((owner, b) => {
      if (owner === EMPTY && boxEdges(b).every((e) => s.lines[e] !== EMPTY)) {
        s.boxes[b] = seat;
        closed++;
      }
    });
    s.scores[seat]! += closed;
    if (s.boxes.every((o) => o !== EMPTY)) {
      const winners = topSeats(s.scores);
      s.over = { winners: winners.length === s.players ? [] : winners, text: `Boxes: ${scoreLine(s.scores)}` };
    } else if (!closed) s.turn = (seat + 1) % s.players;
    return null;
  },
  result: (s) => s.over,
  moves: (s) => s.lines.flatMap((v, line) => (v === EMPTY ? [{ line }] : [])),
});

