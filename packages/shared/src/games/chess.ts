import { defineGame, intField, isObj, type GameResult } from "./types.js";

/**
 * Chess with the full rules: check, castling, en passant, promotion,
 * checkmate, stalemate, and draws by the 50-move rule, threefold repetition
 * and insufficient material. Seat 0 plays white.
 *
 * Squares are 0..63, index = row * 8 + col, row 0 = rank 8 (black's back rank).
 * Pieces are "wP", "bK"… and "" for empty.
 */

export type ChessMove = { from: number; to: number; promo?: "Q" | "R" | "B" | "N" };

export interface ChessState {
  board: string[];
  turn: number;
  /** Castling rights still available: any of "KQkq". */
  castling: string;
  /** Square a pawn may capture into en passant, or -1. */
  ep: number;
  /** Half-moves since the last capture or pawn move (50-move rule). */
  halfmove: number;
  last: { from: number; to: number } | null;
  check: boolean;
  /** Position keys seen, for threefold repetition. */
  seen: Record<string, number>;
  over: GameResult | null;
}

const color = (p: string) => (p ? (p[0] === "w" ? 0 : 1) : -1);
const kind = (p: string) => p[1] ?? "";
const rc = (i: number) => [Math.floor(i / 8), i % 8] as const;
const on = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
] as const;
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;
const ROOK_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;
const BISHOP_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

/** Is square `sq` attacked by any piece of colour `by`? */
export function attacked(board: string[], sq: number, by: number): boolean {
  const [r, c] = rc(sq);
  const side = by === 0 ? "w" : "b";
  // Pawns attack diagonally forward (white moves up = towards row 0).
  const pr = by === 0 ? r + 1 : r - 1;
  for (const dc of [-1, 1]) if (on(pr, c + dc) && board[pr * 8 + c + dc] === side + "P") return true;
  for (const [dr, dc] of KNIGHT) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === side + "N") return true;
  for (const [dr, dc] of KING) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === side + "K") return true;
  for (const [dirs, kinds] of [
    [ROOK_DIRS, "RQ"],
    [BISHOP_DIRS, "BQ"],
  ] as const) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr;
      let cc = c + dc;
      while (on(rr, cc)) {
        const p = board[rr * 8 + cc]!;
        if (p) {
          if (color(p) === by && kinds.includes(kind(p))) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  }
  return false;
}

function kingSquare(board: string[], who: number): number {
  return board.indexOf(who === 0 ? "wK" : "bK");
}

/** Moves that follow how pieces move, ignoring whether they leave your king in check. */
function pseudoMoves(s: ChessState, who: number): ChessMove[] {
  const out: ChessMove[] = [];
  const b = s.board;
  for (let i = 0; i < 64; i++) {
    const p = b[i]!;
    if (color(p) !== who) continue;
    const [r, c] = rc(i);
    const k = kind(p);
    const add = (to: number) => {
      const [tr] = rc(to);
      if (k === "P" && (tr === 0 || tr === 7)) for (const promo of ["Q", "R", "B", "N"] as const) out.push({ from: i, to, promo });
      else out.push({ from: i, to });
    };
    if (k === "P") {
      const dir = who === 0 ? -1 : 1;
      const start = who === 0 ? 6 : 1;
      if (on(r + dir, c) && !b[(r + dir) * 8 + c]) {
        add((r + dir) * 8 + c);
        if (r === start && !b[(r + 2 * dir) * 8 + c]) add((r + 2 * dir) * 8 + c);
      }
      for (const dc of [-1, 1]) {
        if (!on(r + dir, c + dc)) continue;
        const to = (r + dir) * 8 + c + dc;
        if (color(b[to]!) === 1 - who || to === s.ep) add(to);
      }
    } else if (k === "N" || k === "K") {
      for (const [dr, dc] of k === "N" ? KNIGHT : KING) {
        if (!on(r + dr, c + dc)) continue;
        const to = (r + dr) * 8 + c + dc;
        if (color(b[to]!) !== who) add(to);
      }
      if (k === "K") {
        const home = who === 0 ? 60 : 4;
        const rights = who === 0 ? ["K", "Q"] : ["k", "q"];
        if (i === home && !attacked(b, home, 1 - who)) {
          if (s.castling.includes(rights[0]!) && !b[home + 1] && !b[home + 2] && !attacked(b, home + 1, 1 - who) && !attacked(b, home + 2, 1 - who))
            out.push({ from: i, to: home + 2 });
          if (
            s.castling.includes(rights[1]!) &&
            !b[home - 1] &&
            !b[home - 2] &&
            !b[home - 3] &&
            !attacked(b, home - 1, 1 - who) &&
            !attacked(b, home - 2, 1 - who)
          )
            out.push({ from: i, to: home - 2 });
        }
      }
    } else {
      const dirs = k === "R" ? ROOK_DIRS : k === "B" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (on(rr, cc)) {
          const to = rr * 8 + cc;
          if (b[to]) {
            if (color(b[to]!) !== who) add(to);
            break;
          }
          add(to);
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return out;
}

/** Plays a move on `s` (assumed pseudo-legal). Returns whether it captured. */
function apply(s: ChessState, m: ChessMove): boolean {
  const b = s.board;
  const p = b[m.from]!;
  const who = color(p);
  let captured = !!b[m.to];
  // En passant: the captured pawn is beside the target square.
  if (kind(p) === "P" && m.to === s.ep && !b[m.to]) {
    b[m.to + (who === 0 ? 8 : -8)] = "";
    captured = true;
  }
  b[m.to] = kind(p) === "P" && (m.to < 8 || m.to >= 56) ? p[0] + (m.promo ?? "Q") : p;
  b[m.from] = "";
  // Castling moves the rook too.
  if (kind(p) === "K" && Math.abs(m.to - m.from) === 2) {
    const rookFrom = m.to > m.from ? m.from + 3 : m.from - 4;
    const rookTo = m.to > m.from ? m.from + 1 : m.from - 1;
    b[rookTo] = b[rookFrom]!;
    b[rookFrom] = "";
  }
  s.ep = kind(p) === "P" && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  // Moving a king or rook, or capturing a rook at home, loses castling rights.
  const lose: Record<number, string> = { 60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q" };
  for (const sq of [m.from, m.to]) for (const ch of lose[sq] ?? "") s.castling = s.castling.replace(ch, "");
  s.halfmove = captured || kind(p) === "P" ? 0 : s.halfmove + 1;
  return captured;
}

function clone(s: ChessState): ChessState {
  return { ...s, board: [...s.board], seen: s.seen };
}

export function legalMoves(s: ChessState, who: number): ChessMove[] {
  return pseudoMoves(s, who).filter((m) => {
    const t = clone(s);
    apply(t, m);
    return !attacked(t.board, kingSquare(t.board, who), 1 - who);
  });
}

function insufficient(board: string[]): boolean {
  const pieces = board.filter((p) => p && kind(p) !== "K");
  return pieces.length === 0 || (pieces.length === 1 && "BN".includes(kind(pieces[0]!)));
}

const positionKey = (s: ChessState) => `${s.board.join(",")}|${s.turn}|${s.castling}|${s.ep}`;

const START = "rnbqkbnr" + "pppppppp" + "........".repeat(4) + "PPPPPPPP" + "RNBQKBNR";

export const chess = defineGame<ChessState>({
  id: "chess",
  name: "Chess",
  icon: "♟️",
  rules: "Checkmate the other king. Click a piece, then where it should go. Pawns promote to a queen.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => {
    const board = [...START].map((ch) => (ch === "." ? "" : (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase()));
    const s: ChessState = { board, turn: 0, castling: "KQkq", ep: -1, halfmove: 0, last: null, check: false, seen: {}, over: null };
    s.seen[positionKey(s)] = 1;
    return s;
  },
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const from = intField(m, "from", 0, 63);
    const to = intField(m, "to", 0, 63);
    if (from === null || to === null) return "Pick a piece and a square";
    const promo = isObj(m) && typeof m.promo === "string" && "QRBN".includes(m.promo) && m.promo.length === 1 ? (m.promo as ChessMove["promo"]) : "Q";
    const legal = legalMoves(s, seat).find((x) => x.from === from && x.to === to && (!x.promo || x.promo === promo));
    if (!legal) return color(s.board[from]!) !== seat ? "That's not your piece" : "That move isn't allowed";
    apply(s, legal);
    s.last = { from, to };
    s.turn = 1 - seat;
    const key = positionKey(s);
    s.seen[key] = (s.seen[key] ?? 0) + 1;
    s.check = attacked(s.board, kingSquare(s.board, s.turn), seat);
    if (legalMoves(s, s.turn).length === 0) {
      s.over = s.check ? { winners: [seat], text: "Checkmate!" } : { winners: [], text: "Stalemate — draw" };
    } else if (s.halfmove >= 100) s.over = { winners: [], text: "Draw by the 50-move rule" };
    else if (s.seen[key]! >= 3) s.over = { winners: [], text: "Draw by repetition" };
    else if (insufficient(s.board)) s.over = { winners: [], text: "Draw — not enough pieces to mate" };
    return null;
  },
  result: (s) => s.over,
  // The repetition table is only needed on the server.
  view: (s) => ({ ...s, seen: undefined }),
  moves: (s, seat) => legalMoves(s, seat),
});
