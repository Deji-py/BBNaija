import { GAMES, STATION_BY_ID, type HouseStateView } from "@bbn/shared";
import { button, el } from "./common.js";

/**
 * For viewers: a short list of games being played in the hall right now, each
 * with a Watch button that opens the board.
 */
export class LiveGamesList {
  private readonly el: HTMLElement;
  private shown = "";

  constructor(
    parent: HTMLElement,
    private readonly onWatch: (stationId: string) => void,
  ) {
    this.el = el("aside", "live-games");
    this.el.hidden = true;
    parent.append(this.el);
  }

  update(state: HouseStateView): void {
    const live = [...(state.stations?.entries() ?? [])].filter(([, status]) => status === "playing").map(([id]) => id).sort();
    const key = live.join(",");
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = live.length === 0;
    this.el.replaceChildren(
      el("p", "live-games-title", "🎮 Live in the games hall"),
      ...live.map((id) => {
        const def = GAMES[STATION_BY_ID.get(id)!.game];
        return button(`${def.icon} ${def.name} — watch`, () => this.onWatch(id));
      }),
    );
  }
}
