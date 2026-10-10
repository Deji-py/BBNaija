import {
  GAMES,
  GAME_STATIONS,
  Msg,
  REALTIME_HZ,
  STATION_BY_ID,
  distanceToStation,
  type GameDef,
  type GameErrorMessage,
  type GameResult,
  type GameStation,
  type GameTableView,
} from "@bbn/shared";
import type { HouseState } from "../schema/HouseState.js";

/** Seated players who wander this far (m) past a station's reach leave their seat. */
const SEAT_SLACK = 2;
/** Housemates watching from further than this past reach stop watching. */
const WATCH_SLACK = 4;

interface Table {
  station: GameStation;
  def: GameDef;
  /** Session ids in seat order. */
  seats: string[];
  phase: GameTableView["phase"];
  state: unknown;
  result: GameResult | null;
  watchers: Set<string>;
  /** Last JSON sent to each watcher, so unchanged real-time frames aren't resent. */
  lastSent: Map<string, string>;
}

export interface GameHallDeps {
  state: HouseState;
  send: (sessionId: string, type: string, message: unknown) => void;
  /** Viewers may watch any table from anywhere; they never sit. */
  isViewer: (sessionId: string) => boolean;
  log: (type: string, text: string) => void;
}

/**
 * The games hall. One table per station; housemates walk up, sit, and play.
 * The server owns every game state (rules in @bbn/shared games/) and sends each
 * watcher their own view of it — so hidden cards and ships stay hidden.
 */
export class GameHall {
  private readonly tables = new Map<string, Table>();
  /** Which station each client is watching / sitting at. */
  private readonly watching = new Map<string, string>();
  private readonly seatedAt = new Map<string, string>();
  private sinceDistanceCheck = 0;

  constructor(private readonly deps: GameHallDeps) {
    for (const station of GAME_STATIONS) {
      this.tables.set(station.id, {
        station,
        def: GAMES[station.game],
        seats: [],
        phase: "lobby",
        state: null,
        result: null,
        watchers: new Set(),
        lastSent: new Map(),
      });
    }
  }

  // ---------------------------------------------------------------- client actions

  watch(id: string, stationId: unknown): void {
    const table = typeof stationId === "string" ? this.tables.get(stationId) : undefined;
    if (!table) return;
    if (!this.deps.isViewer(id) && !this.inReach(id, table.station, 0.3)) return this.error(id, "Walk up to the game to play");
    this.unwatch(id);
    this.watching.set(id, table.station.id);
    table.watchers.add(id);
    this.broadcast(table);
  }

  unwatch(id: string): void {
    const stationId = this.watching.get(id);
    if (!stationId) return;
    const table = this.tables.get(stationId)!;
    this.watching.delete(id);
    table.watchers.delete(id);
    table.lastSent.delete(id);
    this.broadcast(table);
  }

  sit(id: string): void {
    const table = this.watchedTable(id);
    if (!table || this.deps.isViewer(id) || !this.deps.state.players.has(id)) return;
    if (this.seatedAt.has(id)) return this.error(id, "You're already playing a game — leave it first");
    if (table.phase === "playing") return this.error(id, "A game is in progress — wait for it to finish");
    if (table.seats.length >= table.def.maxPlayers) return this.error(id, "All the seats are taken");
    if (!this.inReach(id, table.station, 0.3)) return this.error(id, "Walk up to the game to play");
    table.seats.push(id);
    this.seatedAt.set(id, table.station.id);
    table.phase = "lobby";
    table.state = null;
    table.result = null;
    this.syncStation(table);
    this.broadcast(table);
  }

  leave(id: string): void {
    const stationId = this.seatedAt.get(id);
    if (!stationId) return;
    const table = this.tables.get(stationId)!;
    const seat = table.seats.indexOf(id);
    this.seatedAt.delete(id);
    const wasPlaying = table.phase === "playing";
    const name = this.deps.state.players.get(id)?.name ?? "A player";
    const others = table.seats.filter((s) => s !== id).map((s) => this.deps.state.players.get(s)?.name ?? "?");
    if (wasPlaying) this.finish(table, { winners: table.seats.map((_, i) => i).filter((i) => i !== seat), text: `${name} left the game` });
    table.seats.splice(seat, 1);
    table.state = null;
    // Seats changed, so seat numbers no longer match the last game: back to the lobby,
    // keeping a plain-text note of how it ended.
    table.phase = "lobby";
    if (wasPlaying) table.result = { winners: [], text: `${name} left the game${others.length ? ` — ${others.join(" & ")} win${others.length === 1 ? "s" : ""}` : ""}` };
    this.syncStation(table);
    this.broadcast(table);
  }

  start(id: string): void {
    const table = this.tableSeating(id);
    if (!table) return;
    if (table.phase === "playing") return;
    const n = table.seats.length;
    if (n < table.def.minPlayers) return this.error(id, `Needs ${table.def.minPlayers}+ players`);
    table.state = table.def.setup(n, Math.random);
    table.result = null;
    table.phase = "playing";
    table.lastSent.clear();
    this.deps.log("games", `${table.def.name} started (${table.seats.map((s) => this.deps.state.players.get(s)?.name ?? "?").join(", ")})`);
    this.syncStation(table);
    this.broadcast(table);
  }

  move(id: string, move: unknown): void {
    const table = this.tableSeating(id);
    if (!table || table.phase !== "playing") return;
    const seat = table.seats.indexOf(id);
    if (!table.def.turn(table.state).includes(seat)) return this.error(id, "It's not your turn");
    const err = table.def.move(table.state, seat, move, Math.random);
    if (err) return this.error(id, err);
    const result = table.def.result(table.state);
    if (result) this.finish(table, result);
    this.broadcast(table);
  }

  input(id: string, input: unknown): void {
    const table = this.tableSeating(id);
    if (!table || table.phase !== "playing" || !table.def.input) return;
    table.def.input(table.state, table.seats.indexOf(id), input);
  }

  /** Whether a housemate holds a seat at any table. */
  isSeated(id: string): boolean {
    return this.seatedAt.has(id);
  }

  /** A client left the house (or the room). */
  onLeft(id: string): void {
    this.leave(id);
    this.unwatch(id);
  }

  // ---------------------------------------------------------------- simulation

  /** Steps real-time games and enforces "stay at the table". Called REALTIME_HZ times a second. */
  tick(): void {
    const dt = 1 / REALTIME_HZ;
    for (const table of this.tables.values()) {
      if (table.phase !== "playing" || !table.def.realtime || !table.def.tick) continue;
      table.def.tick(table.state, dt, Math.random);
      const result = table.def.result(table.state);
      if (result) this.finish(table, result);
      this.broadcast(table);
    }
    this.sinceDistanceCheck += dt;
    if (this.sinceDistanceCheck >= 0.5) {
      this.sinceDistanceCheck = 0;
      for (const [id, stationId] of [...this.seatedAt]) {
        if (!this.inReach(id, STATION_BY_ID.get(stationId)!, SEAT_SLACK)) {
          this.error(id, "You walked away from the table");
          this.leave(id);
        }
      }
      for (const [id, stationId] of [...this.watching]) {
        if (!this.deps.isViewer(id) && !this.inReach(id, STATION_BY_ID.get(stationId)!, WATCH_SLACK)) this.unwatch(id);
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  private finish(table: Table, result: GameResult): void {
    table.result = result;
    table.phase = "over";
    const names = (seats: number[]) => seats.map((i) => this.deps.state.players.get(table.seats[i] ?? "")?.name ?? "?").join(" & ");
    this.deps.log("games", `${table.def.name}: ${result.winners.length ? `${names(result.winners)} won` : "draw"} — ${result.text}`);
    this.syncStation(table);
  }

  /** Busy stations go into synced state so the 3D hall (and viewers) can show what's live. */
  private syncStation(table: Table): void {
    const status = table.phase === "playing" ? "playing" : table.seats.length ? "waiting" : "";
    const stations = this.deps.state.stations;
    if (!status) {
      if (stations.has(table.station.id)) stations.delete(table.station.id);
    } else if (stations.get(table.station.id) !== status) stations.set(table.station.id, status);
  }

  private broadcast(table: Table): void {
    const seats = table.seats.map((id) => {
      const p = this.deps.state.players.get(id);
      return { id, name: p?.name ?? "?", color: p?.color ?? "#888" };
    });
    const turn = table.phase === "playing" ? table.def.turn(table.state) : [];
    for (const watcher of table.watchers) {
      const you = table.seats.indexOf(watcher);
      const view =
        table.state === null ? null : table.def.view ? table.def.view(table.state, you >= 0 ? you : null) : table.state;
      const message: GameTableView = {
        station: table.station.id,
        game: table.station.game,
        seats,
        phase: table.phase,
        you,
        turn,
        view,
        result: table.result,
        watchers: table.watchers.size,
      };
      const json = JSON.stringify(message);
      if (table.lastSent.get(watcher) === json) continue;
      table.lastSent.set(watcher, json);
      this.deps.send(watcher, Msg.gameTable, message);
    }
  }

  private watchedTable(id: string): Table | undefined {
    const stationId = this.watching.get(id);
    return stationId ? this.tables.get(stationId) : undefined;
  }

  private tableSeating(id: string): Table | undefined {
    const stationId = this.seatedAt.get(id);
    return stationId ? this.tables.get(stationId) : undefined;
  }

  private inReach(id: string, station: GameStation, slack: number): boolean {
    const p = this.deps.state.players.get(id);
    return !!p && !p.exiting && distanceToStation(station, p.x, p.z) <= station.range + slack;
  }

  private error(id: string, text: string): void {
    const message: GameErrorMessage = { text };
    this.deps.send(id, Msg.gameError, message);
  }
}
