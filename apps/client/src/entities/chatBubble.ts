import * as THREE from "three";

const SHOW_SECONDS = 6;
const FADE_SECONDS = 0.5;
const MAX_LINES = 3;
const MAX_LINE_PX = 420;
const FONT = "500 30px system-ui, -apple-system, sans-serif";
const LINE_HEIGHT = 38;
const PAD = 18;

/** Speech bubble above a housemate's head showing their latest chat line for a few seconds. */
export class ChatBubble {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private remaining = 0;

  constructor() {
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true }));
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
  }

  show(text: string): void {
    const ctx = this.canvas.getContext("2d")!;
    ctx.font = FONT;
    const lines = wrap(ctx, text);
    const width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + PAD * 2;
    const height = lines.length * LINE_HEIGHT + PAD * 2 - 8;
    this.canvas.width = width;
    this.canvas.height = height + 14; // room for the tail

    // Resizing the canvas resets its context state.
    ctx.font = FONT;
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 18);
    ctx.moveTo(width / 2 - 10, height);
    ctx.lineTo(width / 2, height + 14);
    ctx.lineTo(width / 2 + 10, height);
    ctx.fill();
    ctx.fillStyle = "#1d1b29";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, PAD, PAD - 2 + i * LINE_HEIGHT));

    this.texture.needsUpdate = true;
    const worldHeight = (this.canvas.height / 100) * 0.42;
    this.sprite.scale.set((this.canvas.width / this.canvas.height) * worldHeight, worldHeight, 1);
    this.sprite.center.set(0.5, 0); // anchor at the tail so it grows upward
    this.sprite.material.opacity = 1;
    this.sprite.visible = true;
    this.remaining = SHOW_SECONDS;
  }

  update(dt: number): void {
    if (!this.sprite.visible) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.sprite.visible = false;
    else if (this.remaining < FADE_SECONDS) this.sprite.material.opacity = this.remaining / FADE_SECONDS;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

/** Greedy word wrap to MAX_LINE_PX, at most MAX_LINES lines (the last one ellipsised). */
function wrap(ctx: CanvasRenderingContext2D, text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= MAX_LINE_PX || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  const out = lines.slice(0, MAX_LINES).map((l) => fit(ctx, l, false));
  if (lines.length > MAX_LINES) out[MAX_LINES - 1] = fit(ctx, out[MAX_LINES - 1]!, true);
  return out;
}

/** Truncate a single line (e.g. one very long word) to MAX_LINE_PX, adding "…" if cut or forced. */
function fit(ctx: CanvasRenderingContext2D, line: string, forceEllipsis: boolean): string {
  if (!forceEllipsis && ctx.measureText(line).width <= MAX_LINE_PX) return line;
  let chars = Array.from(line);
  while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > MAX_LINE_PX) chars = chars.slice(0, -1);
  return chars.join("") + "…";
}
