import { CHAT_MAX_LENGTH, type ChatMessage } from "@bbn/shared";

const VISIBLE_LINES = 50;

export interface ChatPanelOptions {
  className?: string;
  placeholder?: string;
  label?: string;
  /** Show messages only, with no input (e.g. house chat as seen by viewers). */
  readOnly?: boolean;
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

  constructor(
    parent: HTMLElement,
    private readonly onSend: (text: string) => void,
    options: ChatPanelOptions = {},
  ) {
    this.el = document.createElement("div");
    this.el.className = `chat ${options.className ?? ""}`;
    this.el.innerHTML = `
      <ol class="chat-list" aria-live="polite"></ol>
      <form class="chat-form">
        <input class="chat-input" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" aria-label="Chat message" />
      </form>
    `;
    parent.appendChild(this.el);
    this.list = this.el.querySelector(".chat-list")!;
    this.input = this.el.querySelector(".chat-input")!;
    this.list.setAttribute("aria-label", options.label ?? "House chat");
    this.input.placeholder = options.placeholder ?? "Press Enter to chat";
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
    this.input.addEventListener("focus", () => this.el.classList.add("typing"));
    this.input.addEventListener("blur", () => this.el.classList.remove("typing"));

    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && document.activeElement !== this.input) {
        e.preventDefault();
        this.input.focus();
      }
    });
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
    while (this.list.children.length > VISIBLE_LINES) this.list.firstElementChild!.remove();
    this.list.scrollTop = this.list.scrollHeight;
  }
}
