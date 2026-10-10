import { HOUSE_CAMERAS, REACTIONS, housemateStatus, type AreaId, type PlayerView, type Reaction } from "@bbn/shared";
import type { CameraMode } from "../scene/spectatorCamera.js";

/** One-line status for the housemate list, e.g. "Sleeping" or "Awake · Kitchen". */
export function statusOf(p: PlayerView): string {
  return housemateStatus(p);
}

/**
 * Spectator overlay: live badge + viewer count, current camera, the housemate
 * list (click to follow), camera buttons, reactions and audio status.
 */
export class SpectatorHud {
  private readonly countEl: HTMLElement;
  private readonly camLabelEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly camButtons = new Map<string, HTMLButtonElement>();
  private readonly audioEl: HTMLElement;
  private readonly floatLayer: HTMLElement;
  /** Right-hand column; the viewer chat panel is placed at its bottom. */
  readonly rightColumn: HTMLElement;
  private lastListKey = "";

  constructor(
    parent: HTMLElement,
    private readonly handlers: {
      onCamera: (mode: CameraMode) => void;
      onReact: (emoji: Reaction) => void;
      /** Hand the camera to the auto director. Without it there's no Auto button. */
      onAuto?: () => void;
    },
    /** The Big Brother console hides the viewer-only parts (it has its own housemate list). */
    options: { housemates?: boolean; reactions?: boolean } = {},
  ) {
    const el = document.createElement("div");
    el.className = "spectator-hud";
    el.innerHTML = `
      <div class="spec-top">
        <a class="hud-pill back-link" href="/" title="Browse other live houses">← All houses</a>
        <span class="live-badge">LIVE</span>
        <span class="hud-pill spec-count"></span>
        <span class="hud-pill spec-cam"></span>
        <button type="button" class="spec-drawer-toggle" aria-expanded="false" aria-controls="spectator-details">People & chat</button>
      </div>
      <div class="spec-right" id="spectator-details">
        <aside class="spec-housemates" aria-label="Housemates">
          <h2>Housemates</h2>
          <ul></ul>
        </aside>
        <div class="spec-floats" aria-hidden="true"></div>
        <div class="spec-react" aria-label="Reactions"></div>
      </div>
      <nav class="spec-cams" aria-label="Cameras"></nav>
      <div class="spec-audio hud-pill"></div>
    `;
    parent.appendChild(el);
    this.countEl = el.querySelector(".spec-count")!;
    this.camLabelEl = el.querySelector(".spec-cam")!;
    this.listEl = el.querySelector(".spec-housemates ul")!;
    this.audioEl = el.querySelector(".spec-audio")!;
    this.floatLayer = el.querySelector(".spec-floats")!;
    this.rightColumn = el.querySelector(".spec-right")!;
    const drawerToggle = el.querySelector<HTMLButtonElement>(".spec-drawer-toggle")!;
    drawerToggle.addEventListener("click", () => {
      const open = this.rightColumn.classList.toggle("open");
      drawerToggle.setAttribute("aria-expanded", String(open));
      drawerToggle.textContent = open ? "Close panel" : "People & chat";
    });
    if (options.housemates === false) el.querySelector<HTMLElement>(".spec-housemates")!.hidden = true;
    if (options.reactions === false) el.querySelector<HTMLElement>(".spec-react")!.hidden = true;

    const cams = el.querySelector(".spec-cams")!;
    if (handlers.onAuto) {
      const auto = this.camButton("🎬 Auto", "", handlers.onAuto);
      auto.title = "Let the camera follow the action";
      auto.classList.add("auto-cam");
      this.camButtons.set("auto", auto);
      cams.appendChild(auto);
    }
    HOUSE_CAMERAS.forEach((cam, i) => {
      const b = this.camButton(`${cam.label}`, `${i + 1}`, () => handlers.onCamera({ kind: "house", area: cam.id }));
      this.camButtons.set(`house:${cam.id}`, b);
      cams.appendChild(b);
    });
    const free = this.camButton("Free cam", "0", () => handlers.onCamera({ kind: "free" }));
    this.camButtons.set("free", free);
    cams.appendChild(free);

    const react = el.querySelector(".spec-react")!;
    for (const emoji of REACTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = emoji;
      b.setAttribute("aria-label", `React ${emoji}`);
      b.addEventListener("click", () => handlers.onReact(emoji));
      react.appendChild(b);
    }

    this.listEl.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-id]");
      if (li) handlers.onCamera({ kind: "follow", playerId: li.dataset.id! });
    });
  }

  setViewerCount(n: number): void {
    this.countEl.textContent = `${n} watching`;
  }

  setAudioStatus(text: string, ok: boolean): void {
    this.audioEl.textContent = text;
    this.audioEl.classList.toggle("off", !ok);
  }

  /** Highlight the active camera and show its name. In auto, only the Auto button lights up. */
  setCamera(mode: CameraMode, followedName?: string, auto = false): void {
    for (const [key, b] of this.camButtons) {
      const active = auto
        ? key === "auto"
        : (mode.kind === "house" && key === `house:${mode.area}`) || (mode.kind === "free" && key === "free");
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    }
    const label =
      mode.kind === "house"
        ? `📷 ${HOUSE_CAMERAS.find((c) => c.id === mode.area)?.label ?? ""} cam`
        : mode.kind === "follow"
          ? `🎥 Following ${followedName ?? ""}`
          : "🕊️ Free cam · WASD fly · drag look · Q/E down/up";
    this.camLabelEl.textContent = auto ? `🎬 Auto · ${label.replace(/^\S+ /, "")}` : label;
  }

  /** Re-render the housemate list (cheap no-op when nothing changed). */
  setHousemates(players: Array<[string, PlayerView]>, followingId: string | null): void {
    const rows = players.map(([id, p]) => ({ id, p, status: statusOf(p) }));
    const key = JSON.stringify(rows.map((r) => [r.id, r.p.name, r.status, r.p.speaking, r.p.muted, r.id === followingId]));
    if (key === this.lastListKey) return;
    this.lastListKey = key;

    this.listEl.replaceChildren(
      ...rows.map(({ id, p, status }) => {
        const li = document.createElement("li");
        li.dataset.id = id;
        li.tabIndex = 0;
        li.title = `Follow ${p.name}`;
        li.classList.toggle("following", id === followingId);
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = p.color;
        const text = document.createElement("span");
        text.className = "who";
        const name = document.createElement("b");
        name.textContent = p.name;
        const st = document.createElement("small");
        st.textContent = status;
        text.append(name, st);
        const mic = document.createElement("span");
        mic.className = "mic";
        mic.textContent = p.speaking ? "🎙️" : p.muted && p.voice ? "🔇" : "";
        li.append(dot, text, mic);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") this.handlers.onCamera({ kind: "follow", playerId: id });
        });
        return li;
      }),
    );
    if (rows.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nobody's in the house yet.";
      this.listEl.appendChild(li);
    }
  }

  /** An emoji drifting up over the scene. */
  floatReaction(emoji: string): void {
    const span = document.createElement("span");
    span.className = "float-emoji";
    span.textContent = emoji;
    span.style.left = `${Math.random() * 70}%`;
    span.style.setProperty("--drift", `${(Math.random() - 0.5) * 60}px`);
    span.addEventListener("animationend", () => span.remove());
    // Cap how many are on screen so a reaction storm can't slow the page down.
    if (this.floatLayer.childElementCount > 40) this.floatLayer.firstElementChild?.remove();
    this.floatLayer.appendChild(span);
  }

  private camButton(label: string, key: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = key ? `<kbd></kbd> <span></span>` : `<span></span>`;
    if (key) b.querySelector("kbd")!.textContent = key;
    b.querySelector("span")!.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
}

export function areaForKey(key: string): AreaId | "free" | null {
  if (key === "0") return "free";
  const i = Number(key) - 1;
  return HOUSE_CAMERAS[i]?.id ?? null;
}
