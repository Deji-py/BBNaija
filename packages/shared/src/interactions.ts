import { AREAS, DOORS, FURNITURE, LIGHT_SWITCHES, PLAYER_RADIUS, doorBox, doorById, type Furniture } from "./house.js";
import type { Vec2 } from "./movement.js";

/** Things a housemate can be doing with an object. Each has its own animation. */
export type Activity = "sit" | "sleep" | "cook" | "workout" | "swim" | "drink" | "eat" | "toilet" | "shower" | "bath" | "wash" | "laundry";

/** Emotes from the emote wheel (hold Q). 1 and 2 are shortcuts for wave and dance. */
export const EMOTES = [
  "wave",
  "dance",
  "clap",
  "laugh",
  "cry",
  "facepalm",
  "shrug",
  "point",
  "thumbsUp",
  "bow",
  "salute",
  "cheer",
  "think",
  "sulk",
  "flex",
  "blowKiss",
  "nod",
  "shakeHead",
  "sitFloor",
  "lieDown",
] as const;
export type EmoteName = (typeof EMOTES)[number];

/** Emotes that last until you move (the rest play for a couple of seconds). */
export const LOOPING_EMOTES: ReadonlySet<EmoteName> = new Set(["dance", "sitFloor", "lieDown"]);

/** Wheel labels and icons. */
export const EMOTE_INFO: Readonly<Record<EmoteName, { label: string; icon: string }>> = {
  wave: { label: "Wave", icon: "👋" },
  dance: { label: "Dance", icon: "💃" },
  clap: { label: "Clap", icon: "👏" },
  laugh: { label: "Laugh", icon: "😂" },
  cry: { label: "Cry", icon: "😭" },
  facepalm: { label: "Facepalm", icon: "🤦" },
  shrug: { label: "Shrug", icon: "🤷" },
  point: { label: "Point", icon: "👉" },
  thumbsUp: { label: "Thumbs up", icon: "👍" },
  bow: { label: "Bow", icon: "🙇" },
  salute: { label: "Salute", icon: "🫡" },
  cheer: { label: "Cheer", icon: "🙌" },
  think: { label: "Think", icon: "🤔" },
  sulk: { label: "Sulk", icon: "😒" },
  flex: { label: "Flex", icon: "💪" },
  blowKiss: { label: "Blow a kiss", icon: "😘" },
  nod: { label: "Nod", icon: "🙂" },
  shakeHead: { label: "Shake head", icon: "🙅" },
  sitFloor: { label: "Sit on the floor", icon: "🧘" },
  lieDown: { label: "Lie down", icon: "🛌" },
};

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

/** A door. Shut, it blocks the doorway; open, people walk through. */
export interface DoorInteractable extends InteractableBase {
  kind: "door";
  promptOff: string;
}

/** A room's light switch. Toggles that room's lights for everyone. */
export interface LightInteractable extends InteractableBase {
  kind: "light";
  promptOff: string;
}

/** Only usable during a task (e.g. the fridge and counter in the cooking challenge). */
export interface TaskInteractable extends InteractableBase {
  kind: "task";
}

export type Interactable = SlotInteractable | PoolInteractable | ToggleInteractable | DoorInteractable | TaskInteractable | LightInteractable;

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
  {
    id: "drinks",
    prompt: "Pour a drink",
    range: 1.6,
    kind: "slots",
    activity: "drink",
    slots: [11.15, 11.85].map((x) => ({ x, z: 5.55, rotY: NORTH, exitX: x, exitZ: 6.3 })),
  },
  {
    id: "chopping-board",
    prompt: "Chop the vegetables",
    range: 1.2,
    kind: "slots",
    activity: "cook",
    slots: [{ x: 5.4, z: -8.35, rotY: NORTH, exitX: 5.4, exitZ: -7.6 }],
  },
  {
    id: "chair-1",
    prompt: "Sit down and eat",
    range: 1.1,
    kind: "slots",
    activity: "eat",
    slots: [{ x: 7.2, z: -4.15, rotY: NORTH, exitX: 7.2, exitZ: -3.35 }],
  },
  {
    id: "chair-2",
    prompt: "Sit down and eat",
    range: 1.1,
    kind: "slots",
    activity: "eat",
    slots: [{ x: 8.8, z: -4.15, rotY: NORTH, exitX: 8.8, exitZ: -3.35 }],
  },
  {
    id: "chair-3",
    prompt: "Sit down and eat",
    range: 1.1,
    kind: "slots",
    activity: "eat",
    slots: [{ x: 7.2, z: -6.85, rotY: SOUTH, exitX: 7.2, exitZ: -7.65 }],
  },
  {
    id: "chair-4",
    prompt: "Sit down and eat",
    range: 1.1,
    kind: "slots",
    activity: "eat",
    slots: [{ x: 8.8, z: -6.85, rotY: SOUTH, exitX: 8.8, exitZ: -7.65 }],
  },
  {
    id: "armchair-1",
    prompt: "Sit in the armchair",
    range: 1.1,
    kind: "slots",
    activity: "sit",
    slots: [{ x: 11.5, z: 1.25, rotY: SOUTH, exitX: 11.5, exitZ: 2.05 }],
  },
  {
    id: "armchair-2",
    prompt: "Sit in the armchair",
    range: 1.1,
    kind: "slots",
    activity: "sit",
    slots: [{ x: 11.5, z: 7.2, rotY: NORTH, exitX: 11.5, exitZ: 6.4 }],
  },
  {
    id: "armchair-3",
    prompt: "Sit in the armchair",
    range: 1.1,
    kind: "slots",
    activity: "sit",
    slots: [{ x: -3.8, z: 6.6, rotY: EAST, exitX: -3.0, exitZ: 6.6 }],
  },
  // Bathroom and laundry
  ...[4.2, 6.2].map(
    (x, i): SlotInteractable => ({
      id: `toilet-${i + 1}`,
      prompt: "Use the toilet",
      range: 1.35,
      kind: "slots",
      activity: "toilet",
      slots: [{ x, z: -15.2, rotY: SOUTH, exitX: x, exitZ: -14.3 }],
    }),
  ),
  ...[8.3, 9.9].map(
    (x, i): SlotInteractable => ({
      id: `shower-${i + 1}`,
      prompt: "Take a shower",
      range: 1.0,
      kind: "slots",
      activity: "shower",
      slots: [{ x, z: -15.1, rotY: SOUTH, exitX: x, exitZ: -13.95 }],
    }),
  ),
  {
    id: "bathtub",
    prompt: "Have a bath",
    range: 1.1,
    kind: "slots",
    activity: "bath",
    slots: [{ x: 13.25, z: -15.3, rotY: EAST, exitX: 13.6, exitZ: -14.35 }],
  },
  ...[5.2, 6.5, 7.8].map(
    (x, i): SlotInteractable => ({
      id: `sink-${i + 1}`,
      prompt: "Wash your hands and face",
      range: 1.0,
      kind: "slots",
      activity: "wash",
      slots: [{ x, z: -11.15, rotY: NORTH, exitX: x, exitZ: -11.15 }],
    }),
  ),
  ...[-11.2, -12.1].map(
    (z, i): SlotInteractable => ({
      id: `washer-${i + 1}`,
      prompt: "Do your laundry",
      range: 1.1,
      kind: "slots",
      activity: "laundry",
      slots: [{ x: 13.7, z, rotY: EAST, exitX: 13.7, exitZ: z }],
    }),
  ),
  { id: "pool", prompt: "Swim in the pool", range: 1.0, kind: "pool", activity: "swim", capacity: 6 },
  { id: "tv", prompt: "Turn the TV on", promptOff: "Turn the TV off", range: 1.8, kind: "toggle" },
  ...DOORS.map(
    (door): DoorInteractable => ({
      id: door.id,
      prompt: `Open the ${door.label}`,
      promptOff: `Close the ${door.label}`,
      range: 1.5,
      kind: "door",
    }),
  ),
  ...LIGHT_SWITCHES.map((sw): LightInteractable => {
    const room = AREAS.find((a) => a.id === sw.area)?.label ?? sw.area;
    return { id: `light-${sw.area}`, prompt: `Turn the ${room} lights on`, promptOff: `Turn the ${room} lights off`, range: 1.2, kind: "light" };
  }),
  { id: "dj-booth", prompt: "Start the party 🎉", promptOff: "Stop the party", range: 1.6, kind: "toggle" },
  { id: "home-theater", prompt: "Turn the sound bar on", promptOff: "Turn the sound bar off", range: 1.8, kind: "toggle" },
  // Cooking challenge steps.
  { id: "fridge", prompt: "Grab ingredients", range: 1.2, kind: "task" },
  { id: "counter", prompt: "Prep the ingredients", range: 1.2, kind: "task" },
];

export const INTERACTABLE_BY_ID: ReadonlyMap<string, Interactable> = new Map(INTERACTABLES.map((i) => [i.id, i]));

const FURNITURE_BY_ID: ReadonlyMap<string, Furniture> = new Map(FURNITURE.map((f) => [f.id, f]));

/** Distance from a point to an object's footprint (0 if inside). */
export function distanceToObject(id: string, x: number, z: number): number {
  const f = FURNITURE_BY_ID.get(id);
  if (f) {
    const dx = Math.max(f.x - f.w / 2 - x, 0, x - (f.x + f.w / 2));
    const dz = Math.max(f.z - f.d / 2 - z, 0, z - (f.z + f.d / 2));
    return Math.hypot(dx, dz);
  }
  const door = doorById(id);
  if (!door) return Infinity;
  const b = doorBox(door);
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** The closest interactable within its range of (x, z) that passes `usable`, if any. */
export function nearestInteractable(
  x: number,
  z: number,
  usable: (it: Interactable) => boolean = () => true,
): Interactable | undefined {
  let best: Interactable | undefined;
  let bestDist = Infinity;
  for (const it of INTERACTABLES) {
    if (!usable(it)) continue;
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
export function poolInterior() {
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
  if (!it || it.kind === "toggle" || it.kind === "task" || it.kind === "door" || it.kind === "light") return null;
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
