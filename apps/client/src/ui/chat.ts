import { CHAT_MAX_LENGTH, type ChatMessage } from "@bbn/shared";
import { isTyping } from "../input/keyboard.js";

const VISIBLE_LINES = 50;
/** How long a message stays on a live feed before fading (it's still there while typing). */
const LIVE_MS = 12_000;

export interface ChatPanelOptions {
  className?: string;
  placeholder?: string;
  label?: string;
  /** Show messages only, with no input (e.g. house chat as seen by viewers). */
  readOnly?: boolean;
  /**
   * Draw as a live feed over the scene: messages pop in and fade after a few
   * seconds so the view clears itself; focusing the input brings them back.
   */
  live?: boolean;
}

/**
 * Chat panel. Enter opens the input, Enter sends, Esc cancels.
 * While the input has focus, game keys (WASD, E, V…) are ignored because
 * every key handler checks whether the user is typing.
 */
export class ChatPanel {
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly seen = new Set<number>();
  private enabled = true;
  private readonly defaultPlaceholder: string;
  private readonly live: boolean;

  constructor(
    parent: HTMLElement,
    private readonly onSend: (text: string) => void,
    options: ChatPanelOptions = {},
  ) {
    this.el = document.createElement("div");
    this.live = options.live === true;
    this.el.className = `chat ${options.className ?? ""}`;
    this.el.classList.toggle("live", this.live);
    this.el.innerHTML = `
      <ol class="chat-list" aria-live="polite"></ol>
      <form class="chat-form">
        <input class="chat-input" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" enterkeyhint="send" aria-label="Chat message" />
      </form>
    `;
    parent.appendChild(this.el);
    this.list = this.el.querySelector(".chat-list")!;
    this.input = this.el.querySelector(".chat-input")!;
    this.list.setAttribute("aria-label", options.label ?? "House chat");
    // There's no Enter key to hint at on a touch screen.
    this.defaultPlaceholder = options.placeholder ?? (matchMedia("(pointer: coarse)").matches ? "Say something…" : "Press Enter to chat");
    this.input.placeholder = this.defaultPlaceholder;
    if (options.readOnly) {
      this.el.querySelector("form")!.remove();
      return;
    }

    this.el.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.input.value = "";
      this.input.blur();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.input.value = "";
        this.input.blur();
      }
      e.stopPropagation(); // keep game shortcuts from firing while typing
    });
    this.input.addEventListener("focus", () => {
      this.el.classList.add("typing");
      this.list.scrollTop = this.list.scrollHeight;
    });
    this.input.addEventListener("blur", () => this.el.classList.remove("typing"));

    window.addEventListener("keydown", (e) => {
      if (!this.enabled || this.el.hidden || isTyping(e)) return; // typing in some other field
      if (e.key === "Enter" && document.activeElement !== this.input) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  /** Turn the input off (with an explanation in its place) or back on. */
  setEnabled(enabled: boolean, reason?: string): void {
    if (enabled === this.enabled && (enabled || this.input.placeholder === reason)) return;
    this.enabled = enabled;
    this.input.disabled = !enabled;
    this.input.placeholder = enabled ? this.defaultPlaceholder : (reason ?? "");
    if (!enabled) this.input.blur();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  clear(): void {
    this.list.replaceChildren();
    this.seen.clear();
  }

  add(msg: ChatMessage): void {
    if (this.seen.has(msg.id)) return; // history and live messages can overlap
    this.seen.add(msg.id);
    const li = document.createElement("li");
    const name = document.createElement("b");
    name.textContent = msg.name;
    name.style.setProperty("--c", msg.color);
    li.append(name, document.createTextNode(` ${msg.text}`)); // textContent only: never inject HTML
    this.list.appendChild(li);
    if (this.live) setTimeout(() => li.classList.add("faded"), LIVE_MS);
    while (this.list.children.length > VISIBLE_LINES) this.list.firstElementChild!.remove();
    this.list.scrollTop = this.list.scrollHeight;
  }
}
