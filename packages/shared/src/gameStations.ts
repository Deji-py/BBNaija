/**
 * The games hall: where each game is played in the house. Every station is a
 * piece of fixed furniture (a game table, an arcade cabinet, the snooker table…)
 * that housemates walk up to and press E to play. The rules for each game live
 * in games/; this file only places them.
 *
 * The hall is east of the lounge (x 15..33, z -10..10), through the lounge's east door.
 */

export type GameId =
  // Board and card tables
  | "chess"
  | "checkers"
  | "ayo"
  | "whot"
  | "ludo"
  | "snakes"
  | "connect4"
  | "reversi"
  | "tictactoe"
  | "ultimate"
  | "gomoku"
  | "dots"
  | "battleship"
  | "morris"
  | "hex"
  | "go"
  | "yacht"
  | "pig"
  | "blackjack"
  // Arcade cabinets
  | "pong"
  | "tron"
  | "trivia"
  | "hangman"
  | "memory"
  | "rps"
  | "codebreaker"
  // Big tables and the dartboard
  | "pool"
  | "snooker"
  | "airhockey"
  | "darts";

export type StationKind = "gameTable" | "arcade" | "poolTable" | "snookerTable" | "airHockey" | "dartboard";

export interface GameStation {
  /** Also the furniture id. */
  id: string;
  game: GameId;
  kind: StationKind;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  facing: number;
  /** How close (m) to the footprint you must be to play. */
  range: number;
}

const SOUTH = 0;
const NORTH = Math.PI;
const WEST = -Math.PI / 2;

/** Hall bounds, used by house.ts for its walls and area. */
export const GAME_HALL = { minX: 15, maxX: 33, minZ: -10, maxZ: 10 } as const;

const TABLE_GAMES: GameId[] = [
  "chess",
  "checkers",
  "ayo",
  "whot",
  "ludo",
  "snakes",
  "connect4",
  "reversi",
  "tictactoe",
  "ultimate",
  "gomoku",
  "dots",
  "battleship",
  "morris",
  "hex",
  "go",
  "yacht",
  "pig",
  "blackjack",
];
const ARCADE_GAMES: GameId[] = ["pong", "tron", "trivia", "hangman", "memory", "rps", "codebreaker"];

const TABLE_COLUMNS = [17.6, 20.4, 23.2, 26, 28.8];
const TABLE_ROWS = [-5.6, -2.6, 0.4, 3.4];

/** Grid of game tables, skipping the spot in front of the dartboard (the throwing line). */
function tableSpots(): Array<{ x: number; z: number }> {
  const spots: Array<{ x: number; z: number }> = [];
  for (const z of TABLE_ROWS) for (const x of TABLE_COLUMNS) if (!(x === 28.8 && z === -2.6)) spots.push({ x, z });
  return spots;
}

export const GAME_STATIONS: readonly GameStation[] = [
  ...TABLE_GAMES.map((game, i): GameStation => {
    const spot = tableSpots()[i]!;
    return { id: `game-${game}`, game, kind: "gameTable", x: spot.x, z: spot.z, w: 1.2, d: 1.2, h: 0.78, facing: SOUTH, range: 1.4 };
  }),
  // Arcade cabinets along the north wall, screens facing into the hall.
  ...ARCADE_GAMES.map(
    (game, i): GameStation => ({ id: `game-${game}`, game, kind: "arcade", x: 17.4 + i * 2, z: -9.35, w: 1, d: 0.8, h: 1.9, facing: SOUTH, range: 1.3 }),
  ),
  { id: "game-pool", game: "pool", kind: "poolTable", x: 20.6, z: 6.9, w: 2.6, d: 1.4, h: 0.85, facing: SOUTH, range: 1.4 },
  { id: "game-snooker", game: "snooker", kind: "snookerTable", x: 25.6, z: 6.9, w: 3.6, d: 1.9, h: 0.85, facing: SOUTH, range: 1.4 },
  { id: "game-airhockey", game: "airhockey", kind: "airHockey", x: 30.6, z: 6.4, w: 1.2, d: 2.2, h: 0.85, facing: NORTH, range: 1.4 },
  // On the east wall; you throw from the line about 2.5 m back.
  { id: "game-darts", game: "darts", kind: "dartboard", x: 32.8, z: -2.6, w: 0.08, d: 0.9, h: 1.73, facing: WEST, range: 3 },
];

export const STATION_BY_ID: ReadonlyMap<string, GameStation> = new Map(GAME_STATIONS.map((s) => [s.id, s]));

/** Distance from a point to a station's footprint (0 if inside). */
export function distanceToStation(station: GameStation, x: number, z: number): number {
  const dx = Math.max(station.x - station.w / 2 - x, 0, x - (station.x + station.w / 2));
  const dz = Math.max(station.z - station.d / 2 - z, 0, z - (station.z + station.d / 2));
  return Math.hypot(dx, dz);
}

/** The closest station in reach of (x, z), if any. */
export function nearestStation(x: number, z: number): { station: GameStation; dist: number } | undefined {
  let best: { station: GameStation; dist: number } | undefined;
  for (const station of GAME_STATIONS) {
    const dist = distanceToStation(station, x, z);
    if (dist <= station.range && (!best || dist < best.dist)) best = { station, dist };
  }
  return best;
}
