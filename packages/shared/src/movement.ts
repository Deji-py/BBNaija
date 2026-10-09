import { COLLIDERS, PLAYER_RADIUS, type Box2D } from "./house.js";

export interface Vec2 {
  x: number;
  z: number;
}

const EPSILON = 0.001;

/**
 * Moves a circular player by (dx, dz), stopping at any collider.
 *
 * Uses the simple "axis-separated AABB" approach: move along X and push out of
 * anything we hit, then do the same along Z. Because each axis is resolved on
 * its own, the player slides along walls instead of sticking to them.
 * The circle is treated as a square of side 2·radius, which is plenty for walls.
 *
 * Steps must be smaller than the thinnest wall (0.3 m + 2·radius); at walking
 * speed with a clamped frame time that always holds.
 */
export function moveWithCollision(
  pos: Vec2,
  dx: number,
  dz: number,
  colliders: readonly Box2D[] = COLLIDERS,
  radius = PLAYER_RADIUS,
): Vec2 {
  let x = pos.x + dx;
  if (dx !== 0) {
    for (const b of colliders) {
      if (overlaps(x, pos.z, radius, b)) {
        x = dx > 0 ? b.minX - radius - EPSILON : b.maxX + radius + EPSILON;
      }
    }
  }

  let z = pos.z + dz;
  if (dz !== 0) {
    for (const b of colliders) {
      if (overlaps(x, z, radius, b)) {
        z = dz > 0 ? b.minZ - radius - EPSILON : b.maxZ + radius + EPSILON;
      }
    }
  }

  return { x, z };
}

function overlaps(x: number, z: number, r: number, b: Box2D): boolean {
  return x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ;
}
