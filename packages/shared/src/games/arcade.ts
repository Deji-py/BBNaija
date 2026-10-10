import { defineGame, intField, numField, scoreLine, type GameResult, type Rng } from "./types.js";

/**
 * Real-time arcade games — Pong, Air Hockey and Light Cycles (Tron) — stepped by
 * the server many times a second, plus Darts (turn-based, with a shaky hand).
 */

// ------------------------------------------------------------ Pong

export const PONG = { w: 100, h: 60, paddleH: 14, paddleX: 4, ball: 1.4, target: 5 } as const;
const PADDLE_SPEED = 75;
const SERVE_DELAY = 1;

export interface PongState {
  paddles: number[];
  dirs: number[];
  ball: { x: number; y: number; vx: number; vy: number };
  scores: number[];
  /** Seconds until the ball is served again. */
  wait: number;
  over: GameResult | null;
}

function serve(s: PongState, towards: number, rng: Rng): void {
  const angle = (rng() - 0.5) * 0.9;
  const speed = 48;
  s.ball = { x: PONG.w / 2, y: PONG.h / 2, vx: Math.cos(angle) * speed * (towards === 0 ? -1 : 1), vy: Math.sin(angle) * speed };
  s.wait = SERVE_DELAY;
}

export const pong = defineGame<PongState>({
  id: "pong",
  name: "Pong",
  icon: "🏓",
  rules: `Move your paddle with W/S or ↑/↓ (or the mouse). Don't let the ball past you. First to ${PONG.target}.`,
  minPlayers: 2,
  maxPlayers: 2,
  realtime: true,
  setup: (_p, rng) => {
    const s: PongState = { paddles: [PONG.h / 2, PONG.h / 2], dirs: [0, 0], ball: { x: 0, y: 0, vx: 0, vy: 0 }, scores: [0, 0], wait: 0, over: null };
    serve(s, rng() < 0.5 ? 0 : 1, rng);
    return s;
  },
  turn: (s) => (s.over ? [] : [0, 1]),
  move: () => "Use the paddle controls",
  input(s, seat, input) {
    const y = numField(input, "y", 0, PONG.h);
    if (y !== null) {
      // Pointer control: head towards the pointer at paddle speed.
      s.dirs[seat] = Math.abs(y - s.paddles[seat]!) < 1 ? 0 : Math.sign(y - s.paddles[seat]!);
      return;
    }
    const dir = intField(input, "dir", -1, 1);
    if (dir !== null) s.dirs[seat] = dir;
  },
  tick(s, dt, rng) {
    if (s.over) return;
    const half = PONG.paddleH / 2;
    s.paddles = s.paddles.map((p, i) => Math.min(PONG.h - half, Math.max(half, p + s.dirs[i]! * PADDLE_SPEED * dt)));
    if (s.wait > 0) {
      s.wait -= dt;
      return;
    }
    const b = s.ball;
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (b.y < PONG.ball) (b.y = PONG.ball), (b.vy = Math.abs(b.vy));
      if (b.y > PONG.h - PONG.ball) (b.y = PONG.h - PONG.ball), (b.vy = -Math.abs(b.vy));
      for (const seat of [0, 1]) {
        const px = seat === 0 ? PONG.paddleX : PONG.w - PONG.paddleX;
        const facing = seat === 0 ? b.vx < 0 : b.vx > 0;
        if (!facing || Math.abs(b.x - px) > PONG.ball + 0.8) continue;
        const off = (b.y - s.paddles[seat]!) / half;
        if (Math.abs(off) > 1.1) continue;
        // Hit: the further from the middle, the steeper it leaves; each hit is a bit faster.
        const speed = Math.min(Math.hypot(b.vx, b.vy) * 1.06, 120);
        const angle = off * 0.9;
        b.vx = Math.cos(angle) * speed * (seat === 0 ? 1 : -1);
        b.vy = Math.sin(angle) * speed;
      }
      if (b.x < 0 || b.x > PONG.w) {
        const scorer = b.x < 0 ? 1 : 0;
        s.scores[scorer]! += 1;
        if (s.scores[scorer] === PONG.target) {
          s.over = { winners: [scorer], text: `First to ${PONG.target} (${scoreLine(s.scores)})` };
          return;
        }
        serve(s, 1 - scorer, rng);
        return;
      }
    }
  },
  result: (s) => s.over,
});

// ------------------------------------------------------------ Air hockey

/** Vertical table: seat 0 defends the bottom goal (y = h), seat 1 the top (y = 0). */
export const HOCKEY = { w: 60, h: 100, goal: 24, mallet: 4.2, puck: 2.8, target: 5 } as const;
const MALLET_SPEED = 170;
const PUCK_MAX = 150;

export interface HockeyState {
  mallets: Array<{ x: number; y: number; vx: number; vy: number }>;
  targets: Array<{ x: number; y: number }>;
  puck: { x: number; y: number; vx: number; vy: number };
  scores: number[];
  wait: number;
  over: GameResult | null;
}

function hockeyFace(s: HockeyState, loser: number): void {
  s.puck = { x: HOCKEY.w / 2, y: loser === 0 ? HOCKEY.h * 0.62 : HOCKEY.h * 0.38, vx: 0, vy: 0 };
  s.wait = 1;
}

function malletBounds(seat: number) {
  const r = HOCKEY.mallet;
  return seat === 0
    ? { minX: r, maxX: HOCKEY.w - r, minY: HOCKEY.h / 2 + r, maxY: HOCKEY.h - r }
    : { minX: r, maxX: HOCKEY.w - r, minY: r, maxY: HOCKEY.h / 2 - r };
}

export const airhockey = defineGame<HockeyState>({
  id: "airhockey",
  name: "Air Hockey",
  icon: "🏒",
  rules: `Move your mallet with the mouse in your half. Smash the puck into their goal. First to ${HOCKEY.target}.`,
  minPlayers: 2,
  maxPlayers: 2,
  realtime: true,
  setup: () => {
    const s: HockeyState = {
      mallets: [
        { x: HOCKEY.w / 2, y: HOCKEY.h * 0.88, vx: 0, vy: 0 },
        { x: HOCKEY.w / 2, y: HOCKEY.h * 0.12, vx: 0, vy: 0 },
      ],
      targets: [
        { x: HOCKEY.w / 2, y: HOCKEY.h * 0.88 },
        { x: HOCKEY.w / 2, y: HOCKEY.h * 0.12 },
      ],
      puck: { x: HOCKEY.w / 2, y: HOCKEY.h / 2, vx: 0, vy: 0 },
      scores: [0, 0],
      wait: 1,
      over: null,
    };
    return s;
  },
  turn: (s) => (s.over ? [] : [0, 1]),
  move: () => "Use the mallet controls",
  input(s, seat, input) {
    const x = numField(input, "x", 0, HOCKEY.w);
    const y = numField(input, "y", 0, HOCKEY.h);
    if (x !== null && y !== null) s.targets[seat] = { x, y };
  },
  tick(s, dt) {
    if (s.over) return;
    const steps = 6;
    const h = dt / steps;
    for (let k = 0; k < steps; k++) {
      s.mallets.forEach((m, seat) => {
        const b = malletBounds(seat);
        const t = s.targets[seat]!;
        const tx = Math.min(b.maxX, Math.max(b.minX, t.x));
        const ty = Math.min(b.maxY, Math.max(b.minY, t.y));
        const dx = tx - m.x;
        const dy = ty - m.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.min(dist, MALLET_SPEED * h);
        const nx = dist > 0 ? m.x + (dx / dist) * step : m.x;
        const ny = dist > 0 ? m.y + (dy / dist) * step : m.y;
        m.vx = (nx - m.x) / h;
        m.vy = (ny - m.y) / h;
        m.x = nx;
        m.y = ny;
      });
      if (s.wait > 0) continue;
      const p = s.puck;
      p.x += p.vx * h;
      p.y += p.vy * h;
      const damp = Math.pow(0.6, h);
      p.vx *= damp;
      p.vy *= damp;
      // Side walls.
      if (p.x < HOCKEY.puck) (p.x = HOCKEY.puck), (p.vx = Math.abs(p.vx) * 0.9);
      if (p.x > HOCKEY.w - HOCKEY.puck) (p.x = HOCKEY.w - HOCKEY.puck), (p.vx = -Math.abs(p.vx) * 0.9);
      // End walls, except across the goal mouth.
      const inMouth = Math.abs(p.x - HOCKEY.w / 2) < HOCKEY.goal / 2;
      if (!inMouth) {
        if (p.y < HOCKEY.puck) (p.y = HOCKEY.puck), (p.vy = Math.abs(p.vy) * 0.9);
        if (p.y > HOCKEY.h - HOCKEY.puck) (p.y = HOCKEY.h - HOCKEY.puck), (p.vy = -Math.abs(p.vy) * 0.9);
      } else if (p.y < -HOCKEY.puck || p.y > HOCKEY.h + HOCKEY.puck) {
        const scorer = p.y < 0 ? 0 : 1;
        s.scores[scorer]! += 1;
        if (s.scores[scorer] === HOCKEY.target) {
          s.over = { winners: [scorer], text: `First to ${HOCKEY.target} (${scoreLine(s.scores)})` };
          return;
        }
        hockeyFace(s, 1 - scorer);
        continue;
      }
      // Mallet hits: push the puck out and bounce it off the moving mallet.
      for (const m of s.mallets) {
        const dx = p.x - m.x;
        const dy = p.y - m.y;
        const dist = Math.hypot(dx, dy);
        const min = HOCKEY.mallet + HOCKEY.puck;
        if (dist >= min || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        p.x = m.x + nx * min;
        p.y = m.y + ny * min;
        const rel = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
        if (rel < 0) {
          p.vx -= 1.9 * rel * nx;
          p.vy -= 1.9 * rel * ny;
        }
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > PUCK_MAX) (p.vx *= PUCK_MAX / speed), (p.vy *= PUCK_MAX / speed);
      }
    }
    if (s.wait > 0) s.wait -= dt;
  },
  result: (s) => s.over,
  view: (s) => ({ ...s, targets: undefined }),
});

// ------------------------------------------------------------ Light cycles (Tron)

export const TRON = { w: 48, h: 32, stepEvery: 0.09, rounds: 3 } as const;
/** Directions: 0 up, 1 right, 2 down, 3 left. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface TronState {
  /** One character per cell: "." empty, "0"–"3" a trail. */
  grid: string;
  heads: Array<{ x: number; y: number; dir: number; next: number; alive: boolean }>;
  wins: number[];
  clock: number;
  wait: number;
  roundWinner: number;
  version: number;
  over: GameResult | null;
}

function tronRound(s: TronState): void {
  const n = s.heads.length;
  const starts = [
    { x: 6, y: 6, dir: 1 },
    { x: TRON.w - 7, y: TRON.h - 7, dir: 3 },
    { x: TRON.w - 7, y: 6, dir: 2 },
    { x: 6, y: TRON.h - 7, dir: 0 },
  ];
  const grid = Array(TRON.w * TRON.h).fill(".");
  s.heads = starts.slice(0, n).map((st, i) => {
    grid[st.y * TRON.w + st.x] = String(i);
    return { ...st, next: st.dir, alive: true };
  });
  s.grid = grid.join("");
  s.wait = 1.2;
  s.clock = 0;
}

export const tron = defineGame<TronState>({
  id: "tron",
  name: "Light Cycles",
  icon: "🏍️",
  rules: `Steer with WASD or the arrows. Your bike leaves a wall behind it — crash into any wall and you're out. Last rider wins the round; first to ${TRON.rounds} rounds.`,
  minPlayers: 2,
  maxPlayers: 4,
  realtime: true,
  setup: (players) => {
    const s: TronState = { grid: "", heads: Array.from({ length: players }, () => ({ x: 0, y: 0, dir: 0, next: 0, alive: true })), wins: Array(players).fill(0), clock: 0, wait: 0, roundWinner: -1, version: 0, over: null };
    tronRound(s);
    return s;
  },
  turn: (s) => (s.over ? [] : s.heads.map((_, i) => i)),
  move: () => "Steer with the arrow keys",
  input(s, seat, input) {
    const dir = intField(input, "dir", 0, 3);
    const head = s.heads[seat];
    if (dir === null || !head || !head.alive) return;
    if ((dir + 2) % 4 !== head.dir) head.next = dir; // no U-turns
  },
  tick(s, dt) {
    if (s.over) return;
    if (s.wait > 0) {
      s.wait -= dt;
      if (s.wait <= 0 && s.heads.filter((h) => h.alive).length <= 1) tronRound(s);
      return;
    }
    s.clock += dt;
    while (s.clock >= TRON.stepEvery) {
      s.clock -= TRON.stepEvery;
      const grid = s.grid.split("");
      const alive = s.heads.filter((h) => h.alive);
      const targets = alive.map((h) => {
        h.dir = h.next;
        return { h, x: h.x + DX[h.dir]!, y: h.y + DY[h.dir]! };
      });
      for (const t of targets) {
        const outside = t.x < 0 || t.y < 0 || t.x >= TRON.w || t.y >= TRON.h;
        const headOn = targets.some((o) => o !== t && o.x === t.x && o.y === t.y);
        if (outside || headOn || grid[t.y * TRON.w + t.x] !== ".") t.h.alive = false;
      }
      for (const t of targets) {
        if (!t.h.alive) continue;
        t.h.x = t.x;
        t.h.y = t.y;
        grid[t.y * TRON.w + t.x] = String(s.heads.indexOf(t.h));
      }
      s.grid = grid.join("");
      s.version++;
      const left = s.heads.map((h, i) => (h.alive ? i : -1)).filter((i) => i >= 0);
      if (left.length <= 1) {
        s.roundWinner = left[0] ?? -1;
        if (s.roundWinner >= 0) s.wins[s.roundWinner]! += 1;
        if (s.roundWinner >= 0 && s.wins[s.roundWinner] === TRON.rounds) {
          s.over = { winners: [s.roundWinner], text: `${TRON.rounds} rounds won (${scoreLine(s.wins)})` };
          return;
        }
        s.wait = 2;
        return;
      }
    }
  },
  result: (s) => s.over,
});

// ------------------------------------------------------------ Darts (301)

/** Board in millimetres. Segment numbers clockwise from the top. */
export const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const DART_RINGS = { bull: 6.35, outerBull: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, doubleOut: 170, board: 225 } as const;
const DART_START = 301;
const DART_ROUNDS = 15;
/** How shaky a throw is (mm, standard deviation). */
const DART_SPREAD = 16;

export function dartScore(x: number, y: number): { score: number; label: string } {
  const r = Math.hypot(x, y);
  if (r <= DART_RINGS.bull) return { score: 50, label: "Bullseye" };
  if (r <= DART_RINGS.outerBull) return { score: 25, label: "25" };
  if (r > DART_RINGS.doubleOut) return { score: 0, label: "Miss" };
  // Angle clockwise from straight up (y is down on screen, so up is -y).
  const angle = (Math.atan2(x, -y) * 180) / Math.PI;
  const segment = Math.floor((((angle + 9) % 360) + 360) % 360 / 18);
  const n = DART_NUMBERS[segment]!;
  if (r >= DART_RINGS.tripleIn && r <= DART_RINGS.tripleOut) return { score: n * 3, label: `T${n}` };
  if (r >= DART_RINGS.doubleIn) return { score: n * 2, label: `D${n}` };
  return { score: n, label: String(n) };
}

export interface DartsState {
  remaining: number[];
  turn: number;
  /** Throws this visit: where they landed and what they scored. */
  visit: Array<{ x: number; y: number; score: number; label: string }>;
  /** Score at the start of this visit (restored on a bust). */
  visitStart: number;
  round: number;
  note: string;
  over: GameResult | null;
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export const darts = defineGame<DartsState>({
  id: "darts",
  name: "Darts 301",
  icon: "🎯",
  rules: `Click where to aim — your hand wobbles a little. Three darts a visit, counting down from ${DART_START} to exactly zero. Go below zero and the visit is bust.`,
  minPlayers: 2,
  maxPlayers: 4,
  setup: (players) => ({ remaining: Array(players).fill(DART_START), turn: 0, visit: [], visitStart: DART_START, round: 1, note: "", over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m, rng) {
    const ax = numField(m, "x", -DART_RINGS.board, DART_RINGS.board);
    const ay = numField(m, "y", -DART_RINGS.board, DART_RINGS.board);
    if (ax === null || ay === null) return "Click the board to throw";
    // A finished visit stays on show until the next throw.
    if (s.visit.length === 3) s.visit = [];
    if (s.visit.length === 0) s.visitStart = s.remaining[seat]!;
    const x = ax + gaussian(rng) * DART_SPREAD;
    const y = ay + gaussian(rng) * DART_SPREAD;
    const hit = dartScore(x, y);
    s.visit.push({ x, y, ...hit });
    const left = s.remaining[seat]! - hit.score;
    const players = s.remaining.length;
    const endVisit = () => {
      if (seat === players - 1) s.round++;
      s.turn = (seat + 1) % players;
      if (s.round > DART_ROUNDS) {
        const best = Math.min(...s.remaining);
        s.over = { winners: s.remaining.flatMap((r, i) => (r === best ? [i] : [])), text: `Closest to zero after ${DART_ROUNDS} rounds` };
      }
    };
    if (left < 0) {
      s.remaining[seat] = s.visitStart;
      s.note = `Bust! Back to ${s.visitStart}`;
      // Fill the visit so the next throw starts a fresh one; the client skips these markers.
      while (s.visit.length < 3) s.visit.push({ x: 999, y: 999, score: 0, label: "—" });
      endVisit();
      return null;
    }
    s.remaining[seat] = left;
    s.note = hit.label === "Miss" ? "Missed the board" : `${hit.label} — ${hit.score}`;
    if (left === 0) {
      s.over = { winners: [seat], text: "Checked out on zero!" };
      return null;
    }
    if (s.visit.length === 3) endVisit();
    return null;
  },
  result: (s) => s.over,
  moves: () => [{ x: 0, y: -103 }, { x: 0, y: 0 }, { x: 40, y: -120 }],
});
