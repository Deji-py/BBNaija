import { defineGame, isObj, numField, scoreLine, type GameResult } from "./types.js";

/**
 * Cue sports: 8-ball pool and six-red snooker, on one small physics engine.
 *
 * A shot is simulated on the server from start to finish the moment it's taken;
 * the state keeps the starting positions and the cue's velocity so clients can
 * replay the same simulation as an animation, then settle on the server's result.
 * Units are metres on the table bed; (0, 0) is the top-left corner of the cloth.
 */

export interface Ball {
  /** 0 = cue ball. Pool: 1–15. Snooker: 1–6 reds, then 2–7 for the colours (ids 102–107). */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  potted: boolean;
}

export interface TableSpec {
  w: number;
  h: number;
  r: number;
  pockets: Array<{ x: number; y: number; r: number }>;
  maxSpeed: number;
}

function sixPockets(w: number, h: number, corner: number, middle: number): TableSpec["pockets"] {
  return [
    { x: 0, y: 0, r: corner },
    { x: w / 2, y: -0.012, r: middle },
    { x: w, y: 0, r: corner },
    { x: 0, y: h, r: corner },
    { x: w / 2, y: h + 0.012, r: middle },
    { x: w, y: h, r: corner },
  ];
}

export const POOL_TABLE: TableSpec = { w: 2.24, h: 1.12, r: 0.0286, pockets: sixPockets(2.24, 1.12, 0.062, 0.056), maxSpeed: 5.5 };
export const SNOOKER_TABLE: TableSpec = { w: 3.57, h: 1.78, r: 0.0263, pockets: sixPockets(3.57, 1.78, 0.058, 0.05), maxSpeed: 6 };

export interface ShotEvents {
  firstHit: number | null;
  potted: number[];
}

const DT = 1 / 240;
const ROLL_DECEL = 0.55;
const DAMPING = 0.35;
const CUSHION = 0.78;
const BALL_RESTITUTION = 0.96;

/**
 * Advances the balls one step. Shared by the server (whole shot at once) and the
 * client (animation), so both see the same thing.
 */
export function stepBalls(balls: Ball[], table: TableSpec, events: ShotEvents): boolean {
  let moving = false;
  const r = table.r;
  for (const b of balls) {
    if (b.potted) continue;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed === 0) continue;
    const slower = Math.max(0, speed - ROLL_DECEL * DT) * (1 - DAMPING * DT);
    if (slower < 0.004) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    b.vx *= slower / speed;
    b.vy *= slower / speed;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    moving = true;

    const pocket = table.pockets.find((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r);
    if (pocket) {
      b.potted = true;
      b.vx = 0;
      b.vy = 0;
      events.potted.push(b.id);
      continue;
    }
    // Cushions, except in the jaws of a pocket where the ball can drop in.
    const nearPocket = table.pockets.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r * 1.7);
    if (!nearPocket) {
      if (b.x < r) (b.x = r), (b.vx = Math.abs(b.vx) * CUSHION);
      if (b.x > table.w - r) (b.x = table.w - r), (b.vx = -Math.abs(b.vx) * CUSHION);
      if (b.y < r) (b.y = r), (b.vy = Math.abs(b.vy) * CUSHION);
      if (b.y > table.h - r) (b.y = table.h - r), (b.vy = -Math.abs(b.vy) * CUSHION);
    } else if (b.x < -0.1 || b.x > table.w + 0.1 || b.y < -0.1 || b.y > table.h + 0.1) {
      b.potted = true;
      events.potted.push(b.id);
    }
  }
  // Ball-to-ball collisions (equal masses).
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]!;
    if (a.potted) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]!;
      if (b.potted) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= 2 * r || dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = 2 * r - dist;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const impulse = (rel * (1 + BALL_RESTITUTION)) / 2;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
      if (events.firstHit === null && (a.id === 0 || b.id === 0)) events.firstHit = a.id === 0 ? b.id : a.id;
      moving = true;
    }
  }
  return moving;
}

/** Plays a shot to the end. Mutates `balls`. */
export function simulateShot(balls: Ball[], table: TableSpec): ShotEvents {
  const events: ShotEvents = { firstHit: null, potted: [] };
  for (let t = 0; t < 30 / DT; t++) if (!stepBalls(balls, table, events)) break;
  for (const b of balls) (b.vx = 0), (b.vy = 0);
  return events;
}

/** A shot from untrusted input: direction and power 0–1, plus an optional cue-ball spot for ball in hand. */
function parseShot(m: unknown): { angle: number; power: number; cue: { x: number; y: number } | null } | null {
  const angle = numField(m, "angle", -10, 10);
  const power = numField(m, "power", 0.05, 1);
  if (angle === null || power === null) return null;
  const cue = isObj(m) && isObj(m.cue) ? { x: numField(m.cue, "x", 0, 4) ?? -1, y: numField(m.cue, "y", 0, 2) ?? -1 } : null;
  return { angle, power, cue };
}

/** A legal spot for the cue ball: on the cloth, clear of the pocket jaws, and not touching another ball. */
export function freeSpot(balls: Ball[], table: TableSpec, x: number, y: number): boolean {
  const r = table.r;
  if (x < r || y < r || x > table.w - r || y > table.h - r) return false;
  if (table.pockets.some((p) => Math.hypot(p.x - x, p.y - y) < p.r * 1.8)) return false;
  return balls.every((b) => b.id === 0 || b.potted || Math.hypot(b.x - x, b.y - y) > 2 * r + 0.002);
}

export interface CueShot {
  seat: number;
  /** Positions before the shot, for replaying it. */
  balls: Ball[];
  vx: number;
  vy: number;
  /** Increases with every shot, so clients know a new one to animate. */
  n: number;
}

function take(balls: Ball[], table: TableSpec, angle: number, power: number, seat: number, n: number): { shot: CueShot; events: ShotEvents } {
  const cue = balls.find((b) => b.id === 0)!;
  const speed = power * table.maxSpeed;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const before = balls.map((b) => ({ ...b }));
  cue.vx = vx;
  cue.vy = vy;
  const events = simulateShot(balls, table);
  return { shot: { seat, balls: before, vx, vy, n }, events };
}

/** Sample shots straight at each target ball (tests use these to play whole frames). */
function aimedShots(balls: Ball[], table: TableSpec, targets: Ball[], placeCue: ((x: number, y: number) => boolean) | null): unknown[] {
  let cue = balls.find((b) => b.id === 0)!;
  let spot: { x: number; y: number } | undefined;
  if (placeCue) {
    for (let k = 1; k < 400 && !spot; k++) {
      const x = table.r + ((k * 0.37) % 1) * (table.w - 2 * table.r);
      const y = table.r + ((k * 0.61) % 1) * (table.h - 2 * table.r);
      if (placeCue(x, y)) spot = { x, y };
    }
    if (spot) cue = { ...cue, ...spot };
  }
  return targets.flatMap((t) =>
    [0.35, 0.7].map((power) => ({ angle: Math.atan2(t.y - cue.y, t.x - cue.x), power, ...(spot ? { cue: spot } : {}) })),
  );
}

// ------------------------------------------------------------ 8-ball pool

export interface PoolState {
  balls: Ball[];
  turn: number;
  /** Each seat's group once decided: "solids" (1–7) or "stripes" (9–15). */
  groups: Array<"solids" | "stripes" | null>;
  ballInHand: boolean;
  shot: CueShot | null;
  note: string;
  over: GameResult | null;
}

const isSolid = (id: number) => id >= 1 && id <= 7;
const isStripe = (id: number) => id >= 9 && id <= 15;
const inGroup = (id: number, g: "solids" | "stripes") => (g === "solids" ? isSolid(id) : isStripe(id));

function rack(table: TableSpec): Ball[] {
  const r = table.r;
  const footX = table.w * 0.73;
  const cy = table.h / 2;
  // 8 in the middle of the third row, a solid and a stripe in the back corners.
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 15, 7];
  const balls: Ball[] = [{ id: 0, x: table.w * 0.25, y: cy, vx: 0, vy: 0, potted: false }];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      balls.push({ id: order[k++]!, x: footX + row * r * 1.75, y: cy + (i - row / 2) * r * 2.02, vx: 0, vy: 0, potted: false });
    }
  }
  return balls;
}

export const pool = defineGame<PoolState>({
  id: "pool",
  name: "8-Ball Pool",
  icon: "🎱",
  rules: "Aim with the mouse, set power, and shoot. Pot your group (solids or stripes — the first ball potted decides), then the 8. Fouls give ball in hand.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ balls: rack(POOL_TABLE), turn: 0, groups: [null, null], ballInHand: false, shot: null, note: "Break!", over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const shot = parseShot(m);
    if (!shot) return "Aim and shoot";
    const cue = s.balls.find((b) => b.id === 0)!;
    if (s.ballInHand) {
      if (!shot.cue || !freeSpot(s.balls, POOL_TABLE, shot.cue.x, shot.cue.y)) return "Place the cue ball on a free spot";
      cue.x = shot.cue.x;
      cue.y = shot.cue.y;
      cue.potted = false;
      s.ballInHand = false;
    }
    const mine = s.groups[seat];
    const groupLeftBefore = mine ? s.balls.filter((b) => !b.potted && inGroup(b.id, mine)).length : -1;
    const { shot: record, events } = take(s.balls, POOL_TABLE, shot.angle, shot.power, seat, (s.shot?.n ?? 0) + 1);
    s.shot = record;

    const potted = events.potted;
    const cuePotted = potted.includes(0);
    const eightPotted = potted.includes(8);
    const onEight = groupLeftBefore === 0;
    let foul = cuePotted || events.firstHit === null;
    if (!foul && events.firstHit !== null) {
      if (mine) foul = onEight ? events.firstHit !== 8 : !inGroup(events.firstHit, mine);
      else foul = events.firstHit === 8;
    }

    if (eightPotted) {
      const win = onEight && !foul;
      s.over = win ? { winners: [seat], text: "Potted the 8!" } : { winners: [1 - seat], text: onEight ? "Fouled on the 8" : "The 8 went down too early" };
      return null;
    }
    // Open table: the first group ball potted decides who's who.
    if (!mine && !foul) {
      const first = potted.find((id) => isSolid(id) || isStripe(id));
      if (first !== undefined) {
        s.groups[seat] = isSolid(first) ? "solids" : "stripes";
        s.groups[1 - seat] = isSolid(first) ? "stripes" : "solids";
      }
    }
    const group = s.groups[seat];
    const pottedOwn = potted.some((id) => (group ? inGroup(id, group) : id !== 0));
    if (cuePotted) {
      cue.potted = false;
      cue.x = POOL_TABLE.w * 0.25;
      cue.y = POOL_TABLE.h / 2;
    }
    if (foul) {
      s.turn = 1 - seat;
      s.ballInHand = true;
      s.note = cuePotted ? "Foul — cue ball potted. Ball in hand" : events.firstHit === null ? "Foul — no ball hit. Ball in hand" : "Foul — wrong ball first. Ball in hand";
    } else if (pottedOwn) s.note = "Potted! Shoot again";
    else {
      s.turn = 1 - seat;
      s.note = "";
    }
    return null;
  },
  result: (s) => s.over,
  moves: (s, seat) => {
    const group = s.groups[seat];
    const left = s.balls.filter((b) => !b.potted && b.id !== 0 && (group ? inGroup(b.id, group) : b.id !== 8));
    const targets = left.length ? left : s.balls.filter((b) => b.id === 8);
    return aimedShots(s.balls, POOL_TABLE, targets, s.ballInHand ? (x, y) => freeSpot(s.balls, POOL_TABLE, x, y) : null);
  },
});

// ------------------------------------------------------------ Six-red snooker

/** Colour values by ball id: reds are 1–6 (value 1), colours are 100 + value. */
export const snookerValue = (id: number) => (id >= 100 ? id - 100 : id === 0 ? 0 : 1);
const isRed = (id: number) => id >= 1 && id <= 6;
const isColour = (id: number) => id >= 102;

const T = SNOOKER_TABLE;
/** Baulk line and the D (where the cue ball goes after going in-off). */
export const SNOOKER_BAULK = T.w * 0.2;
export const SNOOKER_D = T.h * 0.164;
const SPOTS: Record<number, { x: number; y: number }> = {
  102: { x: SNOOKER_BAULK, y: T.h / 2 + SNOOKER_D },
  103: { x: SNOOKER_BAULK, y: T.h / 2 - SNOOKER_D },
  104: { x: SNOOKER_BAULK, y: T.h / 2 },
  105: { x: T.w / 2, y: T.h / 2 },
  106: { x: T.w * 0.75, y: T.h / 2 },
  107: { x: T.w * 0.909, y: T.h / 2 },
};

export interface SnookerState {
  balls: Ball[];
  turn: number;
  scores: number[];
  /** "red", "colour" (any colour after a red), or the value of the colour due in the clearance (2–7). */
  on: "red" | "colour" | number;
  ballInHand: boolean;
  shot: CueShot | null;
  note: string;
  over: GameResult | null;
}

function snookerSetup(): Ball[] {
  const balls: Ball[] = [{ id: 0, x: SNOOKER_BAULK - 0.12, y: T.h / 2 + 0.1, vx: 0, vy: 0, potted: false }];
  for (const [id, spot] of Object.entries(SPOTS)) balls.push({ id: Number(id), x: spot.x, y: spot.y, vx: 0, vy: 0, potted: false });
  // Six reds in a triangle behind the pink.
  const apex = SPOTS[106]!.x + T.r * 2.2;
  let id = 1;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i <= row; i++) balls.push({ id: id++, x: apex + row * T.r * 1.75, y: T.h / 2 + (i - row / 2) * T.r * 2.02, vx: 0, vy: 0, potted: false });
  }
  return balls;
}

/** Put a colour back on its spot (or the nearest free spot towards the top cushion). */
function respot(s: SnookerState, id: number): void {
  const ball = s.balls.find((b) => b.id === id)!;
  const spot = SPOTS[id]!;
  for (let k = 0; k < 200; k++) {
    const x = Math.min(T.w - T.r, spot.x + k * T.r * 0.5);
    if (s.balls.every((b) => b === ball || b.potted || Math.hypot(b.x - x, b.y - spot.y) > 2 * T.r + 0.002)) {
      Object.assign(ball, { x, y: spot.y, potted: false, vx: 0, vy: 0 });
      return;
    }
  }
  Object.assign(ball, { x: spot.x, y: spot.y, potted: false });
}

const redsLeft = (s: SnookerState) => s.balls.some((b) => isRed(b.id) && !b.potted);

export const snooker = defineGame<SnookerState>({
  id: "snooker",
  name: "Snooker (6-red)",
  icon: "🔴",
  rules: "Pot a red (1), then any colour, and repeat. When the reds are gone, pot the colours in order: yellow 2, green 3, brown 4, blue 5, pink 6, black 7. Fouls give at least 4 to your opponent.",
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ balls: snookerSetup(), turn: 0, scores: [0, 0], on: "red", ballInHand: true, shot: null, note: "Place the cue ball in the D and break", over: null }),
  turn: (s) => (s.over ? [] : [s.turn]),
  move(s, seat, m) {
    const shot = parseShot(m);
    if (!shot) return "Aim and shoot";
    const cue = s.balls.find((b) => b.id === 0)!;
    if (s.ballInHand) {
      const c = shot.cue;
      const inD = c && c.x <= SNOOKER_BAULK && Math.hypot(c.x - SNOOKER_BAULK, c.y - T.h / 2) <= SNOOKER_D;
      if (!c || !inD || !freeSpot(s.balls, T, c.x, c.y)) return "Place the cue ball inside the D";
      cue.x = c.x;
      cue.y = c.y;
      cue.potted = false;
      s.ballInHand = false;
    }
    const on = s.on;
    const { shot: record, events } = take(s.balls, T, shot.angle, shot.power, seat, (s.shot?.n ?? 0) + 1);
    s.shot = record;
    const potted = events.potted;
    const first = events.firstHit;
    const legalFirst = first !== null && (on === "red" ? isRed(first) : on === "colour" ? isColour(first) : first === 100 + on);
    const nominated = on === "colour" ? first : null;
    const badPot = potted.some((id) => {
      if (id === 0) return true;
      if (on === "red") return !isRed(id);
      if (on === "colour") return id !== nominated;
      return id !== 100 + on;
    });
    const foul = !legalFirst || badPot;

    if (foul) {
      const values = [4, on === "red" || on === "colour" ? 0 : on, first !== null ? snookerValue(first) : 0, ...potted.map(snookerValue)];
      const penalty = Math.max(...values);
      s.scores[1 - seat]! += penalty;
      s.note = `Foul — ${penalty} to your opponent`;
      // Colours always come back after a foul (unless the frame is ending on the black).
      for (const id of potted) if (isColour(id) && !(typeof on === "number" && id === 107 && on === 7)) respot(s, id);
      if (potted.includes(0)) {
        cue.potted = false;
        s.ballInHand = true;
      }
      if (typeof on === "number" && on === 7 && potted.includes(107)) {
        endSnooker(s);
        return null;
      }
      s.turn = 1 - seat;
      s.on = redsLeft(s) ? "red" : typeof on === "number" ? on : 2;
      return null;
    }

    const points = potted.reduce((sum, id) => sum + snookerValue(id), 0);
    s.scores[seat]! += points;
    if (!potted.length) {
      s.note = "";
      s.turn = 1 - seat;
      s.on = redsLeft(s) ? "red" : typeof on === "number" ? on : 2;
      return null;
    }
    s.note = `+${points}`;
    if (on === "red") s.on = "colour";
    else if (on === "colour") {
      for (const id of potted) respot(s, id);
      s.on = redsLeft(s) ? "red" : 2;
    } else {
      if (on === 7) {
        endSnooker(s);
        return null;
      }
      s.on = on + 1;
    }
    return null;
  },
  result: (s) => s.over,
  moves: (s) => {
    const on = s.on;
    const targets = s.balls.filter((b) => !b.potted && (on === "red" ? isRed(b.id) : on === "colour" ? isColour(b.id) : b.id === 100 + on));
    const inD = (x: number, y: number) => x <= SNOOKER_BAULK && Math.hypot(x - SNOOKER_BAULK, y - T.h / 2) <= SNOOKER_D && freeSpot(s.balls, T, x, y);
    return aimedShots(s.balls, T, targets, s.ballInHand ? inD : null);
  },
});

function endSnooker(s: SnookerState): void {
  const [a, b] = s.scores as [number, number];
  s.over = a === b ? { winners: [], text: `Level at ${a} — draw` } : { winners: [a > b ? 0 : 1], text: `Frame over (${scoreLine(s.scores)})` };
}
