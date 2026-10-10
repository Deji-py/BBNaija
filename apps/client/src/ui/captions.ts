import type { CaptionMessage } from "@bbn/shared";

/** A caption stays up this long, then fades. */
const SHOW_MS = 10_000;
/** At most this many on screen; older ones make way. */
const MAX_SHOWN = 3;
/** Captions from before you joined are only worth showing if they're this fresh. */
const HISTORY_MS = 2 * 60_000;

/**
 * Viewer-only live captions ("Ada nominated Tobi — and was with Tobi in the
 * kitchen 4 minutes ago"). Tapping one points the camera at whoever it's about.
 */
export class CaptionFeed {
  private readonly el: HTMLElement;
  private readonly seen = new Set<number>();

  constructor(
    parent: HTMLElement,
    private readonly onFocus: (housemateIds: string[]) => void,
  ) {
    this.el = document.createElement("section");
    this.el.className = "captions";
    this.el.setAttribute("aria-label", "Live captions");
    this.el.setAttribute("aria-live", "polite");
    parent.append(this.el);
  }

  add(caption: CaptionMessage): void {
    if (this.seen.has(caption.id)) return;
    this.seen.add(caption.id);
    const item = document.createElement(caption.focus.length > 0 ? "button" : "div");
    item.className = "caption";
    if (item instanceof HTMLButtonElement) {
      item.type = "button";
      item.title = "Watch them";
      item.addEventListener("click", () => this.onFocus(caption.focus));
    }
    const icon = document.createElement("span");
    icon.className = "caption-icon";
    icon.textContent = caption.icon;
    const text = document.createElement("span");
    text.className = "caption-text";
    text.textContent = caption.text;
    item.append(icon, text);
    this.el.append(item);
    while (this.el.children.length > MAX_SHOWN) this.el.firstElementChild?.remove();
    setTimeout(() => {
      item.classList.add("faded");
      setTimeout(() => item.remove(), 600);
    }, SHOW_MS);
  }

  /** Recent captions on joining; `serverNow` lines their age up with the server clock. */
  addHistory(captions: CaptionMessage[], serverNow: number): void {
    for (const c of captions) if (serverNow - c.at <= HISTORY_MS) this.add(c);
  }
}
