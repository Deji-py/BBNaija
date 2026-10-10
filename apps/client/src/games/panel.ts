import { GAMES, Msg, STATION_BY_ID, type GameErrorMessage, type GameTableView } from "@bbn/shared";
import { button, el, myTurn, seatName, type GameRenderer } from "./common.js";
import { RENDERERS } from "./renderers.js";

interface PanelOptions {
  send: (type: string, message?: unknown) => void;
  /** Housemates can sit and play; viewers only watch. */
  canPlay: boolean;
}

/**
 * The on-screen game window. Opens over the house when you press E at a game
 * station: who's seated, whose turn it is, the board itself (drawn by the
 * game's renderer), and Join / Start / Leave.
 */
export class GamePanel {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly rules: HTMLElement;
  private readonly seats: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly boardArea: HTMLElement;
  private readonly board: HTMLElement;
  private readonly controls: HTMLElement;
  private station: string | null = null;
  /** Station where you last held a seat (so the prompt can say "Back to your game"). */
  private seated: string | null = null;
  private table: GameTableView | null = null;
  private renderer: GameRenderer | null = null;
  private errorTimer = 0;
  /** Showing "Yes, resign / Keep playing" instead of the Resign button. */
  private confirmResign = false;
  private error: string | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape" && this.station) this.close();
  };

  constructor(
    parent: HTMLElement,
    private readonly opts: PanelOptions,
  ) {
    this.el = el("div", "game-panel");
    this.el.hidden = true;
    const head = el("div", "game-head");
    this.title = el("h2", "game-title");
    const close = button("✕", () => this.close(), "game-close");
    close.title = "Close (Esc)";
    head.append(this.title, close);
    this.rules = el("p", "game-rules");
    this.seats = el("div", "game-seats");
    this.status = el("p", "game-status");
    this.actions = el("div", "game-actions");
    this.boardArea = el("div", "game-board-area");
    this.board = el("div", "game-board");
    this.controls = el("div", "game-controls");
    this.boardArea.append(this.board, this.controls);
    this.el.append(head, this.rules, this.seats, this.status, this.boardArea, this.actions);
    // Clicks inside the panel shouldn't reach the 3D view (camera drag).
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.append(this.el);
    window.addEventListener("keydown", this.onKey);
  }

  get isOpen(): boolean {
    return this.station !== null;
  }

  get stationId(): string | null {
    return this.station;
  }

  /** Station you're seated at, as of the last update you saw. */
  get seatedStation(): string | null {
    return this.seated;
  }

  open(stationId: string): void {
    const station = STATION_BY_ID.get(stationId);
    if (!station) return;
    if (this.station !== stationId) this.reset();
    this.station = stationId;
    const def = GAMES[station.game];
    this.title.textContent = `${def.icon} ${def.name}`;
    this.rules.textContent = def.rules;
    this.status.textContent = "Connecting to the table…";
    this.el.hidden = false;
    this.opts.send(Msg.gameWatch, { station: stationId });
  }

  close(): void {
    if (!this.station) return;
    this.opts.send(Msg.gameUnwatch);
    this.station = null;
    this.reset();
    this.el.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  onTable(table: GameTableView): void {
    if (table.station !== this.station) return;
    this.table = table;
    if (table.phase !== "playing" || table.you < 0) this.confirmResign = false;
    if (table.you >= 0) this.seated = table.station;
    else if (this.seated === table.station) this.seated = null;
    // The board appears once a game has state; it stays up after the game ends.
    if (table.view !== null && !this.renderer) {
      const factory = RENDERERS[table.game];
      this.renderer = factory({
        board: this.board,
        controls: this.controls,
        move: (move) => this.opts.send(Msg.gameMove, { move }),
        input: (input) => this.opts.send(Msg.gameInput, { input }),
        table: () => this.table!,
      });
    } else if (table.view === null && this.renderer) this.clearBoard();
    this.renderer?.update(table);
    this.render();
  }

  onError({ text }: GameErrorMessage): void {
    if (!this.station) return;
    this.error = text;
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      this.error = null;
      this.render();
    }, 2600);
    this.render();
  }

  private reset(): void {
    this.confirmResign = false;
    this.clearBoard();
    this.table = null;
    this.error = null;
    this.seats.replaceChildren();
    this.actions.replaceChildren();
  }

  private clearBoard(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.board.replaceChildren();
    this.controls.replaceChildren();
  }

  /** Seats, status line and buttons (the board renders itself). */
  private render(): void {
    const t = this.table;
    if (!t) return;
    const def = GAMES[t.game];

    this.seats.replaceChildren(
      ...t.seats.map((s, i) => {
        const chip = el("span", "game-seat");
        if (t.turn.includes(i)) chip.classList.add("to-move");
        if (i === t.you) chip.classList.add("me");
        const dot = el("i");
        dot.style.background = s.color;
        chip.append(dot, document.createTextNode(i === t.you ? `${s.name} (you)` : s.name));
        return chip;
      }),
      ...(t.seats.length < def.maxPlayers && t.phase !== "playing"
        ? [el("span", "game-seat empty", `${def.maxPlayers - t.seats.length} seat${def.maxPlayers - t.seats.length === 1 ? "" : "s"} free`)]
        : []),
      el("span", "game-watchers", t.watchers > 1 ? `👀 ${t.watchers} at the table` : ""),
    );

    let status: string;
    let tone = "";
    if (this.error) {
      status = `⚠️ ${this.error}`;
      tone = "warn";
    } else if (t.phase === "lobby") {
      const need = Math.max(0, def.minPlayers - t.seats.length);
      status = t.result
        ? t.result.text
        : need > 0
          ? `Waiting for ${need} more player${need === 1 ? "" : "s"} (${def.minPlayers}${def.maxPlayers > def.minPlayers ? `–${def.maxPlayers}` : ""} can play)`
          : "Ready — any seated player can start";
    } else if (t.phase === "over" && t.result) {
      const names = t.result.winners.map((i) => seatName(t, i)).join(" & ");
      const iWon = t.result.winners.includes(t.you);
      status = t.result.winners.length ? `🏆 ${iWon ? "You win!" : `${names} win${t.result.winners.length === 1 ? "s" : ""}`} — ${t.result.text}` : `🤝 ${t.result.text}`;
      tone = iWon ? "win" : "";
    } else if (myTurn(t)) {
      status = def.realtime ? "Game on!" : "Your turn";
      tone = "go";
    } else if (t.turn.length) {
      status = def.realtime ? "Game on!" : `Waiting for ${t.turn.map((i) => seatName(t, i)).join(", ")}…`;
    } else status = "";
    this.status.textContent = status;
    this.status.dataset.tone = tone;

    const buttons: HTMLButtonElement[] = [];
    const seated = t.you >= 0;
    if (this.opts.canPlay && !seated && t.phase !== "playing" && t.seats.length < def.maxPlayers)
      buttons.push(button("Take a seat", () => this.opts.send(Msg.gameSit), "primary"));
    if (seated && t.phase !== "playing" && t.seats.length >= def.minPlayers)
      buttons.push(button(t.phase === "over" ? "Play again" : "Start game", () => this.opts.send(Msg.gameStart), "primary"));
    if (seated && t.phase === "playing") {
      // Resigning asks once, inside the panel (no browser pop-up, which some browsers block).
      if (this.confirmResign) {
        buttons.push(
          button("Yes, resign — they win", () => {
            this.confirmResign = false;
            this.opts.send(Msg.gameLeave);
          }, "danger"),
          button("Keep playing", () => {
            this.confirmResign = false;
            this.render();
          }),
        );
      } else
        buttons.push(
          button("Resign", () => {
            this.confirmResign = true;
            this.render();
          }),
        );
    } else if (seated) buttons.push(button("Leave seat", () => this.opts.send(Msg.gameLeave)));
    if (!this.opts.canPlay) buttons.push(el("span", "game-note", "Watching — only housemates can play") as unknown as HTMLButtonElement);
    this.actions.replaceChildren(...buttons);
  }
}
