import { EMOTES, EMOTE_INFO, type EmoteName } from "@bbn/shared";

/** The everyday ones sit on the inner ring, closest to the pointer; the rest go round the outside. */
const INNER: readonly EmoteName[] = ["wave", "dance", "clap", "laugh", "thumbsUp", "cheer", "blowKiss", "shrug"];
const OUTER: readonly EmoteName[] = EMOTES.filter((e) => !INNER.includes(e));
/** Ring radii as a fraction of the wheel's size, so the wheel scales on small screens. */
const INNER_R = 0.25;
const OUTER_R = 0.41;
/** Pointer inside this (fraction of size) picks nothing: the "cancel" hole. */
const DEAD_R = 0.12;

/**
 * Emote wheel: hold Q to open two rings of emotes around the middle of the
 * screen, point at one and let go of Q to play it. On touch screens (or with
 * the mouse) the 😀 button opens it and a tap picks. Esc or a tap outside closes.
 */
export class EmoteWheel {
  private readonly el: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly label: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly items = new Map<EmoteName, HTMLButtonElement>();
  private hovered: EmoteName | null = null;
  private open = false;
  private byKey = false;

  constructor(
    parent: HTMLElement,
    private readonly onPick: (emote: EmoteName) => void,
    /** Whether the wheel may open right now (not while typing, playing a game…). */
    private readonly allowed: () => boolean,
  ) {
    this.el = document.createElement("div");
    this.el.className = "emote-wheel";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Emotes");
    const centre = document.createElement("div");
    centre.className = "emote-wheel-centre";
    this.icon = document.createElement("div");
    this.icon.className = "emote-wheel-icon";
    this.label = document.createElement("div");
    this.label.className = "emote-wheel-label";
    centre.append(this.icon, this.label);
    this.el.append(centre);
    for (const [ring, radius] of [[INNER, INNER_R], [OUTER, OUTER_R]] as const) {
      ring.forEach((emote, i) => {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        const b = document.createElement("button");
        b.type = "button";
        b.className = `emote-item ${ring === INNER ? "inner" : "outer"}`;
        b.textContent = EMOTE_INFO[emote].icon;
        b.setAttribute("aria-label", EMOTE_INFO[emote].label);
        b.style.left = `${50 + Math.cos(a) * radius * 100}%`;
        b.style.top = `${50 + Math.sin(a) * radius * 100}%`;
        b.addEventListener("click", () => this.choose(emote));
        this.items.set(emote, b);
        this.el.append(b);
      });
    }
    // Pick by ring (distance) and direction, so a flick towards an emote is enough.
    this.el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = this.el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      const dist = Math.hypot(dx, dy);
      if (dist < DEAD_R) return this.hover(null);
      const ring = dist < (INNER_R + OUTER_R) / 2 ? INNER : OUTER;
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / ring.length)) % ring.length;
      this.hover(ring[i]!);
    });
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.append(this.el);

    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "emote-toggle";
    this.toggle.textContent = "😀";
    this.toggle.title = "Emotes (hold Q)";
    this.toggle.setAttribute("aria-label", "Emotes");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.toggle.addEventListener("click", () => (this.open ? this.hide() : this.allowed() && this.show(false)));
    parent.append(this.toggle);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyQ" && !e.repeat && !this.open && this.allowed()) this.show(true);
      else if (e.code === "Escape" && this.open) this.hide();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code !== "KeyQ" || !this.open || !this.byKey) return;
      if (this.hovered) this.choose(this.hovered);
      else this.hide();
    });
    // A tap anywhere else closes it (the wheel and the button stop their own pointerdowns).
    window.addEventListener("pointerdown", () => {
      if (this.open && !this.byKey) this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  private show(byKey: boolean): void {
    this.open = true;
    this.byKey = byKey;
    this.el.hidden = false;
    this.toggle.setAttribute("aria-expanded", "true");
    this.hover(null);
  }

  private hide(): void {
    this.open = false;
    this.el.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
  }

  private hover(emote: EmoteName | null): void {
    this.hovered = emote;
    this.icon.textContent = emote ? EMOTE_INFO[emote].icon : "";
    this.label.textContent = emote ? EMOTE_INFO[emote].label : this.byKey ? "Point at one, let go of Q" : "Tap an emote";
    for (const [e, b] of this.items) b.classList.toggle("active", e === emote);
  }

  private choose(emote: EmoteName): void {
    this.hide();
    this.onPick(emote);
  }
}
