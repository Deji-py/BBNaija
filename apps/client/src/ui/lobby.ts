import { AVATAR_COLORS, NAME_MAX_LENGTH, type JoinOptions } from "@bbn/shared";

const STORAGE_KEY = "bbn:lobby";

/**
 * Name + colour picker shown before entering the house.
 * `onSubmit` should resolve when joined, or throw to show an error and let the user retry.
 */
export function showLobby(parent: HTMLElement, onSubmit: (options: JoinOptions) => Promise<void>): void {
  const saved = loadSaved();
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <form class="card lobby">
      <h1>Big Brother Ninja</h1>
      <p class="muted">Pick a name and colour, then enter the house.</p>
      <label class="field">
        <span>Name</span>
        <input name="name" required maxlength="${NAME_MAX_LENGTH}" autocomplete="nickname" placeholder="Your housemate name" />
      </label>
      <fieldset class="field">
        <legend>Colour</legend>
        <div class="swatches">
          ${AVATAR_COLORS.map(
            (c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" aria-label="${c}" /></label>`,
          ).join("")}
        </div>
      </fieldset>
      <button type="submit">Enter the house</button>
      <p class="error" role="alert"></p>
      <p class="switch-link">Just here to watch? <a href="/watch">Watch live →</a></p>
    </form>
  `;
  parent.appendChild(el);

  const form = el.querySelector("form")!;
  const nameInput = form.elements.namedItem("name") as HTMLInputElement;
  const button = form.querySelector("button")!;
  const errorEl = form.querySelector<HTMLElement>(".error")!;

  nameInput.value = saved.name ?? "";
  const initialColor = AVATAR_COLORS.includes(saved.color as (typeof AVATAR_COLORS)[number])
    ? saved.color!
    : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
  form.querySelector<HTMLInputElement>(`input[value="${initialColor}"]`)!.checked = true;
  nameInput.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const options: JoinOptions = {
      name: nameInput.value.trim(),
      color: (form.elements.namedItem("color") as RadioNodeList).value,
    };
    if (!options.name) return;
    save(options);
    button.disabled = true;
    button.textContent = "Entering…";
    errorEl.textContent = "";
    try {
      await onSubmit(options);
      el.remove();
    } catch (err) {
      errorEl.textContent = describeError(err);
      button.disabled = false;
      button.textContent = "Enter the house";
    }
  });
}

/**
 * Start screen for spectators. Clicking "Start watching" is also the user
 * gesture browsers require before a page may play audio.
 */
export function showWatchStart(parent: HTMLElement, onStart: (name: string) => Promise<void>): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <form class="card lobby">
      <h1>Watch live</h1>
      <p class="muted">See and hear the house in real time. Housemates can't see you or your chat.</p>
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

/** Sign-in for the Big Brother console. The secret is checked by the server. */
export function showAdminLogin(parent: HTMLElement, onSubmit: (secret: string) => Promise<void>): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <form class="card lobby">
      <h1>Big Brother console</h1>
      <p class="muted">Production team only.</p>
      <label class="field">
        <span>Admin secret</span>
        <input name="secret" type="password" required autocomplete="current-password" />
      </label>
      <button type="submit">Open console</button>
      <p class="error" role="alert"></p>
    </form>
  `;
  parent.appendChild(el);
  const form = el.querySelector("form")!;
  const input = form.elements.namedItem("secret") as HTMLInputElement;
  const button = form.querySelector("button")!;
  const errorEl = form.querySelector<HTMLElement>(".error")!;
  input.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    button.textContent = "Opening…";
    errorEl.textContent = "";
    try {
      await onSubmit(input.value);
      el.remove();
    } catch (err) {
      errorEl.textContent = describeError(err);
      input.select();
      button.disabled = false;
      button.textContent = "Open console";
    }
  });
}

/** Full-screen message with a button that reloads the page. */
export function showDisconnected(parent: HTMLElement, message: string): void {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `
    <div class="card">
      <h2>Disconnected</h2>
      <p class="muted"></p>
      <button type="button">Rejoin</button>
    </div>
  `;
  el.querySelector("p")!.textContent = message;
  el.querySelector("button")!.addEventListener("click", () => location.reload());
  parent.appendChild(el);
}

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/wrong admin secret/i.test(msg)) return "That secret isn't right.";
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

function save(options: JoinOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), ...options }));
  } catch {
    // Storage can be unavailable (private mode); remembering the name is just a convenience.
  }
}
