import * as THREE from "three";
import { PROPS, type HouseStateView, type PropSpec } from "@bbn/shared";
import type { Avatar } from "../entities/avatar.js";
import { buildModel } from "./house.js";

/** Hands height when carrying, and how far in front of the chest the object sits. */
const HANDS_Y = 1.0;
const HOLD_FORWARD = 0.32;

interface Item {
  spec: PropSpec;
  group: THREE.Group;
}

/**
 * Draws every carryable prop from server state: standing where it was put
 * down (eased, so moves don't pop), or in front of whoever is carrying it.
 * Used by housemates, viewers and the Big Brother console alike.
 */
export class PropsView {
  private readonly items: Item[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly room: { state: HouseStateView },
    /** The avatar for a session id (including your own, in housemate mode). */
    private readonly avatarFor: (sessionId: string) => Avatar | undefined,
  ) {
    for (const spec of PROPS) {
      const group = buildModel(spec.kind, spec.w, spec.d, spec.h, spec.id);
      group.name = spec.id;
      group.position.set(spec.x, spec.y, spec.z);
      group.rotation.y = spec.rotY;
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      scene.add(group);
      this.items.push({ spec, group });
    }
  }

  update(dt: number): void {
    const props = this.room.state.props;
    if (!props) return;
    const k = 1 - Math.exp(-12 * dt);
    for (const { spec, group } of this.items) {
      const pose = props.get(spec.id);
      if (!pose) continue;
      const holder = pose.heldBy ? this.avatarFor(pose.heldBy) : undefined;
      if (holder) {
        // In the carrier's hands: in front of the chest, turned the way they face.
        const yaw = holder.root.rotation.y;
        const ahead = HOLD_FORWARD + spec.d / 2;
        group.position.set(
          holder.root.position.x + Math.sin(yaw) * ahead,
          Math.max(0.15, HANDS_Y - spec.h * 0.5),
          holder.root.position.z + Math.cos(yaw) * ahead,
        );
        group.rotation.y = yaw;
        continue;
      }
      group.position.x += (pose.x - group.position.x) * k;
      group.position.y += (pose.y - group.position.y) * k;
      group.position.z += (pose.z - group.position.z) * k;
      const dy = Math.atan2(Math.sin(pose.rotY - group.rotation.y), Math.cos(pose.rotY - group.rotation.y));
      group.rotation.y += dy * k;
    }
  }
}
