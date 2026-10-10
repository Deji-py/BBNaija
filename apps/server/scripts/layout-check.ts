/**
 * Sanity checks for the house layout — run after moving furniture:
 *   pnpm layout:check
 * Rooms reachable, doors usable, seats/beds can be left, gems and props reachable.
 */
import { AREAS, COLLIDERS, GAME_STATIONS, distanceToStation, DOORS, FURNITURE, GEM_SPOTS, GEM_PICKUP_RANGE, INTERACTABLES, PLAYER_RADIUS, PROPS, SPAWN_POINT, SURFACES, WALLS, collidersFor, moveWithCollision, propBox, propColliders, type Box2D } from "@bbn/shared";
const ok = (n: string, pass: boolean, d?: unknown) => console.log(pass ? "PASS" : "FAIL", n, pass ? "" : JSON.stringify(d));
const allOpen = new Set(DOORS.map((d) => d.id));
const solids = collidersFor(allOpen, propColliders(PROPS.map((p) => [p.id, { ...p, heldBy: "" }] as [string, any])));
const inside = (x: number, z: number, b: Box2D, r = 0) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ;
// Flood fill with every door open and all props in place.
const STEP = 0.25, key = (x: number, z: number) => `${Math.round(x / STEP)},${Math.round(z / STEP)}`;
const seen = new Set<string>(), pts: { x: number; z: number }[] = [], q: { x: number; z: number }[] = [{ x: SPAWN_POINT.x, z: SPAWN_POINT.z }];
seen.add(key(q[0]!.x, q[0]!.z));
while (q.length) { const p = q.pop()!; pts.push(p); for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { let r = p; for (let i = 0; i < 2; i++) r = moveWithCollision(r, dx! * 0.125, dz! * 0.125, solids); const tx = p.x + dx! * STEP, tz = p.z + dz! * STEP; if (Math.abs(r.x - tx) > 1e-6 || Math.abs(r.z - tz) > 1e-6) continue; const k = key(tx, tz); if (!seen.has(k)) { seen.add(k); q.push({ x: tx, z: tz }); } } }
const reached = new Set(pts.map((p) => AREAS.find((a) => p.x >= a.minX && p.x < a.maxX && p.z >= a.minZ && p.z < a.maxZ)?.id));
ok("all rooms reachable (doors open, props in place)", AREAS.every((a) => reached.has(a.id)), [...reached]);
const near = (x: number, z: number, d: number) => pts.some((p) => Math.hypot(p.x - x, p.z - z) <= d);
// Spawn ring clear
const ring = Array.from({ length: 8 }, (_, i) => ({ x: SPAWN_POINT.x + Math.sin((i / 8) * Math.PI * 2) * 1.2, z: SPAWN_POINT.z + Math.cos((i / 8) * Math.PI * 2) * 1.2 }));
ok("spawn ring clear", ring.every((s) => !solids.some((b) => inside(s.x, s.z, b, PLAYER_RADIUS))), ring.filter((s) => solids.some((b) => inside(s.x, s.z, b, PLAYER_RADIUS))));
// Slot exits clear & reachable
const bad: string[] = [];
for (const it of INTERACTABLES) if (it.kind === "slots") for (const sl of it.slots) {
  if (solids.some((b) => inside(sl.exitX, sl.exitZ, b, PLAYER_RADIUS))) bad.push(`${it.id} exit blocked`);
  else if (!near(sl.exitX, sl.exitZ, 0.2)) bad.push(`${it.id} exit unreachable`);
}
ok("every seat/bed exit is clear and reachable", bad.length === 0, bad);
// Interactables reachable (within their range from a reachable point)
const fById = new Map(FURNITURE.map((f) => [f.id, f]));
const unreach: string[] = [];
for (const it of INTERACTABLES) { const f = fById.get(it.id); if (!f) continue; const box = { minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2 }; if (!pts.some((p) => Math.hypot(Math.max(box.minX - p.x, 0, p.x - box.maxX), Math.max(box.minZ - p.z, 0, p.z - box.maxZ)) <= it.range)) unreach.push(it.id); }
ok("every usable object is within reach", unreach.length === 0, unreach);
ok("every gem spot reachable", GEM_SPOTS.every((g) => near(g.x, g.z, GEM_PICKUP_RANGE - 0.05)), GEM_SPOTS.filter((g) => !near(g.x, g.z, GEM_PICKUP_RANGE - 0.05)));
// Doors approachable from both sides
const doorBad = DOORS.filter((d) => { const off = 0.7; const a = d.along === "x" ? [d.x, d.z - off] : [d.x - off, d.z]; const b = d.along === "x" ? [d.x, d.z + off] : [d.x + off, d.z]; return !near(a[0]!, a[1]!, 0.3) || !near(b[0]!, b[1]!, 0.3); }).map((d) => d.id);
ok("every door reachable from both sides", doorBad.length === 0, doorBad);
// Furniture vs walls and each other (solid only)
const fb = FURNITURE.filter((f) => f.solid).map((f) => ({ id: f.id, minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2 }));
const ov = (a: Box2D, b: Box2D) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;
const clash: string[] = [];
for (const f of fb) { if (WALLS.some((w) => ov(f, w))) clash.push(`${f.id}~wall`); for (const g of fb) if (f.id < g.id && ov(f, g)) clash.push(`${f.id}~${g.id}`); }
ok("solid furniture doesn't overlap walls or each other", clash.length === 0, clash);
// Props start in valid spots
const propBad: string[] = [];
for (const p of PROPS) {
  const box = propBox(p, p.x, p.z, p.rotY);
  if (p.y > 0) { if (!SURFACES.some((s) => p.x > s.minX && p.x < s.maxX && p.z > s.minZ && p.z < s.maxZ && Math.abs(s.top - p.y) < 1e-6)) propBad.push(`${p.id} not on a surface`); }
  else { if (COLLIDERS.some((b) => ov(box, b))) propBad.push(`${p.id} inside something`); if (!near(p.x, p.z, 1.4)) propBad.push(`${p.id} unreachable`); }
}
ok("every prop starts in a valid, reachable spot", propBad.length === 0, propBad);
// Game stations: each one can be walked up to (with room for a couple of players)
const stationBad = GAME_STATIONS.filter((st) => pts.filter((p) => distanceToStation(st, p.x, p.z) <= st.range - 0.1).length < 4).map((st) => st.id);
ok("every game station can be reached", stationBad.length === 0, stationBad);
