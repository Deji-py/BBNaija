import type { AreaId } from "./types.js";

/**
 * House layout data, shared by client (rendering) and server (collision, from M2).
 *
 * Coordinates are metres on the ground plane: +X is east, +Z is south, Y is up.
 *
 *            x=-15        x=-5       x=1                x=15
 *     z=-10  ┌────────────┬─────────┬───────────────────┐
 *            │  Bedroom   │  Diary  │      Kitchen      │
 *     z=-2   ├───door─────┼──door───┼──────door─────────┤
 *            │    Gym     door         Lounge           │
 *     z=10   ├────────────┴───────────────door──────────┤
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
  | "rug";

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

export const WALL_HEIGHT = 3;
export const FENCE_HEIGHT = 1.2;
export const WALL_THICKNESS = 0.3;

/** Player collision radius in metres. */
export const PLAYER_RADIUS = 0.35;
/** Walking speed in metres per second. */
export const WALK_SPEED = 4.5;

export const SPAWN_POINT = { x: 5, z: 4 } as const;

export const AREAS: readonly Area[] = [
  { id: "bedroom", label: "Bedroom", minX: -15, maxX: -5, minZ: -10, maxZ: -2 },
  { id: "diary", label: "Diary Room", minX: -5, maxX: 1, minZ: -10, maxZ: -2 },
  { id: "kitchen", label: "Kitchen", minX: 1, maxX: 15, minZ: -10, maxZ: -2 },
  { id: "gym", label: "Gym", minX: -15, maxX: -5, minZ: -2, maxZ: 10 },
  { id: "lounge", label: "Lounge", minX: -5, maxX: 15, minZ: -2, maxZ: 10 },
  { id: "garden", label: "Garden", minX: -15, maxX: 15, minZ: 10, maxZ: 26 },
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
  ...wallAlongX(-10, -15, 15, []),
  ...wallAlongZ(-15, -10, 10, []),
  ...wallAlongZ(15, -10, 10, []),
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

const SOUTH = 0;
const NORTH = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

export const FURNITURE: readonly Furniture[] = [
  // Lounge
  { id: "lounge-rug", kind: "rug", x: 10.5, z: 4, w: 5, d: 5, h: 0.02, solid: false },
  { id: "sofa", kind: "sofa", x: 9, z: 4, w: 1, d: 4, h: 0.85, facing: EAST, solid: true },
  { id: "coffee-table", kind: "coffeeTable", x: 11.5, z: 4, w: 1, d: 2, h: 0.45, solid: true },
  { id: "tv", kind: "tv", x: 14.5, z: 4, w: 0.6, d: 3, h: 1.7, facing: WEST, solid: true },
  // Kitchen
  { id: "counter", kind: "counter", x: 7, z: -9.4, w: 8, d: 1, h: 0.95, facing: SOUTH, solid: true },
  { id: "stove", kind: "stove", x: 11.8, z: -9.4, w: 1.4, d: 1, h: 0.95, facing: SOUTH, solid: true },
  { id: "fridge", kind: "fridge", x: 14, z: -9.3, w: 1.2, d: 1.2, h: 2, facing: SOUTH, solid: true },
  { id: "dining-table", kind: "diningTable", x: 8, z: -5.5, w: 3, d: 1.5, h: 0.75, solid: true },
  // Bedroom
  { id: "bed-1", kind: "bed", x: -13.4, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  { id: "bed-2", kind: "bed", x: -10, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  { id: "bed-3", kind: "bed", x: -6.6, z: -8.5, w: 1.6, d: 2.6, h: 0.6, facing: SOUTH, solid: true },
  // Gym
  { id: "treadmill-1", kind: "treadmill", x: -13, z: 2, w: 1, d: 2.2, h: 1.3, facing: NORTH, solid: true },
  { id: "treadmill-2", kind: "treadmill", x: -11, z: 2, w: 1, d: 2.2, h: 1.3, facing: NORTH, solid: true },
  { id: "weights", kind: "weights", x: -10, z: 9.2, w: 3, d: 0.8, h: 1.2, facing: NORTH, solid: true },
  { id: "bench", kind: "bench", x: -12.5, z: 6.5, w: 0.6, d: 1.6, h: 0.5, solid: true },
  // Diary room
  { id: "diary-chair", kind: "diaryChair", x: -2, z: -8.3, w: 1.3, d: 1.1, h: 1.2, facing: SOUTH, solid: true },
  // Garden
  { id: "pool", kind: "pool", x: -3, z: 18, w: 10, d: 6, h: 0.1, solid: true },
  { id: "lounger-1", kind: "lounger", x: 7.5, z: 16, w: 0.8, d: 2, h: 0.4, facing: SOUTH, solid: true },
  { id: "lounger-2", kind: "lounger", x: 9.5, z: 16, w: 0.8, d: 2, h: 0.4, facing: SOUTH, solid: true },
  { id: "tree-1", kind: "tree", x: 11.5, z: 22.5, w: 0.6, d: 0.6, h: 4, solid: true },
  { id: "tree-2", kind: "tree", x: -12, z: 23, w: 0.6, d: 0.6, h: 4.5, solid: true },
  { id: "tree-3", kind: "tree", x: 12.5, z: 12.5, w: 0.6, d: 0.6, h: 3.5, solid: true },
];

/** Everything a player can bump into. */
export const COLLIDERS: readonly Box2D[] = [
  ...WALLS,
  ...FURNITURE.filter((f) => f.solid).map((f) => ({
    minX: f.x - f.w / 2,
    maxX: f.x + f.w / 2,
    minZ: f.z - f.d / 2,
    maxZ: f.z + f.d / 2,
  })),
];

export function areaAt(x: number, z: number): Area | undefined {
  return AREAS.find((a) => x >= a.minX && x < a.maxX && z >= a.minZ && z < a.maxZ);
}
