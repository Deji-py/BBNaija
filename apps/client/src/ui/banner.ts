const ANNOUNCEMENT_SECONDS = 8;

/**
 * Big Brother's announcement banner (top centre), plus small persistent status
 * strips such as "You're in the Diary Room" or "Big Brother has muted you".
 */
export class Banners {
  private readonly el: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly statuses: HTMLElement;
  private readonly statusEls = new Map<string, HTMLElement>();
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "banners";
    this.el.innerHTML = `
      <div class="announcement" role="status" aria-live="assertive" hidden>
        <div class="announcement-title">Big Brother</div>
        <div class="announcement-text"></div>
      </div>
      <div class="statuses"></div>
    `;
    parent.appendChild(this.el);
    this.announcement = this.el.querySelector(".announcement")!;
    this.statuses = this.el.querySelector(".statuses")!;
  }

  announce(text: string): void {
    this.announcement.querySelector(".announcement-text")!.textContent = text;
    this.announcement.hidden = false;
    this.announcement.classList.remove("show");
    void this.announcement.offsetWidth; // restart the entrance animation
    this.announcement.classList.add("show");
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => (this.announcement.hidden = true), ANNOUNCEMENT_SECONDS * 1000);
  }

  /** Show (text) or remove (null) a persistent status strip identified by `key`. */
  setStatus(key: string, text: string | null, tone: "info" | "warn" | "live" = "info"): void {
    let el = this.statusEls.get(key);
    if (!text) {
      el?.remove();
      this.statusEls.delete(key);
      return;
    }
    if (!el) {
      el = document.createElement("div");
      this.statusEls.set(key, el);
      this.statuses.appendChild(el);
    }
    el.className = `status status-${tone}`;
    if (el.textContent !== text) el.textContent = text;
  }
}
