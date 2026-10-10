import { AREAS, FURNITURE, WALLS, type AreaId, type HouseCard, type PublicSeason } from "@bbn/shared";

/** Floor colours per room, as in the 3D house (scene/house.ts), for the mini-map. */
const FLOOR: Record<AreaId, string> = {
  lounge: "#c9a27a",
  kitchen: "#dcd6c8",
  bedroom: "#8f7aa8",
  gym: "#55606e",
  diary: "#6b1f2a",
  garden: "#6aa84f",
  games: "#2b2d42",
  bathroom: "#dfe7ea",
  party: "#14121c",
};

// World bounds of the house (x: -15..33 with the games hall, z: -10..26) with a small margin.
const BOUNDS = { minX: -32, maxX: 34, minZ: -17, maxZ: 27 };

/**
 * Top-down mini-map of a house: rooms, walls, the pool, and housemates as
 * coloured dots. Cheap to draw, so every card can show a "live" picture of
 * what's going on without streaming any video.
 */
function drawMiniMap(canvas: HTMLCanvasElement, card: HouseCard, time: number): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#3b6b30";
  ctx.fillRect(0, 0, w, h);

  // Rotate the house so its long side (z) runs left→right on the 16:9 card.
  const spanX = BOUNDS.maxZ - BOUNDS.minZ;
  const spanY = BOUNDS.maxX - BOUNDS.minX;
  const scale = Math.min(w / spanX, h / spanY);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  const px = (x: number, z: number): [number, number] => [ox + (z - BOUNDS.minZ) * scale, oy + (BOUNDS.maxX - x) * scale];
  const rect = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const [x1, y1] = px(maxX, minZ);
    const [x2, y2] = px(minX, maxZ);
    return [x1, y1, x2 - x1, y2 - y1] as const;
  };

  for (const a of AREAS) {
    ctx.fillStyle = FLOOR[a.id];
    ctx.fillRect(...rect(a.minX, a.maxX, a.minZ, a.maxZ));
  }
  const pool = FURNITURE.find((f) => f.id === "pool");
  if (pool) {
    ctx.fillStyle = "#3fb4e0";
    ctx.fillRect(...rect(pool.x - pool.w / 2, pool.x + pool.w / 2, pool.z - pool.d / 2, pool.z + pool.d / 2));
  }
  for (const wall of WALLS) {
    ctx.fillStyle = wall.kind === "wall" ? "#f3eee2" : "#8b6a46";
    ctx.fillRect(...rect(wall.minX, wall.maxX, wall.minZ, wall.maxZ));
  }

  const r = Math.max(4, scale * 0.7);
  for (const hm of card.housemates) {
    const [x, y] = px(hm.x, hm.z);
    if (hm.speaking) {
      ctx.beginPath();
      ctx.arc(x, y, r * (1.8 + Math.sin(time / 150) * 0.3), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(47, 191, 113, 0.45)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hm.color;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.3);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

/**
 * Home-page grid of live houses, Twitch-style. Each card: a live mini-map,
 * LIVE badge and viewer count, the season and host, and the housemates with
 * what they're doing. Hovering (or focusing) shows "Watch now".
 */
export class HouseGrid {
  private readonly el: HTMLElement;
  private readonly empty: HTMLElement;
  /** One card per live house, kept across refreshes so hover and keyboard focus survive. */
  private readonly cards = new Map<string, { el: HTMLAnchorElement; canvas: HTMLCanvasElement; data: HouseCard; update(c: HouseCard): void }>();
  private raf = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "house-grid";
    this.empty = document.createElement("p");
    this.empty.className = "grid-empty";
    this.empty.textContent = "No houses are live right now. Check back soon — or apply to be in the next one!";
    parent.append(this.el);
    const tick = (t: number) => {
      for (const c of this.cards.values()) drawMiniMap(c.canvas, c.data, t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Update to the latest houses: existing cards are updated in place, new ones added, ended ones removed. */
  set(houses: HouseCard[]): void {
    const live = new Set(houses.map((h) => h.seasonId));
    for (const [id, card] of this.cards) {
      if (live.has(id)) continue;
      card.el.remove();
      this.cards.delete(id);
    }
    const ordered = houses.map((h) => {
      let card = this.cards.get(h.seasonId);
      if (!card) {
        card = createCard(h);
        this.cards.set(h.seasonId, card);
      }
      card.update(h);
      return card.el;
    });
    // Re-order only if the ranking changed (moving nodes would interrupt hover/focus needlessly).
    const current = [...this.el.children].filter((c) => c !== this.empty);
    if (ordered.length !== current.length || ordered.some((el, i) => current[i] !== el)) this.el.append(...ordered);
    if (houses.length) this.empty.remove();
    else this.el.append(this.empty);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}

/** Builds one house card; `update` refreshes its text without replacing the element. */
function createCard(initial: HouseCard) {
  const a = document.createElement("a");
  a.className = "house-card";
  a.href = `/watch/${encodeURIComponent(initial.seasonId)}`;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 270;
  const live = document.createElement("span");
  live.className = "thumb-live";
  const viewers = document.createElement("span");
  viewers.className = "thumb-viewers";
  const tags = document.createElement("div");
  tags.className = "thumb-tags";
  const watch = document.createElement("span");
  watch.className = "watch-now";
  watch.textContent = "▶ Watch now";
  thumb.append(canvas, live, viewers, tags, watch);

  const info = document.createElement("div");
  info.className = "card-info";
  const title = document.createElement("h3");
  const host = document.createElement("p");
  host.className = "card-host";
  const list = document.createElement("ul");
  list.className = "card-housemates";
  info.append(title, host, list);
  a.append(thumb, info);

  const card = {
    el: a,
    canvas,
    data: initial,
    update(c: HouseCard) {
      card.data = c;
      a.setAttribute("aria-label", `Watch ${c.season.name}, ${c.viewerCount} watching, ${c.housemates.length} housemates`);
      live.textContent = c.open ? "LIVE" : "LIVE · opening soon";
      viewers.textContent = `👁 ${c.viewerCount}`;
      tags.replaceChildren(
        ...[c.round && `🗳️ ${c.round}`, c.task && `🏁 ${c.task}`, c.diary && "🎙️ Diary Room", c.tvOn && "📺 TV on"].filter((t): t is string => !!t).map(tag),
      );
      title.textContent = c.season.name;
      host.textContent = `${c.season.hostName ? `Hosted by ${c.season.hostName}` : "Big Brother"} · ${c.housemates.length}/${c.season.maxHousemates} housemates`;

      const rows: HTMLElement[] = c.housemates.slice(0, 4).map((hm) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = hm.color;
        const name = document.createElement("b");
        name.textContent = hm.name;
        const st = document.createElement("small");
        st.textContent = `${hm.speaking ? "🎙️ " : ""}${hm.status}`;
        li.append(dot, name, st);
        return li;
      });
      if (c.housemates.length > 4) rows.push(Object.assign(document.createElement("li"), { className: "more", textContent: `+${c.housemates.length - 4} more` }));
      if (!c.housemates.length) rows.push(Object.assign(document.createElement("li"), { className: "more", textContent: "Waiting for housemates to arrive…" }));
      list.replaceChildren(...rows);
    },
  };
  return card;
}

/** Small cards for seasons taking applications. */
export function applicationCards(seasons: PublicSeason[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "apply-row";
  for (const s of seasons) {
    const a = document.createElement("a");
    a.className = "apply-card";
    a.href = `/apply/${encodeURIComponent(s.id)}`;
    const h = document.createElement("h3");
    h.textContent = s.name;
    const p = document.createElement("p");
    p.textContent = `${s.hostName ? `Hosted by ${s.hostName} · ` : ""}${s.selectedCount}/${s.maxHousemates} selected`;
    const cta = document.createElement("span");
    cta.className = "apply-cta";
    cta.textContent = "Apply →";
    a.append(h, p, cta);
    wrap.append(a);
  }
  return wrap;
}

function tag(text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}
