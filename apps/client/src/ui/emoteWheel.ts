import { EMOTES, EMOTE_INFO, type EmoteName } from "@bbn/shared";

/**
 * Emote wheel: hold Q to open a ring of emotes around the middle of the screen,
 * point at one and let go of Q to play it (or click it). Esc closes without choosing.
 */
export class EmoteWheel {
  private readonly el: HTMLElement;
  private readonly label: HTMLElement;
  private readonly items: HTMLButtonElement[] = [];
  private hovered: EmoteName | null = null;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly onPick: (emote: EmoteName) => void,
    /** Whether the wheel may open right now (not while typing, playing a game…). */
    private readonly allowed: () => boolean,
  ) {
    this.el = document.createElement("div");
    this.el.className = "emote-wheel";
    this.el.hidden = true;
    this.label = document.createElement("div");
    this.label.className = "emote-wheel-label";
    this.el.append(this.label);
    const n = EMOTES.length;
    EMOTES.forEach((emote, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emote-item";
      b.textContent = EMOTE_INFO[emote].icon;
      b.title = EMOTE_INFO[emote].label;
      b.style.left = `calc(50% + ${Math.cos(a) * 150}px)`;
      b.style.top = `calc(50% + ${Math.sin(a) * 150}px)`;
      b.addEventListener("pointerenter", () => this.hover(emote));
      b.addEventListener("click", () => this.choose(emote));
      this.items.push(b);
      this.el.append(b);
    });
    this.el.addEventListener("pointermove", (e) => {
      // Pick by direction from the centre, so a flick towards an emote is enough.
      const r = this.el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < 40) return this.hover(null);
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / n)) % n;
      this.hover(EMOTES[i]!);
    });
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.append(this.el);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyQ" && !e.repeat && !this.open && this.allowed()) this.show();
      else if (e.code === "Escape" && this.open) this.hide();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code !== "KeyQ" || !this.open) return;
      if (this.hovered) this.choose(this.hovered);
      else this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  private show(): void {
    this.open = true;
    this.el.hidden = false;
    this.hover(null);
  }

  private hide(): void {
    this.open = false;
    this.el.hidden = true;
  }

  private hover(emote: EmoteName | null): void {
    this.hovered = emote;
    this.label.textContent = emote ? EMOTE_INFO[emote].label : "Point at an emote, let go of Q";
    EMOTES.forEach((e, i) => this.items[i]!.classList.toggle("active", e === emote));
  }

  private choose(emote: EmoteName): void {
    this.hide();
    this.onPick(emote);
  }
}
