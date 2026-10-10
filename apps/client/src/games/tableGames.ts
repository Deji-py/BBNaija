import {
  CODE_COLORS,
  CODE_LENGTH,
  DART_NUMBERS,
  DART_RINGS,
  HANGMAN_MAX_MISSES,
  JUMPS,
  LUDO_HOME,
  LUDO_HOME_STEP,
  LUDO_START,
  LUDO_TRACK,
  RPS,
  WHOT_SHAPES,
  YACHT_CATEGORIES,
  handValue,
  yachtScore,
  yachtTotal,
  type BlackjackState,
  type Card,
  type GameTableView,
  type WhotCard,
} from "@bbn/shared";
import { Board, SEAT_COLORS, button, el, myTurn, seatName, type RendererFactory } from "./common.js";

/** Renderers for family, card and party games. Mostly DOM; canvases where a board helps. */

const DIE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

/** "Ada: rolled a 6" style line for the last action. */
function noteLine(t: GameTableView, seat: number, note: string): string {
  return note && seat >= 0 ? `${seatName(t, seat)}: ${note}` : "";
}

// ------------------------------------------------------------ Ayo

export const ayoRenderer: RendererFactory = (ctx) => {
  const W = 620;
  const H = 260;
  const b = new Board(ctx.board, W, H);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  const pitW = (W - 160) / 6;
  /** Seat 0 sees its pits 0–5 along the bottom; seat 1 sees 6–11 there. Sowing runs anticlockwise either way. */
  const layout = () => {
    const me = ctx.table().you === 1 ? 1 : 0;
    const bottom = [0, 1, 2, 3, 4, 5].map((k) => me * 6 + k);
    const topRow = [0, 1, 2, 3, 4, 5].map((k) => (1 - me) * 6 + (5 - k));
    return { me, bottom, topRow };
  };
  const pitAt = (row: number, k: number) => ({ x: 80 + pitW * k + pitW / 2, y: row === 0 ? 75 : 185 });

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { pits: number[]; stores: number[]; last: number; took: number[] };
    const { me, bottom, topRow } = layout();
    b.clear("#2b1a0c");
    b.ctx.fillStyle = "#8b5a2b";
    b.ctx.beginPath();
    b.ctx.roundRect(10, 10, W - 20, H - 20, 40);
    b.ctx.fill();
    [topRow, bottom].forEach((row, r) =>
      row.forEach((pit, k) => {
        const { x, y } = pitAt(r, k);
        const playable = r === 1 && myTurn(t) && s.pits[pit]! > 0;
        b.disc(x, y, 34, s.took.includes(pit) ? "#b45309" : "#5c3a1a", playable ? "#fde68a" : pit === s.last ? "#f59e0b" : "#3b220c", playable ? 4 : 2);
        b.text(String(s.pits[pit]), x, y, "700 26px system-ui", "#fff7ed");
      }),
    );
    // Stores: yours on the right, theirs on the left.
    for (const [x, seat] of [
      [40, 1 - me],
      [W - 40, me],
    ] as const) {
      b.ctx.fillStyle = "#5c3a1a";
      b.ctx.beginPath();
      b.ctx.roundRect(x - 26, 40, 52, H - 80, 26);
      b.ctx.fill();
      b.text(String(s.stores[seat]), x, H / 2, "800 28px system-ui", "#fde68a");
    }
    info.textContent = `${seatName(t, me)} ${s.stores[me]} · ${seatName(t, 1 - me)} ${s.stores[1 - me]} — first past 24 wins`;
  }
  b.onClick((x, y) => {
    if (!myTurn(ctx.table()) || y < 130) return;
    const k = Math.floor((x - 80) / pitW);
    if (k >= 0 && k < 6) ctx.move({ pit: layout().bottom[k] });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Snakes & Ladders

export const snakesRenderer: RendererFactory = (ctx) => {
  const C = 48;
  const b = new Board(ctx.board, C * 10, C * 10);
  const roll = button("🎲 Roll", () => ctx.move({ roll: true }), "primary");
  const info = el("span", "game-info");
  ctx.controls.append(roll, info);
  /** Square 1–100 → centre. Row 1 runs left to right at the bottom, then it zig-zags. */
  const center = (n: number) => {
    const i = n - 1;
    const row = Math.floor(i / 10);
    const col = row % 2 === 0 ? i % 10 : 9 - (i % 10);
    return { x: col * C + C / 2, y: (9 - row) * C + C / 2 };
  };
  function draw(): void {
    const t = ctx.table();
    const s = t.view as { pos: number[]; roll: number; note: string; lastSeat: number };
    for (let n = 1; n <= 100; n++) {
      const { x, y } = center(n);
      b.ctx.fillStyle = (Math.floor((n - 1) / 10) + n) % 2 ? "#fde68a" : "#bbf7d0";
      b.ctx.fillRect(x - C / 2, y - C / 2, C, C);
      b.text(String(n), x - C / 2 + 4, y - C / 2 + 9, "600 10px system-ui", "#57534e", "left");
    }
    for (const [from, to] of Object.entries(JUMPS)) {
      const a = center(Number(from));
      const z = center(to);
      const ladder = to > Number(from);
      b.ctx.strokeStyle = ladder ? "#92400e" : "#16a34a";
      b.ctx.lineWidth = ladder ? 5 : 7;
      b.ctx.lineCap = "round";
      b.ctx.beginPath();
      b.ctx.moveTo(a.x, a.y);
      if (ladder) b.ctx.lineTo(z.x, z.y);
      else b.ctx.quadraticCurveTo((a.x + z.x) / 2 + 30, (a.y + z.y) / 2, z.x, z.y);
      b.ctx.stroke();
      if (!ladder) b.disc(a.x, a.y, 7, "#15803d");
    }
    s.pos.forEach((p, i) => {
      if (p === 0) return;
      const { x, y } = center(p);
      b.disc(x + (i % 2 ? 9 : -9), y + (i > 1 ? 9 : -4), 10, SEAT_COLORS[i]!, "#111");
    });
    roll.hidden = !myTurn(t);
    info.textContent = [s.roll ? `${DIE_FACES[s.roll]} ${noteLine(t, s.lastSeat, s.note)}` : "", s.pos.map((p, i) => `${seatName(t, i)} ${p || "start"}`).join(" · ")].filter(Boolean).join(" — ");
  }
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Ludo

const LUDO_COLORS = ["#e63946", "#22c55e", "#f1c40f", "#3b82f6"];

export const ludoRenderer: RendererFactory = (ctx) => {
  const C = 34;
  const b = new Board(ctx.board, C * 15, C * 15);
  const roll = button("🎲 Roll", () => ctx.move({ roll: true }), "primary");
  const info = el("span", "game-info");
  ctx.controls.append(roll, info);
  /** Base spots: four in each colour's corner. */
  const base = (color: number, k: number) => {
    const [bx, by] = [
      [1.5, 1.5],
      [10.5, 1.5],
      [10.5, 10.5],
      [1.5, 10.5],
    ][color]!;
    return { x: (bx! + (k % 2) * 2 + 0.5) * C, y: (by! + Math.floor(k / 2) * 2 + 0.5) * C };
  };
  const tokenAt = (color: number, p: number, k: number) => {
    if (p < 0) return base(color, k);
    if (p >= LUDO_HOME_STEP) return { x: 7.5 * C + (k % 2 ? 6 : -6), y: 7.5 * C + (k > 1 ? 6 : -6) };
    const [cx, cy] = p <= 50 ? LUDO_TRACK[(LUDO_START[color]! + p) % 52]! : LUDO_HOME[color]![p - 51]!;
    return { x: (cx + 0.5) * C, y: (cy + 0.5) * C };
  };
  let clickable: Array<{ x: number; y: number; token: number }> = [];

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { colors: number[]; tokens: number[][]; roll: number; lastRoll: number; note: string; turn: number };
    b.clear("#fff");
    // Corner yards.
    [
      [0, 0],
      [9, 0],
      [9, 9],
      [0, 9],
    ].forEach(([x, y], color) => {
      b.ctx.fillStyle = LUDO_COLORS[color]!;
      b.ctx.fillRect(x! * C, y! * C, 6 * C, 6 * C);
      b.ctx.fillStyle = "#fff";
      b.ctx.fillRect((x! + 1) * C, (y! + 1) * C, 4 * C, 4 * C);
    });
    LUDO_TRACK.forEach(([x, y], i) => {
      const start = LUDO_START.indexOf(i);
      b.ctx.fillStyle = start >= 0 ? LUDO_COLORS[start]! : "#fff";
      b.ctx.fillRect(x * C, y * C, C, C);
      b.ctx.strokeStyle = "#9ca3af";
      b.ctx.strokeRect(x * C, y * C, C, C);
      if ([8, 21, 34, 47].includes(i)) b.text("★", (x + 0.5) * C, (y + 0.5) * C, "18px sans-serif", "#9ca3af");
    });
    LUDO_HOME.forEach((cells, color) =>
      cells.forEach(([x, y]) => {
        b.ctx.fillStyle = LUDO_COLORS[color]!;
        b.ctx.fillRect(x * C, y * C, C, C);
      }),
    );
    // Centre triangles.
    const mid = 7.5 * C;
    [
      [6, 6, 6, 9],
      [6, 6, 9, 6],
      [9, 6, 9, 9],
      [6, 9, 9, 9],
    ].forEach(([x1, y1, x2, y2], color) => {
      b.ctx.fillStyle = LUDO_COLORS[[0, 1, 2, 3][color]!]!;
      b.ctx.beginPath();
      b.ctx.moveTo(x1! * C, y1! * C);
      b.ctx.lineTo(x2! * C, y2! * C);
      b.ctx.lineTo(mid, mid);
      b.ctx.fill();
    });
    clickable = [];
    const mine = t.you >= 0 && myTurn(t) && s.roll > 0;
    s.tokens.forEach((tokens, seat) =>
      tokens.forEach((p, k) => {
        const color = s.colors[seat]!;
        const { x, y } = tokenAt(color, p, k);
        const movable = mine && seat === t.you && (p === -1 ? s.roll === 6 : p < LUDO_HOME_STEP && p + s.roll <= LUDO_HOME_STEP);
        b.disc(x, y, C * 0.36, LUDO_COLORS[color]!, movable ? "#111" : "#fff", movable ? 4 : 2);
        if (movable) clickable.push({ x, y, token: k });
      }),
    );
    roll.hidden = !(myTurn(t) && s.roll === 0);
    const who = s.colors.map((c, i) => `${["🔴", "🟢", "🟡", "🔵"][c]} ${seatName(t, i)}`).join(" · ");
    info.textContent = `${who}${s.lastRoll ? ` — ${seatName(t, s.turn)} ${DIE_FACES[s.lastRoll]}` : ""}${mine ? " — click a token to move" : ""}`;
  }
  b.onClick((x, y) => {
    const hit = clickable.find((c) => Math.hypot(c.x - x, c.y - y) < C * 0.5);
    if (hit) ctx.move({ token: hit.token });
  });
  return { update: draw, destroy: () => {} };
};

// ------------------------------------------------------------ Yacht

export const yachtRenderer: RendererFactory = (ctx) => {
  const dice = el("div", "dice-row");
  const card = el("table", "score-card");
  const roll = button("🎲 Roll", () => ctx.move({ roll: true, hold }), "primary");
  ctx.board.append(dice, card);
  ctx.controls.append(roll);
  let hold = [false, false, false, false, false];

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { dice: number[]; held: boolean[]; rollsLeft: number; cards: Array<Array<number | null>>; turn: number };
    const mine = myTurn(t);
    const rolled = s.rollsLeft < 3;
    dice.replaceChildren(
      ...s.dice.map((d, i) => {
        const die = button(rolled ? DIE_FACES[d]! : "·", () => {
          if (!mine || !rolled) return;
          hold[i] = !hold[i];
          draw();
        }, "die");
        die.setAttribute("aria-pressed", String(mine ? hold[i] : s.held[i]));
        return die;
      }),
    );
    roll.hidden = !mine || s.rollsLeft === 0;
    roll.textContent = `🎲 Roll (${s.rollsLeft} left)`;
    const head = el("tr");
    head.append(el("th", "", ""), ...t.seats.map((p, i) => el("th", i === s.turn ? "to-move" : "", p.name)));
    const rows = YACHT_CATEGORIES.map((name, cat) => {
      const tr = el("tr");
      tr.append(el("td", "", name));
      s.cards.forEach((c, seat) => {
        const v = c[cat];
        const td = el("td", v === null ? "empty" : "", v === null ? "" : String(v));
        if (seat === t.you && mine && rolled && v === null) {
          td.textContent = String(yachtScore(s.dice, cat));
          td.className = "pick";
          td.title = "Score here";
          td.addEventListener("click", () => ctx.move({ score: cat }));
        }
        tr.append(td);
      });
      return tr;
    });
    const total = el("tr", "total");
    total.append(el("td", "", "Total (+35 bonus at 63 up top)"), ...s.cards.map((c) => el("td", "", String(yachtTotal(c)))));
    card.replaceChildren(head, ...rows, total);
  }
  return {
    update: (t) => {
      // A new turn: nothing held.
      if ((t.view as { rollsLeft: number }).rollsLeft === 3) hold = [false, false, false, false, false];
      draw();
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Pig

export const pigRenderer: RendererFactory = (ctx) => {
  const view = el("div", "pig");
  ctx.board.append(view);
  const roll = button("🎲 Roll", () => ctx.move({ roll: true }), "primary");
  const hold = button("✋ Hold (bank it)", () => ctx.move({ hold: true }));
  ctx.controls.append(roll, hold);
  return {
    update: (t) => {
      const s = t.view as { scores: number[]; pot: number; turn: number; roll: number; note: string };
      view.replaceChildren(
        el("div", "big-die", s.roll ? DIE_FACES[s.roll] : "🎲"),
        el("p", "game-info", `${seatName(t, s.turn)}'s pot: ${s.pot}${s.note ? ` — ${s.note}` : ""}`),
        el("p", "game-info", s.scores.map((sc, i) => `${seatName(t, i)} ${sc}`).join(" · ")),
      );
      roll.hidden = hold.hidden = !myTurn(t);
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Whot!

const SHAPE_ICON: Record<string, string> = { circle: "●", triangle: "▲", cross: "✚", square: "■", star: "★", whot: "W" };

function whotCard(card: WhotCard | null, onClick?: () => void, playable = false): HTMLElement {
  const node = el(onClick ? "button" : "div", `whot-card${playable ? " playable" : ""}${card ? "" : " back"}`);
  if (onClick) (node as HTMLButtonElement).type = "button";
  if (card) {
    node.append(el("span", "n", String(card.n)), el("span", "shape", SHAPE_ICON[card.shape]!));
    node.title = card.shape === "whot" ? "Whot 20" : `${card.shape} ${card.n}`;
  }
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

export const whotRenderer: RendererFactory = (ctx) => {
  const tableEl = el("div", "whot-table");
  const hand = el("div", "whot-hand");
  const shapes = el("div", "whot-shapes");
  ctx.board.append(tableEl, hand, shapes);
  const market = button("Go to market", () => ctx.move({ draw: true }));
  const info = el("span", "game-info");
  ctx.controls.append(market, info);
  let pendingWhot = -1;

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { hand: WhotCard[]; counts: number[]; marketCount: number; top: WhotCard; request: string; note: string; lastSeat: number; turn: number };
    const mine = myTurn(t);
    const playable = (c: WhotCard) =>
      c.shape === "whot" || (s.request ? c.shape === s.request : c.shape === s.top.shape || c.n === s.top.n);
    const others = s.counts.map((n, i) => el("span", `whot-count${i === s.turn ? " to-move" : ""}`, `${seatName(t, i)}: ${n} card${n === 1 ? "" : "s"}`));
    tableEl.replaceChildren(
      el("div", "whot-others", ""),
      whotCard(s.top),
      el("div", "whot-market", `Market: ${s.marketCount}`),
      el("p", "game-info", s.request ? `Whot! Next card must be ${SHAPE_ICON[s.request]} ${s.request}` : noteLine(t, s.lastSeat, s.note)),
    );
    tableEl.firstElementChild!.append(...others);
    hand.replaceChildren(
      ...s.hand.map((c, i) =>
        whotCard(c, () => {
          if (!mine) return;
          if (c.shape === "whot") {
            pendingWhot = i;
            draw();
          } else ctx.move({ play: i });
        }, mine && playable(c)),
      ),
    );
    shapes.hidden = pendingWhot < 0;
    shapes.replaceChildren(
      el("span", "", "Ask for:"),
      ...WHOT_SHAPES.map((shape) =>
        button(`${SHAPE_ICON[shape]} ${shape}`, () => {
          ctx.move({ play: pendingWhot, shape });
          pendingWhot = -1;
          draw();
        }),
      ),
    );
    market.hidden = !mine;
    info.textContent = mine ? "Your turn — play a matching card or go to market" : "";
  }
  return {
    update: () => {
      pendingWhot = -1;
      draw();
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Blackjack

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function playingCard(c: Card | null): HTMLElement {
  const node = el("span", `play-card${c ? (c.s === 1 || c.s === 2 ? " red" : "") : " back"}`);
  node.textContent = c ? `${RANKS[c.r]}${SUITS[c.s]}` : "🂠";
  return node;
}

export const blackjackRenderer: RendererFactory = (ctx) => {
  const view = el("div", "bj");
  ctx.board.append(view);
  const hit = button("Hit", () => ctx.move({ hit: true }), "primary");
  const stand = button("Stand", () => ctx.move({ stand: true }));
  const dbl = button("Double", () => ctx.move({ double: true }));
  ctx.controls.append(hit, stand, dbl);
  return {
    update: (t) => {
      const s = t.view as Omit<BlackjackState, "dealer"> & { dealer: Array<Card | null> };
      const hand = (label: string, cards: Array<Card | null>, extra = "", up = false) => {
        const row = el("div", `bj-hand${up ? " to-move" : ""}`);
        const known = cards.filter((c): c is Card => !!c);
        row.append(el("span", "bj-label", `${label}${known.length === cards.length && cards.length ? ` (${handValue(known)})` : ""}${extra}`), ...cards.map(playingCard));
        return row;
      };
      const last = s.lastRound;
      view.replaceChildren(
        el("p", "game-info", `Hand ${s.round} of 5`),
        hand("Dealer", s.dealer),
        ...s.hands.map((h, i) => hand(seatName(t, i), h, ` · ${s.chips[i]} chips · bet ${s.bets[i]}`, s.waiting[0] === i)),
        ...(last
          ? [el("p", "game-info", `Last hand — dealer ${handValue(last.dealer)}: ${last.deltas.map((d, i) => `${seatName(t, i)} ${d > 0 ? "+" : ""}${d}`).join(" · ")}`)]
          : []),
      );
      const mine = myTurn(t);
      hit.hidden = stand.hidden = !mine;
      dbl.hidden = !mine || s.hands[t.you]?.length !== 2;
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Memory

export const memoryRenderer: RendererFactory = (ctx) => {
  const grid = el("div", "memory-grid");
  const info = el("span", "game-info");
  ctx.board.append(grid);
  ctx.controls.append(info);
  return {
    update: (t) => {
      const s = t.view as { faces: string[]; owner: number[]; up: number[]; scores: number[] };
      grid.replaceChildren(
        ...s.faces.map((face, i) => {
          const card = button(face || "?", () => myTurn(t) && ctx.move({ flip: i }), "memory-card");
          if (s.owner[i]! >= 0) {
            card.classList.add("matched");
            card.style.borderColor = SEAT_COLORS[s.owner[i]!]!;
          } else if (face) card.classList.add("up");
          return card;
        }),
      );
      info.textContent = s.scores.map((sc, i) => `${seatName(t, i)} ${sc}`).join(" · ");
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Hangman

export const hangmanRenderer: RendererFactory = (ctx) => {
  const b = new Board(ctx.board, 420, 220);
  const word = el("p", "hangman-word");
  const keys = el("div", "letter-keys");
  const info = el("span", "game-info");
  ctx.board.append(word, keys);
  ctx.controls.append(info);
  const onKey = (e: KeyboardEvent) => {
    const t = ctx.table();
    if (/^Key[A-Z]$/.test(e.code) && myTurn(t) && !(e.target instanceof HTMLInputElement)) ctx.move({ letter: e.code.slice(3).toLowerCase() });
  };
  window.addEventListener("keydown", onKey);
  return {
    update: (t) => {
      const s = t.view as { word: string; guessed: string[]; misses: number; scores: number[] };
      b.clear("#fffbeb");
      const c = b.ctx;
      c.strokeStyle = "#1f2937";
      c.lineWidth = 5;
      c.lineCap = "round";
      const parts: Array<() => void> = [
        () => (c.beginPath(), c.arc(300, 70, 18, 0, Math.PI * 2), c.stroke()),
        () => (c.beginPath(), c.moveTo(300, 88), c.lineTo(300, 140), c.stroke()),
        () => (c.beginPath(), c.moveTo(300, 100), c.lineTo(278, 122), c.stroke()),
        () => (c.beginPath(), c.moveTo(300, 100), c.lineTo(322, 122), c.stroke()),
        () => (c.beginPath(), c.moveTo(300, 140), c.lineTo(282, 172), c.stroke()),
        () => (c.beginPath(), c.moveTo(300, 140), c.lineTo(318, 172), c.stroke()),
        () => b.text("✕ ✕", 300, 68, "700 12px system-ui", "#e63946"),
      ];
      c.beginPath();
      c.moveTo(180, 200);
      c.lineTo(260, 200);
      c.moveTo(220, 200);
      c.lineTo(220, 30);
      c.lineTo(300, 30);
      c.lineTo(300, 52);
      c.stroke();
      parts.slice(0, s.misses).forEach((draw) => draw());
      b.text(`${HANGMAN_MAX_MISSES - s.misses} misses left`, 90, 110, "600 16px system-ui", "#57534e");
      word.textContent = [...s.word].join(" ").toUpperCase();
      keys.replaceChildren(
        ..."abcdefghijklmnopqrstuvwxyz".split("").map((l) => {
          const k = button(l.toUpperCase(), () => ctx.move({ letter: l }), "letter-key");
          k.disabled = s.guessed.includes(l) || !myTurn(t);
          if (s.guessed.includes(l)) k.classList.add(s.word.includes(l) ? "hit" : "miss");
          return k;
        }),
      );
      info.textContent = s.scores.map((sc, i) => `${seatName(t, i)} ${sc}`).join(" · ");
    },
    destroy: () => window.removeEventListener("keydown", onKey),
  };
};

// ------------------------------------------------------------ Rock Paper Scissors

const RPS_ICON: Record<string, string> = { rock: "✊", paper: "✋", scissors: "✌️", hidden: "❔" };

export const rpsRenderer: RendererFactory = (ctx) => {
  const view = el("div", "rps");
  const picks = el("div", "rps-picks");
  ctx.board.append(view, picks);
  return {
    update: (t) => {
      const s = t.view as { picks: Array<string | null>; scores: number[]; last: { picks: string[]; winner: number } | null };
      const last = s.last;
      view.replaceChildren(
        el("p", "rps-score", `${seatName(t, 0)} ${s.scores[0]} – ${s.scores[1]} ${seatName(t, 1)}`),
        el("div", "rps-last", last ? `${RPS_ICON[last.picks[0]!]}  vs  ${RPS_ICON[last.picks[1]!]}` : "✊ ✋ ✌️"),
        el("p", "game-info", last ? (last.winner < 0 ? "Same pick — no point" : `${seatName(t, last.winner)} takes the point`) : "First to 3"),
        el("p", "game-info", s.picks.map((p, i) => `${seatName(t, i)}: ${p ? (p === "hidden" ? "picked ✔" : `${RPS_ICON[p]} picked`) : "thinking…"}`).join(" · ")),
      );
      const canPick = myTurn(t);
      picks.replaceChildren(...RPS.map((p) => {
        const btn = button(`${RPS_ICON[p]} ${p}`, () => ctx.move({ pick: p }), "rps-pick");
        btn.disabled = !canPick;
        return btn;
      }));
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Trivia

export const triviaRenderer: RendererFactory = (ctx) => {
  const view = el("div", "trivia");
  ctx.board.append(view);
  return {
    update: (t) => {
      const s = t.view as {
        question: { q: string; options: string[] } | null;
        number: number;
        total: number;
        answered: boolean[];
        mine: number | null;
        scores: number[];
        reveal: { q: string; options: string[]; answer: number; answers: Array<number | null> } | null;
      };
      const nodes: HTMLElement[] = [el("p", "game-info", s.scores.map((sc, i) => `${seatName(t, i)} ${sc}`).join(" · "))];
      if (s.reveal) {
        const r = s.reveal;
        nodes.push(
          el(
            "p",
            "trivia-reveal",
            `Last: ${r.q} → ${r.options[r.answer]} ✔ (${r.answers.map((a, i) => `${seatName(t, i)} ${a === r.answer ? "✅" : "❌"}`).join(", ")})`,
          ),
        );
      }
      if (s.question) {
        nodes.push(el("p", "trivia-q", `Q${Math.min(s.number, s.total)}/${s.total}: ${s.question.q}`));
        const opts = el("div", "trivia-options");
        s.question.options.forEach((o, i) => {
          const btn = button(o, () => ctx.move({ answer: i }), "trivia-option");
          btn.disabled = !myTurn(t);
          if (s.mine === i) btn.classList.add("chosen");
          opts.append(btn);
        });
        nodes.push(opts, el("p", "game-info", s.answered.map((a, i) => `${seatName(t, i)} ${a ? "answered" : "thinking…"}`).join(" · ")));
      }
      view.replaceChildren(...nodes);
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Code Breaker

const PEG_COLORS = ["#e63946", "#f59e0b", "#facc15", "#22c55e", "#3b82f6", "#a855f7"];

export const codebreakerRenderer: RendererFactory = (ctx) => {
  const history = el("div", "code-history");
  const picker = el("div", "code-picker");
  ctx.board.append(history, picker);
  let pegs = Array(CODE_LENGTH).fill(0) as number[];
  const peg = (c: number) => {
    const p = el("span", "peg");
    p.style.background = PEG_COLORS[c]!;
    return p;
  };
  return {
    update: (t) => {
      const s = t.view as { guesses: Array<{ seat: number; pegs: number[]; exact: number; near: number }>; secret: number[] | null };
      history.replaceChildren(
        ...s.guesses.map((g) => {
          const row = el("div", "code-row");
          row.append(el("span", "code-who", seatName(t, g.seat)), ...g.pegs.map(peg), el("span", "code-score", "●".repeat(g.exact) + "○".repeat(g.near) || "—"));
          return row;
        }),
        ...(s.secret ? [(() => { const row = el("div", "code-row secret"); row.append(el("span", "code-who", "Secret"), ...s.secret.map(peg)); return row; })()] : []),
      );
      history.scrollTop = history.scrollHeight;
      const mine = myTurn(t);
      picker.hidden = !mine;
      const slots = pegs.map((c, i) => {
        const btn = button("", () => {
          pegs[i] = (pegs[i]! + 1) % CODE_COLORS;
          btn.style.background = PEG_COLORS[pegs[i]!]!;
        }, "peg big");
        btn.style.background = PEG_COLORS[c]!;
        btn.title = "Click to change colour";
        return btn;
      });
      picker.replaceChildren(el("span", "", "Your guess:"), ...slots, button("Guess", () => ctx.move({ pegs: [...pegs] }), "primary"));
    },
    destroy: () => {},
  };
};

// ------------------------------------------------------------ Darts

export const dartsRenderer: RendererFactory = (ctx) => {
  const S = 460;
  const b = new Board(ctx.board, S, S);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  const scale = (S / 2 - 10) / DART_RINGS.board;
  const c = S / 2;
  let aim: { x: number; y: number } | null = null;

  function draw(): void {
    const t = ctx.table();
    const s = t.view as { remaining: number[]; turn: number; visit: Array<{ x: number; y: number; label: string }>; note: string; round: number };
    b.clear("#1f2937");
    b.disc(c, c, DART_RINGS.board * scale, "#111");
    for (let i = 0; i < 20; i++) {
      const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
      const a1 = a0 + (18 * Math.PI) / 180;
      const ring = (r0: number, r1: number, color: string) => {
        b.ctx.fillStyle = color;
        b.ctx.beginPath();
        b.ctx.arc(c, c, r1 * scale, a0, a1);
        b.ctx.arc(c, c, r0 * scale, a1, a0, true);
        b.ctx.fill();
      };
      const odd = i % 2 === 1;
      ring(DART_RINGS.outerBull, DART_RINGS.tripleIn, odd ? "#f5e6c8" : "#1b1b1b");
      ring(DART_RINGS.tripleIn, DART_RINGS.tripleOut, odd ? "#2a9d8f" : "#e63946");
      ring(DART_RINGS.tripleOut, DART_RINGS.doubleIn, odd ? "#f5e6c8" : "#1b1b1b");
      ring(DART_RINGS.doubleIn, DART_RINGS.doubleOut, odd ? "#2a9d8f" : "#e63946");
      const mid = ((i * 18 - 90) * Math.PI) / 180;
      b.text(String(DART_NUMBERS[i]), c + Math.cos(mid) * 196 * scale, c + Math.sin(mid) * 196 * scale, "700 15px system-ui", "#fff");
    }
    b.disc(c, c, DART_RINGS.outerBull * scale, "#2a9d8f");
    b.disc(c, c, DART_RINGS.bull * scale, "#e63946");
    for (const d of s.visit) {
      if (d.x > 900) continue;
      b.disc(c + d.x * scale, c + d.y * scale, 5, "#facc15", "#111", 2);
    }
    if (aim && myTurn(t)) {
      b.ring(aim.x, aim.y, 10, "#22d3ee", 2);
      b.ctx.fillStyle = "#22d3ee";
      b.ctx.fillRect(aim.x - 14, aim.y - 1, 28, 2);
      b.ctx.fillRect(aim.x - 1, aim.y - 14, 2, 28);
    }
    const thrown = s.visit.filter((d) => d.x < 900).map((d) => d.label).join(", ");
    info.textContent = `${s.remaining.map((r, i) => `${seatName(t, i)} ${r}`).join(" · ")} — round ${Math.min(s.round, 15)}/15${thrown ? ` · this visit: ${thrown}` : ""}${s.note ? ` · ${s.note}` : ""}`;
  }
  b.onPointerMove((x, y) => {
    aim = { x, y };
    draw();
  });
  b.onClick((x, y) => {
    if (myTurn(ctx.table())) ctx.move({ x: (x - c) / scale, y: (y - c) / scale });
  });
  return { update: draw, destroy: () => {} };
};
