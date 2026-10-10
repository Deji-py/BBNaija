import { FURNITURE, PLAYER_RADIUS, areaAt, staticColliders, type Box2D } from "./house.js";

/**
 * Props: light objects housemates can pick up, carry and put down anywhere —
 * on the floor or on a table. Heavy furniture (sofa, beds, fridge…) is fixed
 * and lives in FURNITURE instead.
 *
 * The server owns where every prop is (it's synced state), so everyone sees
 * the same house; this file holds the rules both sides use.
 */

export type PropKind =
  | "plant"
  | "vegBowl"
  | "drinks"
  | "stool"
  | "sideTable"
  | "nightstand"
  | "floorLamp"
  | "books"
  | "vase"
  | "kettlebell"
  | "yogaMat"
  | "ball"
  | "gardenChair"
  | "basket";

export interface PropSpec {
  id: string;
  kind: PropKind;
  /** Shown in prompts: "Pick up the {label}". */
  label: string;
  /** Starting position; y is the height of whatever it stands on (0 = floor). */
  x: number;
  z: number;
  y: number;
  rotY: number;
  /** Footprint along local X (w) and Z (d), and height. */
  w: number;
  d: number;
  h: number;
  /** Blocks walking while standing on the floor (chairs, stools, small tables). */
  solid: boolean;
}

const SOUTH = 0;
const NORTH = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

export const PROPS: readonly PropSpec[] = [
  // Lounge
  { id: "plant-lounge", kind: "plant", label: "plant", x: -3.6, z: 8.4, y: 0, rotY: 0, w: 0.4, d: 0.4, h: 0.7, solid: false },
  { id: "side-table", kind: "sideTable", label: "side table", x: -3.9, z: 5.5, y: 0, rotY: 0, w: 0.5, d: 0.5, h: 0.55, solid: true },
  { id: "floor-lamp", kind: "floorLamp", label: "floor lamp", x: -4.45, z: 7.6, y: 0, rotY: 0, w: 0.35, d: 0.35, h: 1.6, solid: false },
  { id: "books", kind: "books", label: "books", x: 11.5, z: 4.6, y: 0.45, rotY: 0.3, w: 0.3, d: 0.22, h: 0.15, solid: false },
  { id: "vase-lounge", kind: "vase", label: "vase", x: -2.7, z: 9.62, y: 2.2, rotY: 0, w: 0.2, d: 0.2, h: 0.35, solid: false },
  // Kitchen
  { id: "plant-kitchen", kind: "plant", label: "plant", x: 2.4, z: -3.2, y: 0, rotY: 0, w: 0.4, d: 0.4, h: 0.7, solid: false },
  { id: "fruit-bowl", kind: "vegBowl", label: "fruit bowl", x: 8, z: -5.5, y: 0.75, rotY: 0, w: 0.4, d: 0.4, h: 0.2, solid: false },
  { id: "veg-bowl", kind: "vegBowl", label: "vegetable bowl", x: 8.6, z: -9.35, y: 0.95, rotY: 0, w: 0.4, d: 0.4, h: 0.2, solid: false },
  { id: "fridge-drinks", kind: "drinks", label: "bottles", x: 12.6, z: -8.2, y: 0, rotY: 0, w: 0.6, d: 0.35, h: 0.3, solid: false },
  { id: "stool-1", kind: "stool", label: "bar stool", x: 3.2, z: -5.2, y: 0, rotY: NORTH, w: 0.42, d: 0.42, h: 0.75, solid: true },
  { id: "stool-2", kind: "stool", label: "bar stool", x: 4.4, z: -5.2, y: 0, rotY: NORTH, w: 0.42, d: 0.42, h: 0.75, solid: true },
  // Bedroom
  { id: "nightstand-1", kind: "nightstand", label: "nightstand", x: -11.7, z: -9.5, y: 0, rotY: SOUTH, w: 0.5, d: 0.45, h: 0.55, solid: true },
  { id: "nightstand-2", kind: "nightstand", label: "nightstand", x: -8.3, z: -9.5, y: 0, rotY: SOUTH, w: 0.5, d: 0.45, h: 0.55, solid: true },
  { id: "plant-bedroom", kind: "plant", label: "plant", x: -14.4, z: -6.2, y: 0, rotY: 0, w: 0.4, d: 0.4, h: 0.7, solid: false },
  { id: "vase-vanity", kind: "vase", label: "vase", x: -12.3, z: -2.45, y: 0.8, rotY: 0, w: 0.2, d: 0.2, h: 0.35, solid: false },
  { id: "laundry", kind: "basket", label: "laundry basket", x: -6.2, z: -2.7, y: 0, rotY: 0, w: 0.5, d: 0.4, h: 0.45, solid: false },
  // Gym
  { id: "kettlebell-1", kind: "kettlebell", label: "kettlebell", x: -8.2, z: 8.5, y: 0, rotY: 0, w: 0.25, d: 0.25, h: 0.3, solid: false },
  { id: "kettlebell-2", kind: "kettlebell", label: "kettlebell", x: -7.8, z: 8.5, y: 0, rotY: 0, w: 0.25, d: 0.25, h: 0.3, solid: false },
  { id: "yoga-mat", kind: "yogaMat", label: "yoga mat", x: -8.6, z: 4.6, y: 0, rotY: 0, w: 0.6, d: 1.8, h: 0.02, solid: false },
  { id: "medicine-ball", kind: "ball", label: "medicine ball", x: -9.6, z: 6.2, y: 0, rotY: 0, w: 0.35, d: 0.35, h: 0.35, solid: false },
  // Diary room
  { id: "plant-diary", kind: "plant", label: "plant", x: 0.4, z: -9.4, y: 0, rotY: 0, w: 0.4, d: 0.4, h: 0.7, solid: false },
  // Garden
  { id: "garden-chair-1", kind: "gardenChair", label: "garden chair", x: 7.3, z: 21.5, y: 0, rotY: EAST, w: 0.55, d: 0.55, h: 0.85, solid: true },
  { id: "garden-chair-2", kind: "gardenChair", label: "garden chair", x: 9.7, z: 21.5, y: 0, rotY: WEST, w: 0.55, d: 0.55, h: 0.85, solid: true },
  { id: "garden-chair-3", kind: "gardenChair", label: "garden chair", x: 8.5, z: 20.4, y: 0, rotY: SOUTH, w: 0.55, d: 0.55, h: 0.85, solid: true },
  { id: "garden-chair-4", kind: "gardenChair", label: "garden chair", x: 8.5, z: 22.6, y: 0, rotY: NORTH, w: 0.55, d: 0.55, h: 0.85, solid: true },
  { id: "beach-ball", kind: "ball", label: "beach ball", x: 1.8, z: 13.2, y: 0, rotY: 0, w: 0.45, d: 0.45, h: 0.45, solid: false },
];

export const PROP_BY_ID: ReadonlyMap<string, PropSpec> = new Map(PROPS.map((p) => [p.id, p]));

/** How close (m) you must be to a prop's footprint to pick it up. */
export const PROP_PICKUP_RANGE = 1.1;
/** How far in front of you a prop lands when you put it down. */
export const PROP_DROP_DISTANCE = 0.85;

/** Where a prop currently is (synced state shape; also used for the starting layout). */
export interface PropPose {
  x: number;
  z: number;
  y: number;
  rotY: number;
  /** Session id of whoever is carrying it ("" = nobody). */
  heldBy: string;
}

/** Footprint of a prop at a pose, as an axis-aligned box (rotation snapped to the nearest quarter turn). */
export function propBox(spec: PropSpec, x: number, z: number, rotY: number): Box2D {
  const sideways = Math.abs(Math.sin(rotY)) > 0.5;
  const hw = (sideways ? spec.d : spec.w) / 2;
  const hd = (sideways ? spec.w : spec.d) / 2;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd };
}

/** Distance from a point to a prop's footprint (0 if inside). */
export function distanceToProp(spec: PropSpec, pose: PropPose, x: number, z: number): number {
  const b = propBox(spec, pose.x, pose.z, pose.rotY);
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** Colliders for solid props standing on the floor (held props and props on tables don't block walking). */
export function propColliders(poses: Iterable<[string, PropPose]>): Box2D[] {
  const out: Box2D[] = [];
  for (const [id, pose] of poses) {
    const spec = PROP_BY_ID.get(id);
    if (spec?.solid && !pose.heldBy && pose.y === 0) out.push(propBox(spec, pose.x, pose.z, pose.rotY));
  }
  return out;
}

/** Furniture tops props can be set on, with their height. */
export interface Surface extends Box2D {
  id: string;
  top: number;
}

const SURFACE_KINDS = new Set(["coffeeTable", "diningTable", "counter", "island", "gardenTable", "vanity", "billiards", "bookshelf"]);

// FURNITURE footprints are already in world axes, so no rotation is needed here.
export const SURFACES: readonly Surface[] = FURNITURE.filter((f) => SURFACE_KINDS.has(f.kind)).map((f) => ({
  id: f.id,
  minX: f.x - f.w / 2,
  maxX: f.x + f.w / 2,
  minZ: f.z - f.d / 2,
  maxZ: f.z + f.d / 2,
  top: f.h,
}));

/** Solid furniture that is *not* a surface: you can't put things inside or on top of these. */
const BLOCKING: readonly Box2D[] = staticColliders().filter(
  (b) => !SURFACES.some((s) => s.minX === b.minX && s.maxX === b.maxX && s.minZ === b.minZ && s.maxZ === b.maxZ),
);

function overlaps(a: Box2D, b: Box2D, margin = 0): boolean {
  return a.minX < b.maxX + margin && a.maxX > b.minX - margin && a.minZ < b.maxZ + margin && a.maxZ > b.minZ - margin;
}

export type Placement = { ok: true; x: number; z: number; y: number; rotY: number } | { ok: false; reason: string };

/**
 * Where a carried prop lands when put down by someone at (px, pz) facing `facing`:
 * in front of them, on a table if it's over one, otherwise on the floor.
 * Refuses spots inside walls or heavy furniture, outside the house and garden,
 * or (for solid props on the floor) on top of a person or another solid prop.
 */
export function placeProp(
  spec: PropSpec,
  px: number,
  pz: number,
  facing: number,
  others: { players: Array<{ x: number; z: number }>; props: Iterable<[string, PropPose]>; closedDoors: readonly Box2D[] },
): Placement {
  const x = px + Math.sin(facing) * PROP_DROP_DISTANCE;
  const z = pz + Math.cos(facing) * PROP_DROP_DISTANCE;
  const rotY = facing;
  const box = propBox(spec, x, z, rotY);

  if (!areaAt(x, z) || !areaAt(box.minX, box.minZ) || !areaAt(box.maxX, box.maxZ)) {
    return { ok: false, reason: "That spot is outside the house" };
  }

  // On a table/counter? The prop's centre must be over the surface.
  const surface = SURFACES.find((s) => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ);
  if (surface) return { ok: true, x, z, y: surface.top, rotY };

  if (BLOCKING.some((b) => overlaps(box, b)) || others.closedDoors.some((b) => overlaps(box, b))) {
    return { ok: false, reason: "There's something in the way" };
  }
  if (SURFACES.some((s) => overlaps(box, s))) return { ok: false, reason: "Put it on the table, or clear of it" };

  if (spec.solid) {
    const clearOfPeople = others.players.every((p) => !overlaps(box, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, PLAYER_RADIUS + 0.05));
    if (!clearOfPeople) return { ok: false, reason: "Someone's standing there" };
    for (const [id, pose] of others.props) {
      const other = PROP_BY_ID.get(id);
      if (other?.solid && !pose.heldBy && pose.y === 0 && overlaps(box, propBox(other, pose.x, pose.z, pose.rotY))) {
        return { ok: false, reason: "There's something in the way" };
      }
    }
  }
  return { ok: true, x, z, y: 0, rotY };
}
