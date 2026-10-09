import * as THREE from "three";
import type { AnimState } from "@bbn/shared";
import { mat } from "../scene/materials.js";
import { createNameTag } from "./nameTag.js";
import { ChatBubble } from "./chatBubble.js";
import { VoiceIcon, type VoiceIconState } from "./voiceIcon.js";

const SKIN = 0xe0ac69;
const DARK = 0x2a2a35;
const HALF_PI = Math.PI / 2;

/**
 * Low-poly housemate: capsule body, sphere head, four capsule limbs and a name tag.
 *
 * Animation is procedural — instead of keyframed clips, limb angles are
 * computed every frame from the current animation state and a clock. That
 * costs nothing to author and blends naturally between idle and walking.
 *
 * Hierarchy: root (placed by the game) → pose (raised/lowered/tipped over per
 * activity, e.g. lying in bed) → body (bobs) + legs.
 */
export class Avatar {
  readonly root = new THREE.Group();

  private readonly pose = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly tag: THREE.Sprite;
  private readonly voiceIcon = new VoiceIcon();
  private readonly bubble = new ChatBubble();

  private walkPhase = 0;
  /** 0 = standing still, 1 = full walk cycle. Smoothed so starts/stops ease in. */
  private walkAmount = 0;
  private time = 0;
  private labelHeight = 2.15;

  constructor(name: string, color: THREE.ColorRepresentation) {
    const shirt = mat(color);
    this.root.add(this.pose);
    this.pose.add(this.body);

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
    this.pose.add(this.leftLeg, this.rightLeg);

    // Labels hang off the root (not the pose) so they stay upright when lying down.
    this.tag = createNameTag(name);
    this.root.add(this.tag, this.voiceIcon.sprite, this.bubble.sprite);
    this.placeLabels(2.15);

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  setVoiceState(state: VoiceIconState): void {
    this.voiceIcon.set(state);
  }

  showChat(text: string): void {
    this.bubble.show(text);
  }

  /** Frees GPU resources. Materials are shared (see scene/materials.ts) and are kept. */
  dispose(): void {
    this.voiceIcon.dispose();
    this.bubble.dispose();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }

  /**
   * @param dt seconds since last frame
   * @param speed current horizontal speed in m/s
   * @param anim what the player is doing (from the server, or walk/idle locally)
   */
  update(dt: number, speed: number, anim: AnimState = speed > 0.5 ? "walk" : "idle"): void {
    this.time += dt;
    this.voiceIcon.update(dt);
    this.bubble.update(dt);
    const t = this.time;

    // Reset everything to neutral; each state below only sets what it changes.
    this.pose.position.set(0, 0, 0);
    this.pose.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.body.rotation.set(0, 0, 0);
    for (const l of [this.leftArm, this.rightArm, this.leftLeg, this.rightLeg]) l.rotation.set(0, 0, 0);
    this.leftArm.rotation.z = 0.08;
    this.rightArm.rotation.z = -0.08;
    let labelHeight = 2.15;

    // Walk cycle (also used by the treadmill, with a fixed running speed).
    const runSpeed = anim === "workout" ? 6 : anim === "walk" || anim === "idle" ? speed : 0;
    const target = Math.min(runSpeed / 4, 1.3);
    this.walkAmount += (target - this.walkAmount) * Math.min(dt * 10, 1);
    this.walkPhase += dt * runSpeed * 2.4;
    const swing = Math.sin(this.walkPhase) * 0.7 * this.walkAmount;
    const breathe = Math.sin(t * 2) * 0.012;

    switch (anim) {
      case "idle":
      case "walk":
      case "workout": {
        this.leftLeg.rotation.x = swing;
        this.rightLeg.rotation.x = -swing;
        const idleSway = Math.sin(t * 1.6) * 0.04 * Math.max(0, 1 - this.walkAmount);
        this.leftArm.rotation.x = -swing * 0.8 + idleSway;
        this.rightArm.rotation.x = swing * 0.8 + idleSway;
        // Walking bobs twice per stride; idle breathes gently.
        this.body.position.y =
          Math.abs(Math.sin(this.walkPhase)) * 0.06 * this.walkAmount + breathe * Math.max(0, 1 - this.walkAmount);
        if (anim === "workout") {
          this.pose.position.y = 0.23; // standing on the belt
          this.leftArm.rotation.x -= 0.5; // bent "running arms"
          this.rightArm.rotation.x -= 0.5;
          labelHeight += 0.23;
        }
        break;
      }
      case "wave":
        this.rightArm.rotation.z = -2.6 + Math.sin(t * 9) * 0.35;
        this.body.position.y = breathe;
        break;
      case "dance": {
        const beat = t * 6;
        this.body.position.y = Math.abs(Math.sin(beat)) * 0.1;
        this.body.rotation.y = Math.sin(beat / 2) * 0.4;
        this.leftArm.rotation.z = 2.4 + Math.sin(beat) * 0.4;
        this.rightArm.rotation.z = -2.4 + Math.sin(beat) * 0.4;
        this.leftLeg.rotation.x = Math.sin(beat) * 0.3;
        this.rightLeg.rotation.x = -Math.sin(beat) * 0.3;
        break;
      }
      case "sit":
        // Lower the hips onto the seat (≈0.45 m) and swing the legs forward.
        this.pose.position.y = -0.33;
        this.leftLeg.rotation.x = -HALF_PI;
        this.rightLeg.rotation.x = -HALF_PI;
        this.leftArm.rotation.x = -0.35;
        this.rightArm.rotation.x = -0.35;
        this.body.position.y = breathe;
        labelHeight -= 0.33;
        break;
      case "sleep":
        // Tip the whole body backwards around the feet: head goes toward -Z (the pillow), face up.
        this.pose.rotation.x = -HALF_PI;
        this.pose.position.y = 0.78;
        this.body.position.y = Math.sin(t * 0.9) * 0.015; // slow breathing
        labelHeight = 1.4;
        break;
      case "cook":
        // Arms forward over the stove, the right one stirring.
        this.leftArm.rotation.x = -1.1;
        this.rightArm.rotation.x = -1.2 + Math.cos(t * 5) * 0.15;
        this.rightArm.rotation.z = Math.sin(t * 5) * 0.3;
        this.body.position.y = breathe;
        break;
      case "swim":
        // Sink so only head and shoulders show above the water; front-crawl arms.
        this.pose.position.y = -1.15 + Math.sin(t * 2) * 0.04;
        this.leftArm.rotation.x = -t * 4;
        this.rightArm.rotation.x = -t * 4 + Math.PI;
        labelHeight -= 1.1;
        break;
    }
    this.placeLabels(labelHeight);
  }

  private placeLabels(height: number): void {
    // Ease toward the new height so labels don't jump when sitting down or standing up.
    this.labelHeight += (height - this.labelHeight) * 0.2;
    this.tag.position.y = this.labelHeight;
    this.voiceIcon.sprite.position.y = this.labelHeight + 0.35;
    this.bubble.sprite.position.y = this.labelHeight + (this.voiceIcon.sprite.visible ? 0.55 : 0.22);
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
