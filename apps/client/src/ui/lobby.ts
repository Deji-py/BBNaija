import { NAME_MAX_LENGTH, type JoinOptions } from "@bbn/shared";
import { getSessionToken } from "../net/api.js";
import { CharacterCreator } from "./creator.js";

const STORAGE_KEY = "bbn:lobby";

/** What the lobby lets you choose; the caller adds which house and how you're signed in. */
export type LobbyChoice = Pick<JoinOptions, "name" | "color" | "look">;

/** Lets the join step show a hint (with an optional action) under the button while it waits. */
export interface LobbyStatus {
  hint(text: string, actionLabel?: string, onAction?: () => void): void;
}

/**
 * Character creator shown before entering the house. Your name comes from your
 * application (the server uses it, whatever the client sends).
 * `onSubmit` should resolve when joined, or throw to show an error and let the user retry.
 */
export function showLobby(
  parent: HTMLElement,
  displayName: string,
  onSubmit: (options: LobbyChoice, status: LobbyStatus) => Promise<void>,
): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <form class="card lobby creator-card">
      <h1>Create your housemate</h1>
      <p class="muted">You're entering as <b class="entering-as"></b>. Pick a body, then style your hair, clothes and accessories.</p>
      <div class="creator-slot"></div>
      <button type="submit" class="enter-button">Enter the house</button>
      <p class="lobby-hint" role="status"></p>
      <p class="error" role="alert"></p>
      <p class="switch-link"><a href="/">← Back</a> · <a href="/watch">Watch instead</a></p>
    </form>
  `;
  el.querySelector(".entering-as")!.textContent = displayName;
  const creator = new CharacterCreator();
  el.querySelector(".creator-slot")!.replaceWith(creator.el);
  parent.appendChild(el);

  const form = el.querySelector("form")!;
  const button = form.querySelector<HTMLButtonElement>(".enter-button")!;
  const errorEl = form.querySelector<HTMLElement>(".error")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const options: LobbyChoice = { name: displayName, color: creator.color, look: creator.value };
    save(options);
    button.disabled = true;
    button.textContent = "Entering…";
    errorEl.textContent = "";
    const hintEl = form.querySelector<HTMLElement>(".lobby-hint")!;
    const status: LobbyStatus = {
      hint(text, actionLabel, onAction) {
        hintEl.replaceChildren(document.createTextNode(text));
        if (actionLabel && onAction) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "link-button";
          b.textContent = actionLabel;
          b.addEventListener("click", onAction, { once: true });
          hintEl.append(" ", b);
        }
      },
    };
    try {
      await onSubmit(options, status);
      creator.destroy();
      el.remove();
    } catch (err) {
      errorEl.textContent = describeError(err);
      hintEl.textContent = "";
      button.disabled = false;
      button.textContent = "Enter the house";
    }
  });
}

/**
 * Start screen for spectators. Clicking "Start watching" is also the user
 * gesture browsers require before a page may play audio.
 */
export function showWatchStart(parent: HTMLElement, onStart: (name: string) => Promise<void>, note?: string): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <form class="card lobby">
      <h1>Watch live</h1>
      <p class="muted">See and hear the house in real time. Housemates can't see you or your chat.</p>
      <p class="vote-note"></p>
      <label class="field">
        <span>Your name in viewer chat (optional)</span>
        <input name="name" maxlength="${NAME_MAX_LENGTH}" autocomplete="nickname" placeholder="Viewer" />
      </label>
      <button type="submit">Start watching</button>
      <p class="error" role="alert"></p>
      <p class="switch-link">Selected as a housemate? <a href="/">Enter the house →</a></p>
    </form>
  `;
  parent.appendChild(el);
  const voteNote = el.querySelector<HTMLElement>(".vote-note")!;
  if (note) {
    voteNote.className = "muted";
    voteNote.textContent = note;
  } else if (getSessionToken()) {
    voteNote.className = "muted";
    voteNote.textContent = "You're signed in, so you can vote when a voting window opens.";
  } else {
    voteNote.className = "muted";
    const link = document.createElement("a");
    link.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
    link.textContent = "Sign in";
    voteNote.append(link, document.createTextNode(" before you start watching if you want to vote. A vote is tied to your account."));
  }
  const form = el.querySelector("form")!;
  const nameInput = form.elements.namedItem("name") as HTMLInputElement;
  const button = form.querySelector("button")!;
  const errorEl = form.querySelector<HTMLElement>(".error")!;
  nameInput.value = loadSaved().viewerName ?? "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), viewerName: name }));
    } catch {
      // Remembering the name is just a convenience.
    }
    button.disabled = true;
    button.textContent = "Connecting…";
    errorEl.textContent = "";
    try {
      await onStart(name);
      el.remove();
    } catch (err) {
      errorEl.textContent = describeError(err);
      button.disabled = false;
      button.textContent = "Start watching";
    }
  });
}

/** Full-screen message with a button that reloads the page, or follows `action`. */
export function showDisconnected(
  parent: HTMLElement,
  message: string,
  options?: { title?: string; action?: { label: string; href: string } },
): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <div class="card">
      <h2></h2>
      <p class="muted"></p>
      <button type="button"></button>
    </div>
  `;
  el.querySelector("h2")!.textContent = options?.title ?? "Disconnected";
  el.querySelector("p")!.textContent = message;
  const button = el.querySelector("button")!;
  const action = options?.action;
  button.textContent = action?.label ?? "Rejoin";
  button.addEventListener("click", () => {
    if (action) location.href = action.href;
    else location.reload();
  });
  parent.appendChild(el);
}

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/wrong admin secret/i.test(msg)) return "That secret isn't right.";
  if (/sign in|selected housemates/i.test(msg)) return msg;
  if (/full|locked/i.test(msg)) return "The house is full right now. Try again later.";
  if (/fetch|network|connect|ECONNREFUSED/i.test(msg)) return "Can't reach the game server. Is it running?";
  return `Couldn't join: ${msg}`;
}

function loadSaved(): Partial<JoinOptions> & { viewerName?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<JoinOptions> & { viewerName?: string };
  } catch {
    return {};
  }
}

function save(options: LobbyChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), ...options }));
  } catch {
    // Storage can be unavailable (private mode); remembering the name is just a convenience.
  }
}
