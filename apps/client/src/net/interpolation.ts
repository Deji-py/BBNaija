import { TICK_RATE_HZ } from "@bbn/shared";

/**
 * How far in the past remote players are drawn. Server updates arrive every
 * 50 ms (20 Hz); rendering ~2 updates behind means we almost always have a
 * "before" and an "after" snapshot to blend between, so movement looks smooth
 * even when packets arrive unevenly. The price is that others appear 100 ms late.
 */
export const INTERPOLATION_DELAY_MS = 100;

const PATCH_INTERVAL_MS = 1000 / TICK_RATE_HZ;
const MAX_SNAPSHOTS = 30;

export interface Pose {
  x: number;
  z: number;
  rotY: number;
}

interface Snapshot extends Pose {
  t: number;
}

/** Timestamped server poses for one remote player, sampled at a delayed render time. */
export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = [];

  constructor(initial: Pose) {
    this.snaps.push({ ...initial, t: performance.now() });
  }

  push(pose: Pose, t = performance.now()): void {
    const last = this.snaps[this.snaps.length - 1];
    // The server only sends changes. After standing still for a while the previous
    // snapshot is old; re-stamp it one patch ago so we don't blend across the idle gap.
    if (last && t - last.t > PATCH_INTERVAL_MS * 2) {
      this.snaps.push({ ...last, t: t - PATCH_INTERVAL_MS });
    }
    this.snaps.push({ ...pose, t });
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.splice(0, this.snaps.length - MAX_SNAPSHOTS);
  }

  sample(now = performance.now()): Pose {
    const renderTime = now - INTERPOLATION_DELAY_MS;
    const snaps = this.snaps;
    const first = snaps[0]!;
    if (renderTime <= first.t) return first;

    for (let i = snaps.length - 1; i > 0; i--) {
      const a = snaps[i - 1]!;
      const b = snaps[i]!;
      if (renderTime >= a.t) {
        if (renderTime >= b.t) return b; // newer than anything we have: hold the latest pose
        const k = (renderTime - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * k,
          z: a.z + (b.z - a.z) * k,
          rotY: lerpAngle(a.rotY, b.rotY, k),
        };
      }
    }
    return first;
  }
}

/** Interpolates between two angles along the shortest way round. */
export function lerpAngle(from: number, to: number, t: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * t;
}
