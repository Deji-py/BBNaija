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
  if (/full|locked/i.test(msg)) return "The house is full right now. Try again later.";
  if (/fetch|network|connect|ECONNREFUSED/i.test(msg)) return "Can't reach the game server. Is it running?";
  return `Couldn't join: ${msg}`;
}

function loadSaved(): Partial<JoinOptions> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<JoinOptions>;
  } catch {
    return {};
  }
}

function save(options: JoinOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage can be unavailable (private mode); remembering the name is just a convenience.
  }
}
