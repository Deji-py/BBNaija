import {
  DOTS_H,
  DOTS_W,
  GO,
  HEX,
  MORRIS_ADJ,
  SEA,
  checkersMoves,
  hLine,
  legalMoves,
  reversiFlips,
  vLine,
  type CheckersState,
  type ChessState,
} from "@bbn/shared";
import { Board, SEAT_COLORS, button, el, myTurn, seatName, type RendererFactory } from "./common.js";

/** Renderers for the strategy boards. Each redraws everything from the latest view. */

const HIGHLIGHT = "rgba(255, 230, 80, 0.45)";
const TARGET = "rgba(30, 30, 30, 0.35)";

// ------------------------------------------------------------ chess

const GLYPH: Record<string, string> = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };

export const chessRenderer: RendererFactory = (ctx) => {
  const S = 60;
  const b = new Board(ctx.board, S * 8, S * 8);
  let selected = -1;
  const promo = el("select", "game-select");
  for (const [v, label] of [
    ["Q", "Queen"],
    ["R", "Rook"],
    ["B", "Bishop"],
    ["N", "Knight"],
  ])
    promo.append(new Option(`Promote to ${label}`, v));
  const info = el("span", "game-info");
  ctx.controls.append(info, promo);

  const flip = () => ctx.table().you === 1;
  const toXY = (sq: number) => {
    let r = Math.floor(sq / 8);
    let c = sq % 8;
    if (flip()) (r = 7 - r), (c = 7 - c);
    return { x: c * S, y: r * S };
  };
  const state = () => ctx.table().view as ChessState;

  function draw(): void {
    const t = ctx.table();
    const s = state();
    const legal = selected >= 0 && myTurn(t) ? legalMoves(s, t.you).filter((m) => m.from === selected) : [];
    for (let sq = 0; sq < 64; sq++) {
      const { x, y } = toXY(sq);
      const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
      b.ctx.fillStyle = dark ? "#b58863" : "#f0d9b5";
      b.ctx.fillRect(x, y, S, S);
      if (s.last && (s.last.from === sq || s.last.to === sq)) {
        b.ctx.fillStyle = HIGHLIGHT;
        b.ctx.fillRect(x, y, S, S);
      }
      if (sq === selected) {
        b.ctx.fillStyle = "rgba(80, 200, 120, 0.5)";
        b.ctx.fillRect(x, y, S, S);
      }
      const p = s.board[sq]!;
      if (p && p[1] === "K" && s.check && (p[0] === "w" ? 0 : 1) === s.turn) {
        b.disc(x + S / 2, y + S / 2, S * 0.45, "rgba(230, 40, 40, 0.55)");
      }
      if (p) {
        b.ctx.font = `${S * 0.78}px "Segoe UI Symbol", "Apple Symbols", serif`;
        b.ctx.textAlign = "center";
        b.ctx.textBaseline = "middle";
        const glyph = GLYPH[p[1]!]! + "︎";
        b.ctx.lineWidth = 2.5;
        b.ctx.strokeStyle = p[0] === "w" ? "#222" : "#ddd";
        b.ctx.strokeText(glyph, x + S / 2, y + S / 2 + 3);
        b.ctx.fillStyle = p[0] === "w" ? "#fff" : "#111";
        b.ctx.fillText(glyph, x + S / 2, y + S / 2 + 3);
      }
    }
    for (const m of legal) {
      const { x, y } = toXY(m.to);
      b.disc(x + S / 2, y + S / 2, s.board[m.to] ? S * 0.44 : S * 0.15, TARGET);
    }
    info.textContent = t.you >= 0 ? `You play ${t.you === 0 ? "White" : "Black"}${s.check && s.turn === t.you ? " — you're in check!" : ""}` : `${seatName(t, 0)} (White) vs ${seatName(t, 1)} (Black)`;
  }

  b.onClick((x, y) => {
    const t = ctx.table();
    if (!myTurn(t)) return;
    let c = Math.floor(x / S);
    let r = Math.floor(y / S);
    if (flip()) (r = 7 - r), (c = 7 - c);
    const sq = r * 8 + c;
    const s = state();
    const mine = s.board[sq] && (s.board[sq]![0] === "w" ? 0 : 1) === t.you;
    if (selected >= 0 && legalMoves(s, t.you).some((m) => m.from === selected && m.to === sq)) {
      ctx.move({ from: selected, to: sq, promo: promo.value });
      selected = -1;
    } else selected = mine ? sq : -1;
    draw();
  });

  return {
    update: () => {
      selected = -1;
      draw();
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ checkers

export const checkersRenderer: RendererFactory = (ctx) => {
  const S = 60;
  const b = new Board(ctx.board, S * 8, S * 8);
  let selected = -1;
  const info = el("span", "game-info");
  ctx.controls.append(info);
  const flip = () => ctx.table().you === 1;
  const xy = (sq: number) => {
    let r = Math.floor(sq / 8);
    let c = sq % 8;
    if (flip()) (r = 7 - r), (c = 7 - c);
    return { x: c * S, y: r * S };
  };
  const state = () => ctx.table().view as CheckersState;

  function draw(): void {
    const t = ctx.table();
    const s = state();
    const moves = myTurn(t) ? checkersMoves(s, t.you) : [];
    if (s.chain >= 0 && myTurn(t)) selected = s.chain;
    for (let sq = 0; sq < 64; sq++) {
      const { x, y } = xy(sq);
      const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
      b.ctx.fillStyle = dark ? "#7a3b2e" : "#f4e1c1";
      b.ctx.fillRect(x, y, S, S);
      if (s.last && (s.last.from === sq || s.last.to === sq)) {
        b.ctx.fillStyle = HIGHLIGHT;
        b.ctx.fillRect(x, y, S, S);
      }
      const v = s.board[sq]!;
      if (v >= 0) {
        const color = v % 2 === 0 ? "#e63946" : "#222";
        b.disc(x + S / 2, y + S / 2, S * 0.38, color, sq === selected ? "#7CFC00" : "#000", sq === selected ? 4 : 2);
        if (v >= 2) b.text("♛︎", x + S / 2, y + S / 2 + 2, `${S * 0.4}px serif`, "#f1c40f");
      }
      if (moves.some((m) => m.from === sq) && selected < 0) b.ring(x + S / 2, y + S / 2, S * 0.42, "#7CFC00", 2);
    }
    for (const m of moves.filter((m) => m.from === selected)) {
      const { x, y } = xy(m.to);
      b.disc(x + S / 2, y + S / 2, S * 0.15, "rgba(124, 252, 0, 0.8)");
    }
    const count = (who: number) => s.board.filter((v) => v >= 0 && v % 2 === who).length;
    info.textContent = `Red ${count(0)} · Black ${count(1)}${t.you >= 0 ? ` — you're ${t.you === 0 ? "red" : "black"}` : ""}`;
  }

  b.onClick((x, y) => {
    const t = ctx.table();
    if (!myTurn(t)) return;
    let c = Math.floor(x / S);
    let r = Math.floor(y / S);
    if (flip()) (r = 7 - r), (c = 7 - c);
    const sq = r * 8 + c;
    const moves = checkersMoves(state(), t.you);
    const go = moves.find((m) => m.from === selected && m.to === sq);
    if (go) {
      ctx.move({ from: go.from, to: go.to });
      selected = -1;
    } else if (state().chain < 0) selected = moves.some((m) => m.from === sq) ? sq : -1;
    draw();
  });

  return {
    update: () => {
      selected = -1;
      draw();
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ stones on a grid (Go, Gomoku)

function stonesRenderer(n: number, opts: { pass?: boolean; stars?: number[] }): RendererFactory {
  return (ctx) => {
    const gap = n <= 9 ? 50 : 32;
    const m = gap * 0.75;
    const size = m * 2 + gap * (n - 1);
    const b = new Board(ctx.board, size, size);
    const info = el("span", "game-info");
    ctx.controls.append(info);
    if (opts.pass) ctx.controls.append(button("Pass", () => ctx.move({ pass: true })));
    const at = (i: number) => ({ x: m + (i % n) * gap, y: m + Math.floor(i / n) * gap });

    function draw(): void {
      const t = ctx.table();
      const s = t.view as { board: number[]; last: number; line?: number[]; captures?: number[]; score?: number[] | null };
      b.clear("#dcb35c");
      b.ctx.strokeStyle = "#3b2a12";
      b.ctx.lineWidth = 1.5;
      for (let k = 0; k < n; k++) {
        b.ctx.beginPath();
        b.ctx.moveTo(m, m + k * gap);
        b.ctx.lineTo(size - m, m + k * gap);
        b.ctx.moveTo(m + k * gap, m);
        b.ctx.lineTo(m + k * gap, size - m);
        b.ctx.stroke();
      }
      for (const st of opts.stars ?? []) {
        const p = at(st);
        b.disc(p.x, p.y, 4, "#3b2a12");
      }
      s.board.forEach((v, i) => {
        if (v < 0) return;
        const p = at(i);
        b.disc(p.x, p.y, gap * 0.45, v === 0 ? "#111" : "#f8f8f8", "#000", 1);
        if (i === s.last) b.disc(p.x, p.y, gap * 0.12, v === 0 ? "#fff" : "#111");
        if (s.line?.includes(i)) b.ring(p.x, p.y, gap * 0.48, "#e63946", 4);
      });
      const names = `${seatName(t, 0)} ⚫ vs ${seatName(t, 1)} ⚪`;
      info.textContent = s.score ? `Final: Black ${s.score[0]} – White ${s.score[1]}` : s.captures ? `${names} · captured ${s.captures[0]} / ${s.captures[1]}` : names;
    }

    b.onClick((x, y) => {
      const t = ctx.table();
      if (!myTurn(t)) return;
      const c = Math.round((x - m) / gap);
      const r = Math.round((y - m) / gap);
      if (c < 0 || r < 0 || c >= n || r >= n) return;
      ctx.move({ cell: r * n + c });
    });
    return { update: draw, destroy: () => {} };
  };
}

export const goRenderer = stonesRenderer(GO, { pass: true, stars: [20, 24, 40, 56, 60] });
export const gomokuRenderer = stonesRenderer(15, { stars: [48, 56, 112, 168, 176] });

// ------------------------------------------------------------ Reversi

export const reversiRenderer: RendererFactory = (ctx) => {
  const S = 56;
  const b = new Board(ctx.board, S * 8, S * 8);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  function draw(): void {
    const t = ctx.table();
    const s = t.view as { board: number[]; last: number; passed: number };
    b.clear("#1e7a46");
    b.ctx.strokeStyle = "#0c3d22";
    b.ctx.lineWidth = 2;
    for (let k = 0; k <= 8; k++) {
      b.ctx.beginPath();
      b.ctx.moveTo(k * S, 0);
      b.ctx.lineTo(k * S, S * 8);
      b.ctx.moveTo(0, k * S);
      b.ctx.lineTo(S * 8, k * S);
      b.ctx.stroke();
    }
    s.board.forEach((v, i) => {
      const x = (i % 8) * S + S / 2;
      const y = Math.floor(i / 8) * S + S / 2;
      if (v >= 0) b.disc(x, y, S * 0.4, v === 0 ? "#111" : "#f5f5f5", "#000", 1);
      if (i === s.last) b.disc(x, y, 5, "#e63946");
      if (v < 0 && myTurn(t) && reversiFlips(s.board, i, t.you).length) b.disc(x, y, 7, "rgba(0,0,0,0.35)");
    });
    const count = (who: number) => s.board.filter((v) => v === who).length;
    info.textContent = `⚫ ${seatName(t, 0)} ${count(0)} · ⚪ ${seatName(t, 1)} ${count(1)}${s.passed >= 0 ? ` — ${seatName(t, s.passed)} had no move and passed` : ""}`;
  }
  b.onClick((x, y) => {
    if (myTurn(ctx.table())) ctx.move({ cell: Math.floor(y / S) * 8 + Math.floor(x / S) });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Connect Four

export const connect4Renderer: RendererFactory = (ctx) => {
  const S = 64;
  const b = new Board(ctx.board, S * 7, S * 6);
  let hover = -1;
  function draw(): void {
    const t = ctx.table();
    const s = t.view as { board: number[]; last: number; line: number[] };
    b.clear("#1d4ed8");
    if (hover >= 0 && myTurn(t)) {
      b.ctx.fillStyle = "rgba(255,255,255,0.12)";
      b.ctx.fillRect(hover * S, 0, S, S * 6);
    }
    s.board.forEach((v, i) => {
      const x = (i % 7) * S + S / 2;
      const y = Math.floor(i / 7) * S + S / 2;
      b.disc(x, y, S * 0.4, v < 0 ? "#0b1d4d" : v === 0 ? "#e63946" : "#f1c40f");
      if (s.line.includes(i)) b.ring(x, y, S * 0.42, "#fff", 4);
      else if (i === s.last) b.ring(x, y, S * 0.42, "rgba(255,255,255,0.5)", 2);
    });
  }
  b.onPointerMove((x) => {
    hover = Math.floor(x / S);
    draw();
  });
  b.onClick((x) => {
    if (myTurn(ctx.table())) ctx.move({ col: Math.min(6, Math.floor(x / S)) });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ tic-tac-toe (and the ultimate version)

function mark(b: Board, who: number, cx: number, cy: number, r: number, width: number): void {
  const c = b.ctx;
  c.lineWidth = width;
  c.lineCap = "round";
  if (who === 0) {
    c.strokeStyle = "#e63946";
    c.beginPath();
    c.moveTo(cx - r, cy - r);
    c.lineTo(cx + r, cy + r);
    c.moveTo(cx + r, cy - r);
    c.lineTo(cx - r, cy + r);
    c.stroke();
  } else {
    c.strokeStyle = "#3b82f6";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
  }
}

export const tictactoeRenderer: RendererFactory = (ctx) => {
  const S = 120;
  const b = new Board(ctx.board, S * 3, S * 3);
  function draw(): void {
    const s = ctx.table().view as { board: number[]; line: number[] };
    b.clear("#fffbeb");
    b.ctx.strokeStyle = "#1f2937";
    b.ctx.lineWidth = 4;
    for (const k of [1, 2]) {
      b.ctx.beginPath();
      b.ctx.moveTo(k * S, 10);
      b.ctx.lineTo(k * S, S * 3 - 10);
      b.ctx.moveTo(10, k * S);
      b.ctx.lineTo(S * 3 - 10, k * S);
      b.ctx.stroke();
    }
    s.board.forEach((v, i) => {
      if (s.line.includes(i)) {
        b.ctx.fillStyle = "rgba(34,197,94,0.25)";
        b.ctx.fillRect((i % 3) * S, Math.floor(i / 3) * S, S, S);
      }
      if (v >= 0) mark(b, v, (i % 3) * S + S / 2, Math.floor(i / 3) * S + S / 2, S * 0.3, 10);
    });
  }
  b.onClick((x, y) => {
    if (myTurn(ctx.table())) ctx.move({ cell: Math.floor(y / S) * 3 + Math.floor(x / S) });
  });
  return { update: draw, destroy: () => {} };
};

export const ultimateRenderer: RendererFactory = (ctx) => {
  const S = 52;
  const b = new Board(ctx.board, S * 9, S * 9);
  /** Big board k, small cell c → screen cell. */
  const pos = (cell: number) => {
    const big = Math.floor(cell / 9);
    const small = cell % 9;
    return { col: (big % 3) * 3 + (small % 3), row: Math.floor(big / 3) * 3 + Math.floor(small / 3) };
  };
  function draw(): void {
    const t = ctx.table();
    const s = t.view as { cells: number[]; small: number[]; next: number };
    b.clear("#fffbeb");
    for (let big = 0; big < 9; big++) {
      const open = s.small[big] === -1 && (s.next < 0 || s.next === big);
      if (open && t.phase === "playing") {
        b.ctx.fillStyle = myTurn(t) ? "rgba(34,197,94,0.18)" : "rgba(0,0,0,0.05)";
        b.ctx.fillRect((big % 3) * S * 3, Math.floor(big / 3) * S * 3, S * 3, S * 3);
      }
    }
    for (let k = 1; k < 9; k++) {
      b.ctx.strokeStyle = k % 3 === 0 ? "#111" : "#9ca3af";
      b.ctx.lineWidth = k % 3 === 0 ? 4 : 1;
      b.ctx.beginPath();
      b.ctx.moveTo(k * S, 0);
      b.ctx.lineTo(k * S, S * 9);
      b.ctx.moveTo(0, k * S);
      b.ctx.lineTo(S * 9, k * S);
      b.ctx.stroke();
    }
    s.cells.forEach((v, cell) => {
      if (v < 0) return;
      const { col, row } = pos(cell);
      mark(b, v, col * S + S / 2, row * S + S / 2, S * 0.28, 4);
    });
    s.small.forEach((v, big) => {
      if (v === 0 || v === 1) {
        b.ctx.fillStyle = "rgba(255,251,235,0.75)";
        b.ctx.fillRect((big % 3) * S * 3, Math.floor(big / 3) * S * 3, S * 3, S * 3);
        mark(b, v, (big % 3) * S * 3 + S * 1.5, Math.floor(big / 3) * S * 3 + S * 1.5, S * 1.1, 12);
      }
    });
  }
  b.onClick((x, y) => {
    if (!myTurn(ctx.table())) return;
    const col = Math.floor(x / S);
    const row = Math.floor(y / S);
    const big = Math.floor(row / 3) * 3 + Math.floor(col / 3);
    const small = (row % 3) * 3 + (col % 3);
    ctx.move({ cell: big * 9 + small });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Hex

export const hexRenderer: RendererFactory = (ctx) => {
  const R = 20;
  const dx = R * Math.sqrt(3);
  const dy = R * 1.5;
  const W = dx * HEX + (dx / 2) * (HEX - 1) + 60;
  const H = dy * (HEX - 1) + R * 2 + 60;
  const b = new Board(ctx.board, W, H);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  const center = (i: number) => {
    const r = Math.floor(i / HEX);
    const c = i % HEX;
    return { x: 30 + dx / 2 + c * dx + r * (dx / 2), y: 30 + R + r * dy };
  };
  const hexPath = (x: number, y: number, r: number) => {
    b.ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      b.ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    b.ctx.closePath();
  };
  function draw(): void {
    const t = ctx.table();
    const s = t.view as { board: number[]; last: number; path: number[] };
    b.clear("#1f2937");
    for (let i = 0; i < HEX * HEX; i++) {
      const { x, y } = center(i);
      const r = Math.floor(i / HEX);
      const c = i % HEX;
      // Edge hexes get a coloured rim: red rows top/bottom, blue columns left/right.
      const rim = r === 0 || r === HEX - 1 ? "#e63946" : c === 0 || c === HEX - 1 ? "#3b82f6" : "#4b5563";
      hexPath(x, y, R);
      b.ctx.fillStyle = s.board[i] === 0 ? "#e63946" : s.board[i] === 1 ? "#3b82f6" : "#f5f5f4";
      b.ctx.fill();
      b.ctx.strokeStyle = rim;
      b.ctx.lineWidth = rim === "#4b5563" ? 1.5 : 3;
      b.ctx.stroke();
      if (s.path.includes(i)) b.disc(x, y, 5, "#fff");
      else if (i === s.last) b.disc(x, y, 4, "#111");
    }
    info.textContent = `🔴 ${seatName(t, 0)}: top ↔ bottom · 🔵 ${seatName(t, 1)}: left ↔ right`;
  }
  b.onClick((x, y) => {
    if (!myTurn(ctx.table())) return;
    let best = -1;
    let bestD = R;
    for (let i = 0; i < HEX * HEX; i++) {
      const c = center(i);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) (best = i), (bestD = d);
    }
    if (best >= 0) ctx.move({ cell: best });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Dots and boxes

export const dotsRenderer: RendererFactory = (ctx) => {
  const gap = 72;
  const m = 30;
  const b = new Board(ctx.board, m * 2 + gap * DOTS_W, m * 2 + gap * DOTS_H);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  let hover = -1;
  /** Endpoints of every line, in the same order as the game's line indices. */
  const lines: Array<[number, number, number, number]> = [];
  for (let r = 0; r <= DOTS_H; r++) for (let c = 0; c < DOTS_W; c++) lines[hLine(r, c)] = [m + c * gap, m + r * gap, m + (c + 1) * gap, m + r * gap];
  for (let r = 0; r < DOTS_H; r++) for (let c = 0; c <= DOTS_W; c++) lines[vLine(r, c)] = [m + c * gap, m + r * gap, m + c * gap, m + (r + 1) * gap];

  function nearest(x: number, y: number): number {
    let best = -1;
    let bestD = 18;
    lines.forEach(([x1, y1, x2, y2], i) => {
      const d = Math.hypot((x1 + x2) / 2 - x, (y1 + y2) / 2 - y);
      if (d < bestD) (best = i), (bestD = d);
    });
    return best;
  }

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { lines: number[]; boxes: number[]; scores: number[] };
    b.clear("#fffbeb");
    s.boxes.forEach((owner, k) => {
      if (owner < 0) return;
      b.ctx.fillStyle = SEAT_COLORS[owner]! + "66";
      b.ctx.fillRect(m + (k % DOTS_W) * gap, m + Math.floor(k / DOTS_W) * gap, gap, gap);
    });
    lines.forEach(([x1, y1, x2, y2], i) => {
      const who = s.lines[i]!;
      if (who < 0 && !(i === hover && myTurn(t))) return;
      b.ctx.strokeStyle = who >= 0 ? SEAT_COLORS[who]! : "rgba(0,0,0,0.25)";
      b.ctx.lineWidth = 6;
      b.ctx.lineCap = "round";
      b.ctx.beginPath();
      b.ctx.moveTo(x1, y1);
      b.ctx.lineTo(x2, y2);
      b.ctx.stroke();
    });
    for (let r = 0; r <= DOTS_H; r++) for (let c = 0; c <= DOTS_W; c++) b.disc(m + c * gap, m + r * gap, 6, "#111");
    info.textContent = s.scores.map((sc, i) => `${seatName(t, i)} ${sc}`).join(" · ");
    info.style.setProperty("--accent", SEAT_COLORS[t.you] ?? "#fff");
  }
  b.onPointerMove((x, y) => {
    hover = nearest(x, y);
    draw();
  });
  b.onClick((x, y) => {
    const line = nearest(x, y);
    if (line >= 0 && myTurn(ctx.table())) ctx.move({ line });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Nine Men's Morris

const MORRIS_POINTS: ReadonlyArray<[number, number]> = [
  [0, 0], [3, 0], [6, 0], [1, 1], [3, 1], [5, 1], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3],
  [4, 3], [5, 3], [6, 3], [2, 4], [3, 4], [4, 4], [1, 5], [3, 5], [5, 5], [0, 6], [3, 6], [6, 6],
];

export const morrisRenderer: RendererFactory = (ctx) => {
  const gap = 66;
  const m = 34;
  const b = new Board(ctx.board, m * 2 + gap * 6, m * 2 + gap * 6);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  let selected = -1;
  const at = (p: number) => ({ x: m + MORRIS_POINTS[p]![0] * gap, y: m + MORRIS_POINTS[p]![1] * gap });

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { board: number[]; inHand: number[]; removing: boolean; turn: number; last: number };
    b.clear("#e9d5a1");
    b.ctx.strokeStyle = "#3b2a12";
    b.ctx.lineWidth = 4;
    MORRIS_ADJ.forEach((ns, p) =>
      ns.forEach((q) => {
        if (q < p) return;
        const a = at(p);
        const c = at(q);
        b.ctx.beginPath();
        b.ctx.moveTo(a.x, a.y);
        b.ctx.lineTo(c.x, c.y);
        b.ctx.stroke();
      }),
    );
    s.board.forEach((v, p) => {
      const { x, y } = at(p);
      if (v < 0) {
        b.disc(x, y, 7, "#3b2a12");
        return;
      }
      const removable = s.removing && myTurn(t) && v !== t.you;
      b.disc(x, y, 20, v === 0 ? "#f8f8f8" : "#1f2937", p === selected ? "#22c55e" : removable ? "#e63946" : "#000", p === selected || removable ? 4 : 2);
      if (p === s.last) b.disc(x, y, 5, "#e63946");
    });
    const phase = s.removing ? "remove a piece" : s.inHand[s.turn]! > 0 ? "place a piece" : "move a piece";
    info.textContent = `⚪ ${seatName(t, 0)} (${s.inHand[0]} to place) · ⚫ ${seatName(t, 1)} (${s.inHand[1]} to place)${myTurn(t) ? ` — ${phase}` : ""}`;
  }

  b.onClick((x, y) => {
    const t = ctx.table();
    if (!myTurn(t)) return;
    const s = t.view as { board: number[]; inHand: number[]; removing: boolean };
    const p = MORRIS_POINTS.findIndex((_, i) => Math.hypot(at(i).x - x, at(i).y - y) < 26);
    if (p < 0) return;
    if (s.removing) ctx.move({ remove: p });
    else if (s.inHand[t.you]! > 0) ctx.move({ place: p });
    else if (s.board[p] === t.you) selected = p;
    else if (selected >= 0 && s.board[p] === -1) {
      ctx.move({ from: selected, to: p });
      selected = -1;
    }
    draw();
  });
  return {
    update: () => {
      selected = -1;
      draw();
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Battleship

export const battleshipRenderer: RendererFactory = (ctx) => {
  const C = 26;
  const gap = 40;
  const top = 30;
  const b = new Board(ctx.board, C * SEA * 2 + gap + 20, C * SEA + top + 10);
  const left = 10;
  const right = 10 + C * SEA + gap;
  const shuffle = button("Shuffle my fleet", () => ctx.move({ shuffle: true }));
  const ready = button("Ready!", () => ctx.move({ ready: true }), "primary");
  const info = el("span", "game-info");
  ctx.controls.append(shuffle, ready, info);

  function grid(x0: number, label: string, ships: number[][], shots: Record<number, boolean>, showShips: boolean): void {
    b.text(label, x0 + (C * SEA) / 2, 14, "600 15px system-ui", "#e5e7eb");
    b.ctx.fillStyle = "#1e3a8a";
    b.ctx.fillRect(x0, top, C * SEA, C * SEA);
    const shipCells = new Set(ships.flat());
    for (let i = 0; i < SEA * SEA; i++) {
      const x = x0 + (i % SEA) * C;
      const y = top + Math.floor(i / SEA) * C;
      if (showShips && shipCells.has(i)) {
        b.ctx.fillStyle = "#9ca3af";
        b.ctx.fillRect(x + 2, y + 2, C - 4, C - 4);
      }
      b.ctx.strokeStyle = "#3b82f6";
      b.ctx.lineWidth = 1;
      b.ctx.strokeRect(x, y, C, C);
      if (i in shots) {
        if (shots[i]) b.text("✸", x + C / 2, y + C / 2, "18px sans-serif", "#ef4444");
        else b.disc(x + C / 2, y + C / 2, 4, "#e5e7eb");
      }
    }
  }

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { ships: number[][][]; shots: Array<Record<number, boolean>>; ready: boolean[]; last: { seat: number; hit: boolean; sunk: boolean } | null };
    const me = t.you >= 0 ? t.you : 0;
    const them = 1 - me;
    b.clear("#0f172a");
    grid(left, t.you >= 0 ? "Your fleet" : `${seatName(t, me)}'s fleet`, s.ships[me]!, s.shots[me]!, true);
    grid(right, t.you >= 0 ? "Enemy waters — click to fire" : `${seatName(t, them)}'s fleet`, s.ships[them]!, s.shots[them]!, true);
    const placing = !s.ready.every(Boolean);
    shuffle.hidden = ready.hidden = !(placing && t.you >= 0 && !s.ready[t.you]);
    info.textContent = placing
      ? s.ready[me] && t.you >= 0
        ? "Ready — waiting for your opponent"
        : "Arrange your fleet, then press Ready"
      : s.last
        ? `${seatName(t, s.last.seat)}: ${s.last.sunk ? "sunk a ship! 💥" : s.last.hit ? "hit!" : "miss"}`
        : "";
  }

  b.onClick((x, y) => {
    const t = ctx.table();
    if (!myTurn(t)) return;
    const c = Math.floor((x - right) / C);
    const r = Math.floor((y - top) / C);
    if (c < 0 || r < 0 || c >= SEA || r >= SEA) return;
    ctx.move({ cell: r * SEA + c });
  });
  return { update: draw, destroy: () => {} };
};
