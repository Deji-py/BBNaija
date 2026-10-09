/** Minimal HTML overlay: current area, player count, FPS and a controls hint. */
export class Hud {
  private readonly areaEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private lastPrompt = "";
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
      </div>
      <div class="hud-fps"></div>
      <div class="hud-prompt" hidden></div>
      <div class="hud-help">WASD move · drag / Z·C camera · E use · 1 wave · 2 dance · Enter chat · V talk · M mute</div>
    `;
    parent.appendChild(el);
    this.areaEl = el.querySelector(".hud-area")!;
    this.fpsEl = el.querySelector(".hud-fps")!;
    this.countEl = el.querySelector(".hud-count")!;
    this.promptEl = el.querySelector(".hud-prompt")!;
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
