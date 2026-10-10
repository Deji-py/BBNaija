import {
  HOCKEY,
  PONG,
  POOL_TABLE,
  SNOOKER_BAULK,
  SNOOKER_D,
  SNOOKER_TABLE,
  TRON,
  stepBalls,
  type Ball,
  type CueShot,
  type GameTableView,
  type ShotEvents,
  type TableSpec,
} from "@bbn/shared";
import { Board, SEAT_COLORS, animate, el, keyListener, myTurn, seatName, type RendererFactory } from "./common.js";

/**
 * Real-time arcade games and cue sports. Real-time views arrive ~30 times a
 * second; between them the ball/puck is nudged along by its velocity so motion
 * stays smooth at the screen's frame rate.
 */

/** Throttled sender for continuous pointer input. */
function throttle(send: (v: unknown) => void, ms: number): (v: unknown) => void {
  let last = 0;
  let pending: unknown = null;
  let timer = 0;
  return (v) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      send(v);
    } else {
      pending = v;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        last = performance.now();
        send(pending);
      }, ms - (now - last));
    }
  };
}

// ------------------------------------------------------------ Pong

export const pongRenderer: RendererFactory = (ctx) => {
  const K = 6;
  const b = new Board(ctx.board, PONG.w * K, PONG.h * K);
  const info = el("span", "game-info", "W/S or ↑/↓ — or move the mouse over the court");
  ctx.controls.append(info);
  let received = performance.now();
  const keys = new Set<string>();
  let sentDir = 0;
  const sendY = throttle((y) => ctx.input({ y }), 50);
  const stopKeys = keyListener((code, down) => {
    if (!["KeyW", "KeyS", "ArrowUp", "ArrowDown"].includes(code)) return;
    if (down) keys.add(code);
    else keys.delete(code);
    const dir = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    if (dir !== sentDir) {
      sentDir = dir;
      ctx.input({ dir });
    }
  });
  b.onPointerMove((_x, y) => {
    if (ctx.table().you >= 0) sendY(y / K);
  });
  const stop = animate(() => {
    const t = ctx.table();
    const s = t.view as { paddles: number[]; ball: { x: number; y: number; vx: number; vy: number }; scores: number[]; wait: number };
    if (!s) return;
    const ahead = s.wait > 0 || t.phase !== "playing" ? 0 : Math.min(0.06, (performance.now() - received) / 1000);
    b.clear("#0b1020");
    b.ctx.setLineDash([8, 10]);
    b.ctx.strokeStyle = "#334155";
    b.ctx.lineWidth = 3;
    b.ctx.beginPath();
    b.ctx.moveTo((PONG.w * K) / 2, 0);
    b.ctx.lineTo((PONG.w * K) / 2, PONG.h * K);
    b.ctx.stroke();
    b.ctx.setLineDash([]);
    b.text(String(s.scores[0]), PONG.w * K * 0.35, 40, "700 40px ui-monospace, monospace", SEAT_COLORS[0]!);
    b.text(String(s.scores[1]), PONG.w * K * 0.65, 40, "700 40px ui-monospace, monospace", SEAT_COLORS[1]!);
    s.paddles.forEach((p, i) => {
      const x = (i === 0 ? PONG.paddleX : PONG.w - PONG.paddleX) * K;
      b.ctx.fillStyle = SEAT_COLORS[i]!;
      b.ctx.fillRect(x - 6, (p - PONG.paddleH / 2) * K, 12, PONG.paddleH * K);
    });
    b.disc((s.ball.x + s.ball.vx * ahead) * K, (s.ball.y + s.ball.vy * ahead) * K, PONG.ball * K, "#f8fafc");
    b.text(`${seatName(t, 0)} ◀`, 12, PONG.h * K - 16, "600 14px system-ui", "#94a3b8", "left");
    b.text(`▶ ${seatName(t, 1)}`, PONG.w * K - 12, PONG.h * K - 16, "600 14px system-ui", "#94a3b8", "right");
  });
  return {
    update: () => (received = performance.now()),
    destroy: () => {
      stop();
      stopKeys();
    },
  };
};

// ------------------------------------------------------------ Air hockey

export const airhockeyRenderer: RendererFactory = (ctx) => {
  const K = 5;
  const b = new Board(ctx.board, HOCKEY.w * K, HOCKEY.h * K);
  ctx.controls.append(el("span", "game-info", "Move the mouse (or drag on touch) to steer your mallet — your goal is at the bottom"));
  let received = performance.now();
  /** Seat 1 sees the table turned round, so everyone defends the bottom of their screen. */
  const flip = () => ctx.table().you === 1;
  const toField = (x: number, y: number) => (flip() ? { x: HOCKEY.w - x / K, y: HOCKEY.h - y / K } : { x: x / K, y: y / K });
  const toScreen = (x: number, y: number) => (flip() ? { x: (HOCKEY.w - x) * K, y: (HOCKEY.h - y) * K } : { x: x * K, y: y * K });
  const send = throttle((p) => ctx.input(p), 33);
  b.onPointerMove((x, y) => {
    if (ctx.table().you >= 0) send(toField(x, y));
  });
  const stop = animate(() => {
    const t = ctx.table();
    const s = t.view as { mallets: Array<{ x: number; y: number }>; puck: { x: number; y: number; vx: number; vy: number }; scores: number[]; wait: number };
    if (!s) return;
    const ahead = s.wait > 0 || t.phase !== "playing" ? 0 : Math.min(0.05, (performance.now() - received) / 1000);
    b.clear("#e2e8f0");
    b.ctx.strokeStyle = "#e63946";
    b.ctx.lineWidth = 3;
    b.ctx.beginPath();
    b.ctx.moveTo(0, (HOCKEY.h * K) / 2);
    b.ctx.lineTo(HOCKEY.w * K, (HOCKEY.h * K) / 2);
    b.ctx.stroke();
    b.ring((HOCKEY.w * K) / 2, (HOCKEY.h * K) / 2, 12 * K, "#3b82f6", 3);
    // Goals: bottom is seat 0's in field terms; draw both mouths.
    b.ctx.fillStyle = "#111827";
    const mouth = HOCKEY.goal * K;
    b.ctx.fillRect((HOCKEY.w * K - mouth) / 2, 0, mouth, 8);
    b.ctx.fillRect((HOCKEY.w * K - mouth) / 2, HOCKEY.h * K - 8, mouth, 8);
    s.mallets.forEach((m, i) => {
      const p = toScreen(m.x, m.y);
      b.disc(p.x, p.y, HOCKEY.mallet * K, SEAT_COLORS[i]!, "#111", 3);
      b.disc(p.x, p.y, HOCKEY.mallet * K * 0.4, "#fff");
    });
    const pk = toScreen(s.puck.x + s.puck.vx * ahead, s.puck.y + s.puck.vy * ahead);
    b.disc(pk.x, pk.y, HOCKEY.puck * K, "#111827");
    const me = t.you >= 0 ? t.you : 0;
    b.text(`${s.scores[me]}`, 24, (HOCKEY.h * K) / 2 + 30, "700 32px ui-monospace, monospace", SEAT_COLORS[me]!, "left");
    b.text(`${s.scores[1 - me]}`, 24, (HOCKEY.h * K) / 2 - 30, "700 32px ui-monospace, monospace", SEAT_COLORS[1 - me]!, "left");
  });
  return { update: () => (received = performance.now()), destroy: stop };
};

// ------------------------------------------------------------ Light cycles

export const tronRenderer: RendererFactory = (ctx) => {
  const C = 12;
  const b = new Board(ctx.board, TRON.w * C, TRON.h * C);
  const info = el("span", "game-info");
  ctx.controls.append(info);
  const DIRS: Record<string, number> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  const stopKeys = keyListener((code, down) => {
    if (down && code in DIRS && ctx.table().you >= 0) ctx.input({ dir: DIRS[code] });
  });
  function draw(t: GameTableView): void {
    const s = t.view as { grid: string; heads: Array<{ x: number; y: number; alive: boolean }>; wins: number[]; wait: number; roundWinner: number };
    b.clear("#020617");
    b.ctx.strokeStyle = "#0f172a";
    b.ctx.lineWidth = 1;
    for (let x = 0; x <= TRON.w; x++) {
      b.ctx.beginPath();
      b.ctx.moveTo(x * C, 0);
      b.ctx.lineTo(x * C, TRON.h * C);
      b.ctx.stroke();
    }
    for (let y = 0; y <= TRON.h; y++) {
      b.ctx.beginPath();
      b.ctx.moveTo(0, y * C);
      b.ctx.lineTo(TRON.w * C, y * C);
      b.ctx.stroke();
    }
    for (let i = 0; i < s.grid.length; i++) {
      const ch = s.grid[i]!;
      if (ch === ".") continue;
      b.ctx.fillStyle = SEAT_COLORS[Number(ch)]!;
      b.ctx.fillRect((i % TRON.w) * C + 1, Math.floor(i / TRON.w) * C + 1, C - 2, C - 2);
    }
    s.heads.forEach((h, i) => {
      if (h.alive) b.disc(h.x * C + C / 2, h.y * C + C / 2, C * 0.7, "#fff", SEAT_COLORS[i]!, 3);
    });
    if (s.wait > 0 && t.phase === "playing") {
      const text = s.heads.every((h) => h.alive) ? "Get ready…" : s.roundWinner >= 0 ? `${seatName(t, s.roundWinner)} wins the round!` : "Crash! Nobody wins the round";
      b.text(text, (TRON.w * C) / 2, (TRON.h * C) / 2, "800 28px system-ui", "#fff");
    }
    info.textContent = `Steer with WASD / arrows · rounds: ${s.wins.map((w, i) => `${seatName(t, i)} ${w}`).join(" · ")}`;
  }
  return { update: draw, destroy: stopKeys };
};

// ------------------------------------------------------------ Pool & snooker

const POOL_COLORS: Record<number, string> = {
  0: "#ffffff",
  1: "#f1c40f",
  2: "#1d4ed8",
  3: "#e63946",
  4: "#7b2cbf",
  5: "#f97316",
  6: "#15803d",
  7: "#7f1d1d",
  8: "#111111",
};
const SNOOKER_COLORS: Record<number, string> = { 0: "#ffffff", 102: "#facc15", 103: "#15803d", 104: "#7c4a1e", 105: "#1d4ed8", 106: "#f9a8d4", 107: "#111111" };
const SNOOKER_NAMES: Record<number, string> = { 2: "yellow", 3: "green", 4: "brown", 5: "blue", 6: "pink", 7: "black" };

function cueRenderer(table: TableSpec, kind: "pool" | "snooker"): RendererFactory {
  return (ctx) => {
    const scale = 620 / table.w;
    const rail = 26;
    const W = table.w * scale + rail * 2;
    const H = table.h * scale + rail * 2;
    const b = new Board(ctx.board, W, H);
    const info = el("span", "game-info");
    const meter = el("div", "power-meter");
    const fill = el("i");
    meter.append(fill);
    ctx.controls.append(meter, info);
    const sx = (x: number) => rail + x * scale;
    const sy = (y: number) => rail + y * scale;

    let pointer: { x: number; y: number } | null = null;
    let placed: { x: number; y: number } | null = null;
    let charging = 0;
    let chargeStart = 0;
    /** Balls being animated for the latest shot (null once it has finished). */
    let replay: { balls: Ball[]; events: ShotEvents; n: number } | null = null;
    let animatedShot = -1;
    let first = true;

    const view = () => ctx.table().view as { balls: Ball[]; shot: CueShot | null; ballInHand: boolean; note: string; groups?: Array<string | null>; scores?: number[]; on?: string | number };

    function cueSpot(): { x: number; y: number } | null {
      const s = view();
      if (s.ballInHand && myTurn(ctx.table())) return placed;
      const cue = s.balls.find((ball) => ball.id === 0);
      return cue && !cue.potted ? cue : null;
    }

    function drawBall(ball: { id: number; x: number; y: number }): void {
      const r = table.r * scale;
      const x = sx(ball.x);
      const y = sy(ball.y);
      if (kind === "snooker") {
        b.disc(x, y, r, ball.id >= 1 && ball.id <= 6 ? "#c1121f" : SNOOKER_COLORS[ball.id]!, "#000", 1);
        return;
      }
      const base = POOL_COLORS[ball.id > 8 ? ball.id - 8 : ball.id]!;
      if (ball.id > 8) {
        b.disc(x, y, r, "#fff", "#000", 1);
        b.ctx.save();
        b.ctx.beginPath();
        b.ctx.arc(x, y, r, 0, Math.PI * 2);
        b.ctx.clip();
        b.ctx.fillStyle = base;
        b.ctx.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1);
        b.ctx.restore();
      } else b.disc(x, y, r, base, "#000", 1);
      if (ball.id > 0) b.text(String(ball.id), x, y + 0.5, `700 ${Math.round(r * 0.95)}px system-ui`, ball.id === 8 || ball.id > 8 ? "#111" : "#fff");
    }

    const stop = animate((dt) => {
      const t = ctx.table();
      const s = view();
      if (!s) return;
      // Replay a new shot as an animation (but not one that happened before we opened the panel).
      if (s.shot && s.shot.n !== animatedShot) {
        animatedShot = s.shot.n;
        if (!first) {
          const balls = s.shot.balls.map((ball) => ({ ...ball }));
          const cue = balls.find((ball) => ball.id === 0)!;
          cue.vx = s.shot.vx;
          cue.vy = s.shot.vy;
          replay = { balls, events: { firstHit: null, potted: [] }, n: s.shot.n };
        }
      }
      first = false;
      if (replay) {
        let moving = false;
        for (let k = 0; k < Math.round(dt * 240); k++) moving = stepBalls(replay.balls, table, replay.events) || moving;
        if (!moving) replay = null;
      }

      // Table.
      b.clear("#3b2414");
      b.ctx.fillStyle = kind === "pool" ? "#1d4e89" : "#1f7a4a";
      b.ctx.fillRect(rail, rail, table.w * scale, table.h * scale);
      if (kind === "snooker") {
        b.ctx.strokeStyle = "rgba(255,255,255,0.6)";
        b.ctx.lineWidth = 1.5;
        b.ctx.beginPath();
        b.ctx.moveTo(sx(SNOOKER_BAULK), sy(0));
        b.ctx.lineTo(sx(SNOOKER_BAULK), sy(table.h));
        b.ctx.moveTo(sx(SNOOKER_BAULK), sy(table.h / 2 - SNOOKER_D));
        b.ctx.arc(sx(SNOOKER_BAULK), sy(table.h / 2), SNOOKER_D * scale, -Math.PI / 2, Math.PI / 2, true);
        b.ctx.stroke();
      }
      for (const p of table.pockets) b.disc(sx(p.x), sy(Math.min(Math.max(p.y, 0), table.h)), p.r * scale, "#050505");

      const balls = replay ? replay.balls : s.balls;
      for (const ball of balls) if (!ball.potted && !(ball.id === 0 && s.ballInHand && !replay)) drawBall(ball);

      // Aiming: ball in hand first, then the cue line and power.
      const mine = myTurn(t) && !replay;
      const cue = cueSpot();
      if (mine && s.ballInHand && !placed && pointer) drawBall({ id: 0, x: (pointer.x - rail) / scale, y: (pointer.y - rail) / scale });
      if (mine && s.ballInHand && placed) drawBall({ id: 0, ...placed });
      if (mine && cue && pointer && !(s.ballInHand && !placed)) {
        const x = sx(cue.x);
        const y = sy(cue.y);
        const ang = Math.atan2(pointer.y - y, pointer.x - x);
        b.ctx.setLineDash([6, 6]);
        b.ctx.strokeStyle = "rgba(255,255,255,0.7)";
        b.ctx.lineWidth = 2;
        b.ctx.beginPath();
        b.ctx.moveTo(x, y);
        b.ctx.lineTo(x + Math.cos(ang) * 900, y + Math.sin(ang) * 900);
        b.ctx.stroke();
        b.ctx.setLineDash([]);
        // The cue stick, pulled back as you charge.
        const back = 14 + charging * 60;
        b.ctx.strokeStyle = "#d9b38c";
        b.ctx.lineWidth = 6;
        b.ctx.beginPath();
        b.ctx.moveTo(x - Math.cos(ang) * back, y - Math.sin(ang) * back);
        b.ctx.lineTo(x - Math.cos(ang) * (back + 260), y - Math.sin(ang) * (back + 260));
        b.ctx.stroke();
      }
      if (chargeStart) charging = Math.min(1, (performance.now() - chargeStart) / 1400);
      fill.style.width = `${Math.round(charging * 100)}%`;
      meter.hidden = !mine;

      let line: string;
      if (kind === "pool") {
        const g = s.groups ?? [];
        line = t.seats.map((p, i) => `${p.name}${g[i] ? ` (${g[i]})` : ""}`).join(" vs ");
      } else {
        const on = s.on;
        const target = on === "red" ? "a red" : on === "colour" ? "any colour" : `the ${SNOOKER_NAMES[on as number]}`;
        line = `${t.seats.map((p, i) => `${p.name} ${s.scores?.[i] ?? 0}`).join(" · ")} — on ${target}`;
      }
      const help = mine ? (s.ballInHand && !placed ? (kind === "snooker" ? "Click inside the D to place the cue ball" : "Ball in hand: click to place the cue ball") : "Aim with the mouse; hold the button to power up, release to shoot") : "";
      info.textContent = [line, s.note, help].filter(Boolean).join(" · ");
    });

    b.onPointerMove((x, y) => (pointer = { x, y }));
    b.canvas.addEventListener("pointerdown", (e) => {
      const t = ctx.table();
      const s = view();
      if (!myTurn(t) || replay) return;
      const p = b.local(e);
      if (s.ballInHand && !placed) {
        const x = (p.x - rail) / scale;
        const y = (p.y - rail) / scale;
        const okD = kind !== "snooker" || (x <= SNOOKER_BAULK && Math.hypot(x - SNOOKER_BAULK, y - table.h / 2) <= SNOOKER_D);
        if (okD && x > table.r && y > table.r && x < table.w - table.r && y < table.h - table.r) placed = { x, y };
        return;
      }
      chargeStart = performance.now();
      charging = 0;
    });
    const release = () => {
      if (!chargeStart) return;
      const power = Math.max(0.08, charging);
      chargeStart = 0;
      charging = 0;
      const cue = cueSpot();
      if (!cue || !pointer || !myTurn(ctx.table())) return;
      const angle = Math.atan2(pointer.y - sy(cue.y), pointer.x - sx(cue.x));
      ctx.move({ angle, power, ...(view().ballInHand ? { cue: placed } : {}) });
    };
    window.addEventListener("pointerup", release);

    return {
      update: (t: GameTableView) => {
        if (!(t.view as { ballInHand: boolean }).ballInHand) placed = null;
      },
      destroy: () => {
        stop();
        window.removeEventListener("pointerup", release);
      },
    };
  };
}

export const poolRenderer = cueRenderer(POOL_TABLE, "pool");
export const snookerRenderer = cueRenderer(SNOOKER_TABLE, "snooker");
