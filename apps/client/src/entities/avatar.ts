import * as THREE from "three";
import { mat } from "../scene/materials.js";
import { createNameTag } from "./nameTag.js";

const SKIN = 0xe0ac69;
const DARK = 0x2a2a35;

/**
 * Low-poly housemate: capsule body, sphere head, four capsule limbs and a name tag.
 *
 * Animation is procedural — instead of keyframed clips, limb angles are
 * computed every frame from a "walk phase" that advances with movement speed.
 * That costs nothing to author and blends naturally between idle and walking.
 */
export class Avatar {
  readonly root = new THREE.Group();

  private readonly body: THREE.Group;
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;

  private walkPhase = 0;
  /** 0 = standing still, 1 = full walk cycle. Smoothed so starts/stops ease in. */
  private walkAmount = 0;
  private time = 0;

  constructor(name: string, color: THREE.ColorRepresentation) {
    const shirt = mat(color);

    // Everything above the hips lives in `body` so it can bob as one unit.
    this.body = new THREE.Group();
    this.root.add(this.body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.45, 2, 8), shirt);
    torso.position.y = 1.12;
    this.body.add(torso);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), mat(SKIN));
    head.position.y = 1.66;
    this.body.add(head);

    // Eyes on the +Z side make the facing direction obvious.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), mat(DARK));
      eye.position.set(side * 0.08, 1.7, 0.19);
      this.body.add(eye);
    }

    this.leftArm = limb(0.075, 0.42, shirt, 0.37, 1.38);
    this.rightArm = limb(0.075, 0.42, shirt, -0.37, 1.38);
    this.leftLeg = limb(0.1, 0.48, mat(DARK), 0.13, 0.78);
    this.rightLeg = limb(0.1, 0.48, mat(DARK), -0.13, 0.78);
    this.body.add(this.leftArm, this.rightArm);
    this.root.add(this.leftLeg, this.rightLeg);

    const tag = createNameTag(name);
    tag.position.y = 2.15;
    this.root.add(tag);

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  /** Frees GPU resources. Materials are shared (see scene/materials.ts) and are kept. */
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }

  /**
   * @param dt seconds since last frame
   * @param speed current horizontal speed in m/s
   */
  update(dt: number, speed: number): void {
    this.time += dt;
    const target = Math.min(speed / 4, 1);
    this.walkAmount += (target - this.walkAmount) * Math.min(dt * 10, 1);
    this.walkPhase += dt * speed * 2.4;

    const swing = Math.sin(this.walkPhase) * 0.7 * this.walkAmount;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;

    // Arms swing opposite to legs; when idle they hang with a slight breathing sway.
    const idleSway = Math.sin(this.time * 1.6) * 0.04 * (1 - this.walkAmount);
    this.leftArm.rotation.x = -swing * 0.8 + idleSway;
    this.rightArm.rotation.x = swing * 0.8 + idleSway;
    this.leftArm.rotation.z = 0.08;
    this.rightArm.rotation.z = -0.08;

    // Walking bobs twice per stride; idle breathes gently.
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.06 * this.walkAmount;
    const breathe = Math.sin(this.time * 2) * 0.012 * (1 - this.walkAmount);
    this.body.position.y = bob + breathe;
  }
}

/** A limb that pivots at its top joint (shoulder / hip). */
function limb(radius: number, length: number, material: THREE.Material, x: number, y: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 2, 6), material);
  mesh.position.y = -(length / 2 + radius / 2);
  pivot.add(mesh);
  return pivot;
}
