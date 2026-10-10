/** Minimal HTML overlay: current area, player count, FPS and a controls hint. */
export class Hud {
  private readonly areaEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private lastPrompt = "";
  private promptAction: (() => void) | null = null;
  private frames = 0;
  private elapsed = 0;
  private lastArea = "";

  constructor(parent: HTMLElement) {
    const el = document.createElement("div");
    el.className = "hud";
    el.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-pill hud-area"></div>
        <div class="hud-pill hud-count"></div>
        <div class="hud-pill hud-clock" hidden></div>
      </div>
      <div class="hud-fps"></div>
      <div class="hud-prompt" hidden></div>
      <details class="hud-help">
        <summary aria-label="Show controls">?</summary>
        <div class="hud-help-copy">WASD move · Shift run · Space jump · drag / Z·C camera · E use · Q emotes · Enter chat · V talk · M mute</div>
      </details>
    `;
    parent.appendChild(el);
    this.areaEl = el.querySelector(".hud-area")!;
    this.fpsEl = el.querySelector(".hud-fps")!;
    this.countEl = el.querySelector(".hud-count")!;
    this.promptEl = el.querySelector(".hud-prompt")!;
    this.clockEl = el.querySelector(".hud-clock")!;
    // Tapping (or clicking) the prompt does what E would: the touch-screen "use" button.
    this.promptEl.addEventListener("pointerdown", (e) => {
      if (!this.promptEl.classList.contains("unavailable")) e.stopPropagation();
    });
    this.promptEl.addEventListener("click", () => {
      if (!this.promptEl.classList.contains("unavailable")) this.promptAction?.();
    });
  }

  /** What tapping the prompt does (the same as pressing E). */
  onPromptTap(action: () => void): void {
    this.promptAction = action;
  }

  /** Touch screens: help lists the on-screen controls instead of keys. */
  setTouchHelp(): void {
    const copy = this.promptEl.parentElement?.querySelector(".hud-help-copy");
    if (copy) copy.textContent = "Left stick move (push to the edge to run) · ⤒ jump · drag to look, pinch to zoom · tap the prompt to use · 😀 emotes";
  }

  /** House clock, e.g. "🌙 22:05". */
  setClock(text: string): void {
    if (this.clockEl.textContent === text) return;
    this.clockEl.hidden = false;
    this.clockEl.textContent = text;
  }

  /** "Press E" hint for the nearby object; `available: false` shows it greyed out (e.g. full). */
  setPrompt(text: string | null, available = true): void {
    const key = `${text}|${available}`;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.promptEl.hidden = !text;
    this.promptEl.classList.toggle("unavailable", !available);
    this.promptEl.innerHTML = "";
    if (!text) return;
    if (available) {
      const kbd = document.createElement("kbd");
      kbd.textContent = "E";
      this.promptEl.append(kbd, " ");
    }
    this.promptEl.append(text);
  }

  setPlayerCount(count: number): void {
    this.countEl.textContent = `${count} in the house`;
  }

  setArea(label: string): void {
    if (label === this.lastArea) return;
    this.lastArea = label;
    this.areaEl.textContent = label;
  }

  /** Call once per frame; refreshes the FPS readout twice a second. */
  tick(dt: number): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.elapsed)} fps`;
      this.frames = 0;
      this.elapsed = 0;
    }
  }
}
