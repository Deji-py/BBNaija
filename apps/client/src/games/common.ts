import type { GameTableView } from "@bbn/shared";

/**
 * Shared bits for the 2D game boards shown in the game panel: what a renderer
 * gets, a crisp scalable canvas, and small DOM helpers.
 */

export interface RenderCtx {
  /** Where the board goes. */
  board: HTMLElement;
  /** Row under the board for buttons and scores. */
  controls: HTMLElement;
  /** Send a move for your seat. */
  move(move: unknown): void;
  /** Send real-time control input (paddles, mallets, bikes). */
  input(input: unknown): void;
  /** The latest table (always current, even between updates). */
  table(): GameTableView;
}

export interface GameRenderer {
  update(table: GameTableView): void;
  destroy(): void;
}

export type RendererFactory = (ctx: RenderCtx) => GameRenderer;

/** Colours for seats 0–3 where a game doesn't have its own (red, blue, yellow, green). */
export const SEAT_COLORS = ["#e63946", "#3b82f6", "#f1c40f", "#22c55e"];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** True when it's your move. */
export function myTurn(t: GameTableView): boolean {
  return t.phase === "playing" && t.you >= 0 && t.turn.includes(t.you);
}

export function seatName(t: GameTableView, seat: number): string {
  return t.seats[seat]?.name ?? `Player ${seat + 1}`;
}

/**
 * A canvas drawn in fixed logical units (w × h) that scales to fit the panel
 * and stays sharp on high-DPI screens. Pointer positions come back in logical units.
 */
export class Board {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    parent: HTMLElement,
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = el("canvas", "game-canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Fit the width, but never taller than most of the screen.
    this.canvas.style.maxWidth = `min(100%, calc(58vh * ${w / h}))`;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);
    parent.append(this.canvas);
  }

  /** Pointer position in logical units. */
  local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.w, y: ((e.clientY - r.top) / r.height) * this.h };
  }

  onClick(cb: (x: number, y: number) => void): void {
    this.canvas.addEventListener("click", (e) => {
      const p = this.local(e);
      cb(p.x, p.y);
    });
  }

  onPointerMove(cb: (x: number, y: number) => void): void {
    this.canvas.addEventListener("pointermove", (e) => {
      const p = this.local(e);
      cb(p.x, p.y);
    });
  }

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  disc(x: number, y: number, r: number, fill: string, stroke?: string, lineWidth = 2): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.stroke();
    }
  }

  text(s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "center"): void {
    const c = this.ctx;
    c.font = font;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(s, x, y);
  }

  /** Light highlight ring, e.g. for the last move or a legal target. */
  ring(x: number, y: number, r: number, color: string, lineWidth = 3): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.stroke();
  }
}

/** Calls `cb` every animation frame until the returned function is called. */
export function animate(cb: (dt: number) => void): () => void {
  let last = performance.now();
  let id = requestAnimationFrame(function frame(now) {
    cb(Math.min(0.1, (now - last) / 1000));
    last = now;
    id = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(id);
}

/** Holds a set of keys while a real-time game is open; removed on destroy. */
export function keyListener(onKey: (code: string, down: boolean) => void): () => void {
  const down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    onKey(e.code, true);
  };
  const up = (e: KeyboardEvent) => onKey(e.code, false);
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  };
}
