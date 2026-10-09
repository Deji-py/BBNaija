import { isTyping } from "../input/keyboard.js";

const STORAGE_KEY = "bbn:voice";

export type MicMode = "open" | "ptt";

interface Saved {
  mode: MicMode;
  muted: boolean;
}

/**
 * Bottom-right voice controls: mute toggle (M) and open-mic / push-to-talk (V) mode.
 *
 * Event-driven rather than polled from the render loop: the render loop pauses
 * in background tabs, and releasing V (or leaving the tab) must stop
 * transmitting immediately regardless.
 */
export class VoiceControls {
  mode: MicMode;
  muted: boolean;
  private pttHeld = false;
  private transmitting = false;
  /** Set when Big Brother has muted us (overrides everything; we can't unmute ourselves). */
  private forcedMute: string | null = null;
  private changeCb: ((transmitting: boolean) => void) | null = null;
  private readonly el: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;

  constructor(parent: HTMLElement, private readonly hasMic: boolean, noMicReason?: string) {
    const saved = load();
    this.mode = saved.mode;
    this.muted = saved.muted;

    this.el = document.createElement("div");
    this.el.className = "voice-controls";
    this.el.innerHTML = `
      <div class="voice-status"></div>
      <div class="voice-buttons">
        <button type="button" class="voice-mute"></button>
        <button type="button" class="voice-mode"></button>
      </div>
    `;
    parent.appendChild(this.el);
    this.muteBtn = this.el.querySelector(".voice-mute")!;
    this.modeBtn = this.el.querySelector(".voice-mode")!;
    this.statusEl = this.el.querySelector(".voice-status")!;

    if (!hasMic) {
      this.el.classList.add("no-mic");
      this.statusEl.textContent = noMicReason ?? "No microphone — listening only.";
      this.muteBtn.hidden = true;
      this.modeBtn.hidden = true;
      return;
    }

    this.muteBtn.addEventListener("click", () => this.toggleMute());
    this.modeBtn.addEventListener("click", () => this.toggleMode());
    window.addEventListener("keydown", (e) => {
      if (e.repeat || isTyping(e)) return;
      if (e.code === "KeyM") this.toggleMute();
      if (e.code === "KeyV") this.setPtt(true);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyV") this.setPtt(false);
    });
    // A key released while the window is unfocused never fires keyup.
    window.addEventListener("blur", () => this.setPtt(false));
    this.update();
  }

  /** Called with the new value whenever transmitting starts or stops (and once immediately). */
  onTransmitChange(cb: (transmitting: boolean) => void): void {
    this.changeCb = cb;
    cb(this.transmitting);
  }

  /** Whether our voice is being sent right now. */
  isTransmitting(): boolean {
    return this.transmitting;
  }

  setForcedMute(reason: string | null): void {
    if (reason === this.forcedMute) return;
    this.forcedMute = reason;
    this.update();
  }

  private setPtt(held: boolean): void {
    if (held === this.pttHeld) return;
    this.pttHeld = held;
    this.update();
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.persist();
    this.update();
  }

  private toggleMode(): void {
    this.mode = this.mode === "open" ? "ptt" : "open";
    this.persist();
    this.update();
  }

  private update(): void {
    const transmitting = this.hasMic && !this.muted && !this.forcedMute && (this.mode === "open" || this.pttHeld);
    if (transmitting !== this.transmitting) {
      this.transmitting = transmitting;
      this.changeCb?.(transmitting);
    }
    if (!this.hasMic) return;
    this.el.classList.toggle("live", transmitting);
    this.el.classList.toggle("forced", !!this.forcedMute);
    this.statusEl.textContent = this.forcedMute
      ? this.forcedMute
      : this.muted
      ? "Muted · M to unmute"
      : this.mode === "ptt"
        ? transmitting
          ? "Talking…"
          : "Hold V to talk"
        : "Mic on";
    this.muteBtn.textContent = this.muted ? "Unmute (M)" : "Mute (M)";
    this.muteBtn.classList.toggle("active", this.muted);
    this.modeBtn.textContent = this.mode === "open" ? "Open mic" : "Push-to-talk";
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: this.mode, muted: this.muted } satisfies Saved));
    } catch {
      // Storage unavailable; the choice just won't be remembered.
    }
  }
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Saved>;
    return { mode: raw.mode === "ptt" ? "ptt" : "open", muted: raw.muted === true };
  } catch {
    return { mode: "open", muted: false };
  }
}
