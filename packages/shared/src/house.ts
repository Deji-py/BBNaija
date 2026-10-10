import type { AreaId } from "./types.js";
import { GAME_HALL, GAME_STATIONS } from "./gameStations.js";

/**
 * House layout data, shared by client (rendering) and server (collision, from M2).
 *
 * Coordinates are metres on the ground plane: +X is east, +Z is south, Y is up.
 *
 *                                    x=1                x=15
 *     z=-16                         ┌───────────────────┐
 *                                   │ Bathroom & laundry│
 *            x=-15        x=-5       door                x=15             x=33
 *     z=-10  ┌────────────┬─────────┬───────────────────┬────────────────┐
 *            │  Bedroom   │  Diary  │      Kitchen      │                │
 *     z=-2   ├───door─────┼──door───┼──────door─────────┤   Games hall   │
 *            │    Gym     door         Lounge           │                │
 *            │            │                            door               │
 *     z=10   ├────────────┴───────────────door──────────┼────────────────┘
 *            │                 Garden + pool            │
 *     z=26   └──────────────────────────────────────────┘
 */

/** Axis-aligned box on the ground plane. Used for both walls and solid furniture. */
export interface Box2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Wall extends Box2D {
  height: number;
  kind: "wall" | "fence";
}

export interface Area extends Box2D {
  id: AreaId;
  label: string;
}

export type FurnitureKind =
  | "sofa"
  | "coffeeTable"
  | "tv"
  | "counter"
  | "stove"
  | "fridge"
  | "diningTable"
  | "bed"
  | "treadmill"
  | "weights"
  | "bench"
  | "diaryChair"
  | "pool"
  | "lounger"
  | "tree"
  | "rug"
  | "frame"
  | "vegBowl"
  | "drinks"
  | "board"
  | "chair"
  | "plant"
  | "theater"
  | "chandelier"
  // Added with the interior refresh (inspired by the real BBNaija house: games lounge,
  // Big Brother eye, vanity, pergola and jacuzzi).
  | "speaker"
  | "armchair"
  | "bookshelf"
  | "billiards"
  | "bbEye"
  | "island"
  | "microwave"
  | "kettle"
  | "wardrobe"
  | "vanity"
  | "bike"
  | "punchingBag"
  | "mirror"
  | "camera"
  | "softbox"
  | "gardenTable"
  | "bbq"
  | "gardenBench"
  | "pergola"
  | "hotTub"
  // Games hall stations (see gameStations.ts)
  | "gameTable"
  | "arcade"
  | "poolTable"
  | "snookerTable"
  | "airHockey"
  | "dartboard"
  // Bathroom and laundry
  | "toilet"
  | "partition"
  | "shower"
  | "bathtub"
  | "sink"
  | "washer"
  | "towelRack"
  // Party room and lights
  | "djBooth"
  | "danceFloor"
  | "discoBall"
  | "partyLight"
  | "stage"
  | "lightSwitch"
  // House security, standing at the Diary Room door
  | "guard"
  // The resident DJ, behind the decks in the party room
  | "dj";

export interface Furniture {
  /** Stable id — interactions (M4) refer to objects by this. */
  id: string;
  kind: FurnitureKind;
  /** Centre position. */
  x: number;
  z: number;
  /** Footprint size along X (w) and Z (d), and height. */
  w: number;
  d: number;
  h: number;
  /** Which way the object faces (its "front"), in radians around Y. 0 = +Z. */
  facing?: number;
  /** Whether players collide with it. */
  solid: boolean;
}

/**
 * Tall enough that the fixed room cameras (mounted near 2.8 m) and the normal
 * third-person view sit under the ceiling instead of clipping through it.
 */
export const WALL_HEIGHT = 7;
/** Above a standing person, so the garden feels closed in. The garden camera still looks over it. */
export const FENCE_HEIGHT = 2.8;
export const WALL_THICKNESS = 0.3;

/** Player collision radius in metres. */
export const PLAYER_RADIUS = 0.35;
/** Walking speed in metres per second. */
export const WALK_SPEED = 4.5;
/** Holding Shift. */
export const RUN_SPEED = 7.2;
/** Swimming in the pool. */
export const SWIM_SPEED = 2.6;

export const SPAWN_POINT = { x: 5, z: 4 } as const;

export const AREAS: readonly Area[] = [
  { id: "bedroom", label: "Bedroom", minX: -15, maxX: -5, minZ: -10, maxZ: -2 },
  { id: "diary", label: "Diary Room", minX: -5, maxX: 1, minZ: -10, maxZ: -2 },
  { id: "kitchen", label: "Kitchen", minX: 1, maxX: 15, minZ: -10, maxZ: -2 },
  { id: "gym", label: "Gym", minX: -15, maxX: -5, minZ: -2, maxZ: 10 },
  { id: "lounge", label: "Lounge", minX: -5, maxX: 15, minZ: -2, maxZ: 10 },
  { id: "garden", label: "Garden", minX: -15, maxX: 15, minZ: 10, maxZ: 26 },
  { id: "games", label: "Games Hall", ...GAME_HALL },
  { id: "bathroom", label: "Bathroom", minX: 1, maxX: 15, minZ: -16, maxZ: -10 },
  { id: "party", label: "Party Room", minX: -31, maxX: -15, minZ: -10, maxZ: 10 },
];

type Gap = readonly [from: number, to: number];

/** Wall running along X at a fixed z, from x0 to x1, with door gaps cut out. */
function wallAlongX(z: number, x0: number, x1: number, gaps: Gap[], kind: Wall["kind"] = "wall"): Wall[] {
  return splitByGaps(x0, x1, gaps).map(([a, b]) => ({
    minX: a,
    maxX: b,
    minZ: z - WALL_THICKNESS / 2,
    maxZ: z + WALL_THICKNESS / 2,
    height: kind === "wall" ? WALL_HEIGHT : FENCE_HEIGHT,
    kind,
  }));
}

/** Wall running along Z at a fixed x, from z0 to z1, with door gaps cut out. */
function wallAlongZ(x: number, z0: number, z1: number, gaps: Gap[], kind: Wall["kind"] = "wall"): Wall[] {
  return splitByGaps(z0, z1, gaps).map(([a, b]) => ({
    minX: x - WALL_THICKNESS / 2,
    maxX: x + WALL_THICKNESS / 2,
    minZ: a,
    maxZ: b,
    height: kind === "wall" ? WALL_HEIGHT : FENCE_HEIGHT,
    kind,
  }));
}

function splitByGaps(start: number, end: number, gaps: Gap[]): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let cursor = start;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > cursor) segments.push([cursor, g0]);
    cursor = g1;
  }
  if (cursor < end) segments.push([cursor, end]);
  return segments;
}

export const WALLS: readonly Wall[] = [
  // Outer walls of the house
  ...wallAlongX(-10, -15, 15, [[1.1, 2.9]]), // north wall; kitchen → bathroom door
  // Bathroom, behind the kitchen
  ...wallAlongX(-16, 1, 15, []),
  ...wallAlongZ(1, -16, -10, []),
  ...wallAlongZ(15, -16, -10, []),
  ...wallAlongZ(-15, -10, 10, [[7.9, 9.7]]), // west wall; gym → party room door
  // Party room, west of the gym and bedroom
  ...wallAlongX(-10, -31, -15, []),
  ...wallAlongX(10, -31, -15, []),
  ...wallAlongZ(-31, -10, 10, []),
  ...wallAlongZ(15, -10, 10, [[7.6, 9.6]]), // lounge → games hall door
  // Games hall, east of the lounge and kitchen
  ...wallAlongX(GAME_HALL.minZ, GAME_HALL.minX, GAME_HALL.maxX, []),
  ...wallAlongX(GAME_HALL.maxZ, GAME_HALL.minX, GAME_HALL.maxX, []),
  ...wallAlongZ(GAME_HALL.maxX, GAME_HALL.minZ, GAME_HALL.maxZ, []),
  ...wallAlongX(10, -15, 15, [[3.5, 6.5]]), // lounge → garden door
  // Inner walls
  ...wallAlongX(-2, -15, 15, [
    [-11, -9], // gym → bedroom
    [-3, -1], // lounge → diary room
    [7, 9], // lounge → kitchen
  ]),
  ...wallAlongZ(-5, -10, 10, [[3, 5]]), // bedroom|diary wall, then gym → lounge door
  ...wallAlongZ(1, -10, -2, []), // diary | kitchen
  // Garden fence
  ...wallAlongZ(-15, 10, 26, [], "fence"),
  ...wallAlongZ(15, 10, 26, [], "fence"),
  ...wallAlongX(26, -15, 15, [], "fence"),
];

/**
 * A door leaf fills one of the gaps cut out of {@link WALLS}. Closed doors
 * block walking; opening one (see `collidersFor`) clears that gap.
 * `along` is the axis the opening runs on. Two leaves meet in the middle.
 */
export interface Door {
  id: string;
  /** Used in the "Press E" prompt, e.g. "garden door". */
  label: string;
  /** Centre of the opening. */
  x: number;
  z: number;
  /** Width across the opening, slab thickness, and height. */
  w: number;
  thick: number;
  h: number;
  leaves: 1 | 2;
  along: "x" | "z";
}

export const DOORS: readonly Door[] = [
  { id: "door-garden", label: "garden door", x: 5, z: 10, w: 3, thick: 0.1, h: 3.4, leaves: 2, along: "x" },
  { id: "door-kitchen", label: "kitchen door", x: 8, z: -2, w: 2, thick: 0.1, h: 3.4, leaves: 1, along: "x" },
  { id: "door-diary", label: "Diary Room door", x: -2, z: -2, w: 2, thick: 0.1, h: 3.4, leaves: 1, along: "x" },
  { id: "door-bedroom", label: "bedroom door", x: -10, z: -2, w: 2, thick: 0.1, h: 3.4, leaves: 1, along: "x" },
  { id: "door-gym", label: "gym door", x: -5, z: 4, w: 2, thick: 0.1, h: 3.4, leaves: 1, along: "z" },
  { id: "door-party", label: "party room door", x: -15, z: 8.8, w: 1.8, thick: 0.1, h: 3.4, leaves: 2, along: "z" },
  { id: "door-bathroom", label: "bathroom door", x: 2, z: -10, w: 1.8, thick: 0.1, h: 3.4, leaves: 1, along: "x" },
  { id: "door-games", label: "games hall door", x: 15, z: 8.6, w: 2, thick: 0.1, h: 3.4, leaves: 1, along: "z" },
];

const DOOR_BY_ID: ReadonlyMap<string, Door> = new Map(DOORS.map((d) => [d.id, d]));

/**
 * The guarded door. Housemates only go in when Big Brother calls them (the call
 * seats them in the chair); from inside, anyone may open it to leave.
 */
export const DIARY_DOOR_ID = "door-diary";
export const DIARY_CLOSED_REASON = "Security: the Diary Room is closed until Big Brother calls you.";
/** Where security walks anyone still inside when a session starts: the lounge, between the guards. */
export const DIARY_ESCORT_POINT = { x: -2, z: -0.6 } as const;

export function insideDiaryRoom(x: number, z: number): boolean {
  return areaAt(x, z)?.id === "diary";
}

export function doorById(id: string): Door | undefined {
  return DOOR_BY_ID.get(id);
}

/** Footprint of a shut door. Opening it removes this box from the colliders. */
export function doorBox(door: Door): Box2D {
  if (door.along === "x") {
    return {
      minX: door.x - door.w / 2,
      maxX: door.x + door.w / 2,
      minZ: door.z - door.thick / 2,
      maxZ: door.z + door.thick / 2,
    };
  }
  return {
    minX: door.x - door.thick / 2,
    maxX: door.x + door.thick / 2,
    minZ: door.z - door.w / 2,
    maxZ: door.z + door.w / 2,
  };
}

/** Space-separated door ids, as stored on the room. Unknown ids are dropped. */
export function openDoorSet(raw: string): Set<string> {
  const open = new Set<string>();
  for (const id of raw.split(" ")) if (DOOR_BY_ID.has(id)) open.add(id);
  return open;
}

export function openDoorList(ids: Iterable<string>): string {
  return [...ids].filter((id) => DOOR_BY_ID.has(id)).sort().join(" ");
}

const SOUTH = 0;
const NORTH = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

/**
 * Fixed furniture: big or heavy things, and the spots people use (seats, beds…).
 * Light items people can pick up and carry live in props.ts instead.
 */
/** One light switch per room, on the wall beside the way in. */
export const LIGHT_SWITCHES: ReadonlyArray<{ area: AreaId; x: number; z: number; facing: number }> = [
  { area: "lounge", x: 6.9, z: 9.8, facing: NORTH },
  { area: "kitchen", x: 9.5, z: -2.2, facing: NORTH },
  { area: "diary", x: -0.6, z: -2.2, facing: NORTH },
  { area: "bedroom", x: -8.6, z: -2.2, facing: NORTH },
  { area: "gym", x: -5.2, z: 5.4, facing: WEST },
  { area: "games", x: 15.2, z: 7.2, facing: EAST },
  { area: "bathroom", x: 3.3, z: -10.2, facing: NORTH },
  { area: "party", x: -15.2, z: 7.4, facing: WEST },
];

export const FURNITURE: readonly Furniture[] = [
  // Lounge — TV corner
  { id: "lounge-rug", kind: "rug", x: 10.5, z: 4, w: 5, d: 5, h: 0.02, solid: false },
  { id: "sofa", kind: "sofa", x: 9, z: 4, w: 1, d: 4, h: 0.85, facing: EAST, solid: true },
  { id: "armchair-1", kind: "armchair", x: 11.5, z: 1.15, w: 0.95, d: 0.9, h: 0.9, facing: SOUTH, solid: true },
  { id: "armchair-2", kind: "armchair", x: 11.5, z: 7.3, w: 0.95, d: 0.9, h: 0.9, facing: NORTH, solid: true },
  { id: "coffee-table", kind: "coffeeTable", x: 11.5, z: 4, w: 1, d: 2, h: 0.45, solid: true },
  { id: "drinks", kind: "drinks", x: 11.5, z: 4, w: 0.7, d: 0.4, h: 0.45, solid: false },
  { id: "tv", kind: "tv", x: 14.5, z: 4, w: 0.6, d: 3, h: 1.7, facing: WEST, solid: true },
  // Sound bar on the same stand as the TV. Not solid: the TV stand already blocks walking.
  { id: "home-theater", kind: "theater", x: 14.5, z: 4, w: 0.6, d: 3, h: 1.7, facing: WEST, solid: false },
  // Floor-standing tower speakers either side of the TV stand.
  { id: "speaker-left", kind: "speaker", x: 14.5, z: 2.05, w: 0.36, d: 0.36, h: 1.6, facing: WEST, solid: true },
  { id: "speaker-right", kind: "speaker", x: 14.5, z: 5.95, w: 0.36, d: 0.36, h: 1.6, facing: WEST, solid: true },
  { id: "frame-flag", kind: "frame", x: 1.2, z: -1.7, w: 1.05, d: 0.08, h: 0.72, facing: SOUTH, solid: false },
  { id: "frame-state-house", kind: "frame", x: 4.2, z: -1.7, w: 0.78, d: 0.08, h: 0.95, facing: SOUTH, solid: false },
  { id: "frame-crest", kind: "frame", x: 6.2, z: -1.7, w: 0.78, d: 0.08, h: 0.78, facing: SOUTH, solid: false },
  // Hangs from the ceiling over the rug, between the sofa and the television.
  { id: "chandelier", kind: "chandelier", x: 10.5, z: 4, w: 2.2, d: 2.2, h: 3.4, solid: false },
  // Lounge — games corner and reading nook
  { id: "billiards", kind: "billiards", x: 0.6, z: 2.4, w: 2.4, d: 1.3, h: 0.85, solid: true },
  { id: "bb-eye", kind: "bbEye", x: -4.82, z: 7.4, w: 0.08, d: 1.6, h: 1.6, facing: EAST, solid: false },
  { id: "armchair-3", kind: "armchair", x: -3.9, z: 6.6, w: 0.9, d: 0.95, h: 0.9, facing: EAST, solid: true },
  { id: "bookshelf", kind: "bookshelf", x: -2.2, z: 9.62, w: 2, d: 0.4, h: 2.2, facing: NORTH, solid: true },
  // Kitchen
  { id: "counter", kind: "counter", x: 7, z: -9.35, w: 8, d: 1, h: 0.95, facing: SOUTH, solid: true },
  { id: "microwave", kind: "microwave", x: 3.7, z: -9.45, w: 0.55, d: 0.4, h: 0.95, facing: SOUTH, solid: false },
  { id: "kettle", kind: "kettle", x: 9.9, z: -9.4, w: 0.2, d: 0.2, h: 0.95, solid: false },
  { id: "stove", kind: "stove", x: 11.8, z: -9.35, w: 1.4, d: 1, h: 0.95, facing: SOUTH, solid: true },
  { id: "fridge", kind: "fridge", x: 14, z: -9.25, w: 1.2, d: 1.2, h: 2, facing: SOUTH, solid: true },
  { id: "island", kind: "island", x: 3.8, z: -6.2, w: 2.4, d: 1, h: 0.95, facing: SOUTH, solid: true },
  { id: "dining-table", kind: "diningTable", x: 8, z: -5.5, w: 3, d: 1.5, h: 0.75, solid: true },
  { id: "chair-1", kind: "chair", x: 7.2, z: -4.15, w: 0.55, d: 0.55, h: 0.9, facing: NORTH, solid: true },
  { id: "chair-2", kind: "chair", x: 8.8, z: -4.15, w: 0.55, d: 0.55, h: 0.9, facing: NORTH, solid: true },
  { id: "chair-3", kind: "chair", x: 7.2, z: -6.85, w: 0.55, d: 0.55, h: 0.9, facing: SOUTH, solid: true },
  { id: "chair-4", kind: "chair", x: 8.8, z: -6.85, w: 0.55, d: 0.55, h: 0.9, facing: SOUTH, solid: true },
  { id: "chopping-board", kind: "board", x: 5.4, z: -9.35, w: 0.7, d: 0.45, h: 0.95, solid: false },
  { id: "frame-market", kind: "frame", x: 14.7, z: -6, w: 0.08, d: 0.95, h: 0.72, facing: WEST, solid: false },
  // Bedroom
  { id: "bedroom-rug", kind: "rug", x: -10, z: -5, w: 4, d: 2.6, h: 0.02, solid: false },
  { id: "bed-1", kind: "bed", x: -13.4, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  { id: "bed-2", kind: "bed", x: -10, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  { id: "bed-3", kind: "bed", x: -6.6, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  { id: "frame-pattern", kind: "frame", x: -11.7, z: -9.7, w: 1.05, d: 0.08, h: 0.8, facing: SOUTH, solid: false },
  { id: "wardrobe", kind: "wardrobe", x: -5.5, z: -4.2, w: 0.6, d: 1.8, h: 2.3, facing: WEST, solid: true },
  { id: "vanity", kind: "vanity", x: -12.8, z: -2.45, w: 1.4, d: 0.5, h: 0.8, facing: NORTH, solid: true },
  // Gym
  { id: "treadmill-1", kind: "treadmill", x: -13, z: 2, w: 1, d: 2.2, h: 1.3, facing: NORTH, solid: true },
  { id: "treadmill-2", kind: "treadmill", x: -11, z: 2, w: 1, d: 2.2, h: 1.3, facing: NORTH, solid: true },
  { id: "bike", kind: "bike", x: -7.8, z: 0.4, w: 0.6, d: 1.4, h: 1.2, facing: NORTH, solid: true },
  { id: "weights", kind: "weights", x: -10, z: 9.2, w: 3, d: 0.8, h: 1.2, facing: NORTH, solid: true },
  { id: "bench", kind: "bench", x: -12.5, z: 6.5, w: 0.6, d: 1.6, h: 0.5, solid: true },
  { id: "punching-bag", kind: "punchingBag", x: -6.6, z: 7.2, w: 0.5, d: 0.5, h: 2.4, solid: true },
  { id: "gym-mirror", kind: "mirror", x: -14.82, z: 6, w: 0.06, d: 3, h: 2, facing: EAST, solid: false },
  // Diary room
  { id: "diary-chair", kind: "diaryChair", x: -2, z: -8.3, w: 1.3, d: 1.1, h: 1.2, facing: SOUTH, solid: true },
  { id: "diary-eye", kind: "bbEye", x: -2, z: -9.82, w: 1.4, d: 0.08, h: 1.4, facing: SOUTH, solid: false },
  { id: "diary-camera", kind: "camera", x: -2, z: -4.3, w: 0.5, d: 0.5, h: 1.5, facing: NORTH, solid: true },
  { id: "softbox-left", kind: "softbox", x: -4.2, z: -6.6, w: 0.5, d: 0.5, h: 1.8, facing: NORTH, solid: true },
  { id: "softbox-right", kind: "softbox", x: 0.2, z: -6.6, w: 0.5, d: 0.5, h: 1.8, facing: NORTH, solid: true },
  // Security either side of the Diary Room door, clear of the leaf that swings into the lounge.
  { id: "guard-diary-west", kind: "guard", x: -3.6, z: -1.5, w: 0.6, d: 0.6, h: 1.9, facing: SOUTH, solid: true },
  { id: "guard-diary-east", kind: "guard", x: -0.4, z: -1.5, w: 0.6, d: 0.6, h: 1.9, facing: SOUTH, solid: true },
  // Garden
  { id: "pool", kind: "pool", x: -3, z: 18, w: 10, d: 6, h: 0.1, solid: true },
  { id: "pergola", kind: "pergola", x: 8.5, z: 16, w: 4, d: 3, h: 2.8, solid: false },
  { id: "lounger-1", kind: "lounger", x: 7.5, z: 16, w: 0.8, d: 2, h: 0.4, facing: SOUTH, solid: true },
  { id: "lounger-2", kind: "lounger", x: 9.5, z: 16, w: 0.8, d: 2, h: 0.4, facing: SOUTH, solid: true },
  { id: "hot-tub", kind: "hotTub", x: -11.5, z: 17, w: 2.4, d: 2.4, h: 0.8, solid: true },
  { id: "garden-table", kind: "gardenTable", x: 8.5, z: 21.5, w: 1.8, d: 1.2, h: 0.75, solid: true },
  { id: "bbq", kind: "bbq", x: 13.6, z: 18, w: 0.9, d: 0.6, h: 1, facing: WEST, solid: true },
  { id: "garden-bench", kind: "gardenBench", x: -13.9, z: 13, w: 0.6, d: 1.8, h: 0.8, facing: EAST, solid: true },
  { id: "tree-1", kind: "tree", x: 11.5, z: 22.5, w: 0.6, d: 0.6, h: 4, solid: true },
  { id: "tree-2", kind: "tree", x: -12, z: 23, w: 0.6, d: 0.6, h: 4.5, solid: true },
  { id: "tree-3", kind: "tree", x: 12.5, z: 12.5, w: 0.6, d: 0.6, h: 3.5, solid: true },
  // Bathroom: two toilet stalls, two showers, a bathtub, sinks with a long mirror, and the laundry corner
  { id: "bathroom-rug", kind: "rug", x: 8, z: -12.6, w: 5, d: 1.4, h: 0.02, solid: false },
  { id: "partition-1", kind: "partition", x: 3.2, z: -15.05, w: 0.06, d: 1.6, h: 2.1, solid: true },
  { id: "partition-2", kind: "partition", x: 5.2, z: -15.05, w: 0.06, d: 1.6, h: 2.1, solid: true },
  { id: "partition-3", kind: "partition", x: 7.2, z: -15.05, w: 0.06, d: 1.6, h: 2.1, solid: true },
  { id: "toilet-1", kind: "toilet", x: 4.2, z: -15.45, w: 0.45, d: 0.7, h: 0.8, facing: SOUTH, solid: true },
  { id: "toilet-2", kind: "toilet", x: 6.2, z: -15.45, w: 0.45, d: 0.7, h: 0.8, facing: SOUTH, solid: true },
  { id: "shower-1", kind: "shower", x: 8.3, z: -15.1, w: 1.4, d: 1.4, h: 2.3, facing: SOUTH, solid: true },
  { id: "shower-2", kind: "shower", x: 9.9, z: -15.1, w: 1.4, d: 1.4, h: 2.3, facing: SOUTH, solid: true },
  { id: "bathtub", kind: "bathtub", x: 13.7, z: -15.3, w: 2, d: 0.95, h: 0.6, facing: SOUTH, solid: true },
  { id: "sink-1", kind: "sink", x: 5.2, z: -10.45, w: 0.9, d: 0.55, h: 0.9, facing: NORTH, solid: true },
  { id: "sink-2", kind: "sink", x: 6.5, z: -10.45, w: 0.9, d: 0.55, h: 0.9, facing: NORTH, solid: true },
  { id: "sink-3", kind: "sink", x: 7.8, z: -10.45, w: 0.9, d: 0.55, h: 0.9, facing: NORTH, solid: true },
  { id: "bathroom-mirror", kind: "mirror", x: 6.5, z: -10.18, w: 3.4, d: 0.06, h: 2, facing: NORTH, solid: false },
  { id: "washer-1", kind: "washer", x: 14.45, z: -11.2, w: 0.65, d: 0.65, h: 0.9, facing: WEST, solid: true },
  { id: "washer-2", kind: "washer", x: 14.45, z: -12.1, w: 0.65, d: 0.65, h: 0.9, facing: WEST, solid: true },
  { id: "towel-rack", kind: "towelRack", x: 11.6, z: -15.75, w: 0.9, d: 0.12, h: 1.2, facing: SOUTH, solid: false },
  // Party room: DJ booth on a stage, light-up dance floor under a disco ball, speaker stacks, a bar and sofas
  { id: "party-stage", kind: "stage", x: -29.6, z: 0, w: 2.6, d: 8, h: 0.3, solid: false },
  { id: "dj-booth", kind: "djBooth", x: -29.2, z: 0, w: 1, d: 2.8, h: 1.15, facing: EAST, solid: true },
  { id: "party-dj", kind: "dj", x: -30.35, z: 0, w: 0.6, d: 0.6, h: 1.9, facing: EAST, solid: true },
  { id: "party-speaker-1", kind: "speaker", x: -29.9, z: -3.4, w: 0.7, d: 0.7, h: 2.2, facing: EAST, solid: true },
  { id: "party-speaker-2", kind: "speaker", x: -29.9, z: 3.4, w: 0.7, d: 0.7, h: 2.2, facing: EAST, solid: true },
  { id: "dance-floor", kind: "danceFloor", x: -22.5, z: 0, w: 8, d: 8, h: 0.04, solid: false },
  { id: "disco-ball", kind: "discoBall", x: -22.5, z: 0, w: 0.7, d: 0.7, h: 4.8, solid: false },
  { id: "party-bar", kind: "counter", x: -22.5, z: -9.3, w: 6, d: 0.9, h: 1.05, facing: SOUTH, solid: true },
  { id: "party-sofa-1", kind: "sofa", x: -16.2, z: -5.5, w: 1, d: 3.4, h: 0.85, facing: WEST, solid: true },
  { id: "party-sofa-2", kind: "sofa", x: -16.2, z: 3.5, w: 1, d: 3.4, h: 0.85, facing: WEST, solid: true },
  { id: "party-light-1", kind: "partyLight", x: -27, z: -7, w: 0.3, d: 0.3, h: 6.6, solid: false },
  { id: "party-light-2", kind: "partyLight", x: -27, z: 7, w: 0.3, d: 0.3, h: 6.6, solid: false },
  { id: "party-light-3", kind: "partyLight", x: -18, z: -7, w: 0.3, d: 0.3, h: 6.6, solid: false },
  { id: "party-light-4", kind: "partyLight", x: -18, z: 7, w: 0.3, d: 0.3, h: 6.6, solid: false },
  // Light switches by each room's door (wall plates, 1.2 m up)
  ...LIGHT_SWITCHES.map((sw): Furniture => ({ id: `light-${sw.area}`, kind: "lightSwitch", x: sw.x, z: sw.z, w: 0.12, d: 0.12, h: 1.2, facing: sw.facing, solid: false })),
  // Games hall: every game station is a solid piece of furniture except the wall-mounted dartboard.
  ...GAME_STATIONS.map(
    (s): Furniture => ({ id: s.id, kind: s.kind, x: s.x, z: s.z, w: s.w, d: s.d, h: s.h, facing: s.facing, solid: s.kind !== "dartboard" }),
  ),
];

/**
 * The wall above each doorway, from the top of the door up to the ceiling.
 * Render-only: it's overhead, so it never blocks walking.
 */
export interface DoorHeader {
  doorId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Bottom of the header (top of the door opening) and top (the ceiling). */
  bottom: number;
  top: number;
}

export const DOOR_HEADERS: readonly DoorHeader[] = DOORS.map((door) => {
  const half = door.w / 2;
  const t = WALL_THICKNESS / 2;
  return door.along === "x"
    ? { doorId: door.id, minX: door.x - half, maxX: door.x + half, minZ: door.z - t, maxZ: door.z + t, bottom: door.h, top: WALL_HEIGHT }
    : { doorId: door.id, minX: door.x - t, maxX: door.x + t, minZ: door.z - half, maxZ: door.z + half, bottom: door.h, top: WALL_HEIGHT };
});

const STATIC_COLLIDERS: readonly Box2D[] = [
  ...WALLS,
  ...FURNITURE.filter((f) => f.solid).map((f) => ({
    minX: f.x - f.w / 2,
    maxX: f.x + f.w / 2,
    minZ: f.z - f.d / 2,
    maxZ: f.z + f.d / 2,
  })),
];

/**
 * Walls, solid furniture, every door that is not in `openDoorIds`, and any
 * `extra` boxes (solid props standing on the floor — see props.ts).
 */
export function collidersFor(openDoorIds: ReadonlySet<string>, extra: readonly Box2D[] = []): readonly Box2D[] {
  return [...STATIC_COLLIDERS, ...DOORS.filter((d) => !openDoorIds.has(d.id)).map(doorBox), ...extra];
}

/** Static solids only (walls + fixed furniture), e.g. to check where a prop may be put down. */
export function staticColliders(): readonly Box2D[] {
  return STATIC_COLLIDERS;
}

/** Everything a player can bump into while every door is shut. */
export const COLLIDERS: readonly Box2D[] = collidersFor(new Set());

export function areaAt(x: number, z: number): Area | undefined {
  return AREAS.find((a) => x >= a.minX && x < a.maxX && z >= a.minZ && z < a.maxZ);
}

/** Fixed "house camera" per area for spectators: mounted high in a corner, looking in. */
export interface HouseCamera {
  id: AreaId;
  label: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export const HOUSE_CAMERAS: readonly HouseCamera[] = [
  { id: "lounge", label: "Lounge", position: { x: 14.3, y: 2.8, z: 9.3 }, target: { x: 4, y: 0.8, z: 2 } },
  { id: "kitchen", label: "Kitchen", position: { x: 1.7, y: 2.8, z: -2.7 }, target: { x: 9, y: 0.8, z: -7 } },
  { id: "bedroom", label: "Bedroom", position: { x: -5.7, y: 2.8, z: -2.7 }, target: { x: -10.5, y: 0.6, z: -7.5 } },
  { id: "gym", label: "Gym", position: { x: -5.7, y: 2.8, z: 9.3 }, target: { x: -11, y: 0.8, z: 3 } },
  { id: "garden", label: "Garden", position: { x: 0, y: 6, z: 25.5 }, target: { x: 0, y: 0, z: 14 } },
  { id: "diary", label: "Diary Room", position: { x: 0.3, y: 2.4, z: -2.7 }, target: { x: -2, y: 1, z: -8.3 } },
  { id: "games", label: "Games Hall", position: { x: 32.4, y: 3.4, z: 9.4 }, target: { x: 22, y: 0.6, z: -3 } },
  // Looks at the sinks and laundry corner; the toilet stalls and showers face away from it.
  { id: "bathroom", label: "Bathroom", position: { x: 1.6, y: 2.6, z: -15.4 }, target: { x: 10, y: 0.8, z: -11 } },
  { id: "party", label: "Party Room", position: { x: -15.8, y: 3.6, z: 9.4 }, target: { x: -25, y: 0.6, z: -2 } },
];
