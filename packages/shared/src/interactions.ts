import { FURNITURE, PLAYER_RADIUS, type Furniture } from "./house.js";
import type { Vec2 } from "./movement.js";

/** Things a housemate can be doing with an object. Each has its own animation. */
export type Activity = "sit" | "sleep" | "cook" | "workout" | "swim";

export type EmoteName = "wave" | "dance";
export const EMOTES: readonly EmoteName[] = ["wave", "dance"];

/** Where a player is placed while using an object, and where they stand when they get up. */
export interface Slot {
  x: number;
  z: number;
  rotY: number;
  exitX: number;
  exitZ: number;
}

interface InteractableBase {
  /** Same id as the furniture it belongs to. */
  id: string;
  /** Shown in the "Press E" prompt, e.g. "Sit on the sofa". */
  prompt: string;
  /** How close (m) you must be to the object's footprint to use it. */
  range: number;
}

/** Fixed spots: sofa seats, beds, treadmills, the stove, the diary chair. */
export interface SlotInteractable extends InteractableBase {
  kind: "slots";
  activity: Activity;
  slots: readonly Slot[];
}

/** The pool: swim wherever you got in, up to `capacity` swimmers. */
export interface PoolInteractable extends InteractableBase {
  kind: "pool";
  activity: "swim";
  capacity: number;
}

/** A shared on/off switch (the TV). Doesn't change what the player is doing. */
export interface ToggleInteractable extends InteractableBase {
  kind: "toggle";
  promptOff: string;
}

export type Interactable = SlotInteractable | PoolInteractable | ToggleInteractable;

const EAST = Math.PI / 2;
const NORTH = Math.PI;
const SOUTH = 0;

const bed = (id: string, x: number): SlotInteractable => ({
  id,
  prompt: "Sleep in the bed",
  range: 1.2,
  kind: "slots",
  activity: "sleep",
  // Lying with feet at the south end; the avatar's sleep pose tips it back so the head reaches the pillow.
  slots: [{ x, z: -7.5, rotY: SOUTH, exitX: x, exitZ: -6.7 }],
});

const treadmill = (id: string, x: number): SlotInteractable => ({
  id,
  prompt: "Run on the treadmill",
  range: 1.2,
  kind: "slots",
  activity: "workout",
  slots: [{ x, z: 2.2, rotY: NORTH, exitX: x, exitZ: 3.6 }],
});

export const INTERACTABLES: readonly Interactable[] = [
  {
    id: "sofa",
    prompt: "Sit on the sofa",
    range: 1.2,
    kind: "slots",
    activity: "sit",
    slots: [2.75, 4, 5.25].map((z) => ({ x: 9.1, z, rotY: EAST, exitX: 10.2, exitZ: z })),
  },
  {
    id: "diary-chair",
    prompt: "Sit in the Diary Room chair",
    range: 1.2,
    kind: "slots",
    activity: "sit",
    slots: [{ x: -2, z: -8.2, rotY: SOUTH, exitX: -2, exitZ: -7.2 }],
  },
  {
    id: "stove",
    prompt: "Cook at the stove",
    range: 1.2,
    kind: "slots",
    activity: "cook",
    slots: [{ x: 11.8, z: -8.4, rotY: NORTH, exitX: 11.8, exitZ: -8.4 }],
  },
  bed("bed-1", -13.4),
  bed("bed-2", -10),
  bed("bed-3", -6.6),
  treadmill("treadmill-1", -13),
  treadmill("treadmill-2", -11),
  { id: "pool", prompt: "Swim in the pool", range: 1.0, kind: "pool", activity: "swim", capacity: 6 },
  { id: "tv", prompt: "Turn the TV on", promptOff: "Turn the TV off", range: 3, kind: "toggle" },
];

export const INTERACTABLE_BY_ID: ReadonlyMap<string, Interactable> = new Map(INTERACTABLES.map((i) => [i.id, i]));

const FURNITURE_BY_ID: ReadonlyMap<string, Furniture> = new Map(FURNITURE.map((f) => [f.id, f]));

/** Distance from a point to an object's footprint (0 if inside). */
export function distanceToObject(id: string, x: number, z: number): number {
  const f = FURNITURE_BY_ID.get(id);
  if (!f) return Infinity;
  const dx = Math.max(f.x - f.w / 2 - x, 0, x - (f.x + f.w / 2));
  const dz = Math.max(f.z - f.d / 2 - z, 0, z - (f.z + f.d / 2));
  return Math.hypot(dx, dz);
}

/** The closest interactable within its range of (x, z), if any. */
export function nearestInteractable(x: number, z: number): Interactable | undefined {
  let best: Interactable | undefined;
  let bestDist = Infinity;
  for (const it of INTERACTABLES) {
    const d = distanceToObject(it.id, x, z);
    if (d <= it.range && d < bestDist) {
      best = it;
      bestDist = d;
    }
  }
  return best;
}

const POOL_INSET = 0.8;
const MIN_SWIMMER_GAP = 1;

/** Pool interior where swimmers float: the pool rectangle shrunk by POOL_INSET. */
function poolInterior() {
  const p = FURNITURE_BY_ID.get("pool")!;
  return {
    minX: p.x - p.w / 2 + POOL_INSET,
    maxX: p.x + p.w / 2 - POOL_INSET,
    minZ: p.z - p.d / 2 + POOL_INSET,
    maxZ: p.z + p.d / 2 - POOL_INSET,
  };
}

/**
 * Chooses where a player goes when using `it`, given where everyone else is.
 * Returns null if the object is full. Positions of players already using this
 * object are passed in `occupied`.
 */
export function chooseSlot(it: SlotInteractable | PoolInteractable, from: Vec2, occupied: Vec2[]): Slot | null {
  if (it.kind === "slots") {
    const free = it.slots.filter((s) => occupied.every((o) => Math.hypot(o.x - s.x, o.z - s.z) > 0.1));
    free.sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    return free[0] ?? null;
  }
  if (occupied.length >= it.capacity) return null;
  // Swim from the nearest point inside the pool, nudged along if someone's already there.
  const r = poolInterior();
  const clampX = (x: number) => Math.min(Math.max(x, r.minX), r.maxX);
  const clampZ = (z: number) => Math.min(Math.max(z, r.minZ), r.maxZ);
  const start = { x: clampX(from.x), z: clampZ(from.z) };
  for (let i = 0; i < 24; i++) {
    const angle = i * 2.4; // golden-angle spiral outward from the entry point
    const dist = i === 0 ? 0 : 0.6 + i * 0.25;
    const x = clampX(start.x + Math.sin(angle) * dist);
    const z = clampZ(start.z + Math.cos(angle) * dist);
    if (occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= MIN_SWIMMER_GAP)) {
      const exit = activityExit("pool", x, z)!;
      return { x, z, rotY: Math.atan2(r.minX + r.maxX - 2 * x, r.minZ + r.maxZ - 2 * z), exitX: exit.x, exitZ: exit.z };
    }
  }
  return null;
}

/**
 * Where a player using object `id` at (x, z) stands when they get up.
 * Client and server both call this, so standing up can be predicted.
 */
export function activityExit(id: string, x: number, z: number): Vec2 | null {
  const it = INTERACTABLE_BY_ID.get(id);
  if (!it || it.kind === "toggle") return null;
  if (it.kind === "slots") {
    const slot = it.slots.find((s) => Math.hypot(s.x - x, s.z - z) < 0.1) ?? it.slots[0]!;
    return { x: slot.exitX, z: slot.exitZ };
  }
  // Pool: climb out over the nearest edge.
  const p = FURNITURE_BY_ID.get("pool")!;
  const margin = PLAYER_RADIUS + 0.1;
  const edges: Vec2[] = [
    { x: p.x - p.w / 2 - margin, z },
    { x: p.x + p.w / 2 + margin, z },
    { x, z: p.z - p.d / 2 - margin },
    { x, z: p.z + p.d / 2 + margin },
  ];
  edges.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return edges[0]!;
}
