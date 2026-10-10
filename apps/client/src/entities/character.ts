import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { LOOK_SLOTS, type AnimState, type Look } from "@bbn/shared";
import { buildAccessory, buildSkull, buildTowels, type AccessoryAnchor } from "./accessories.js";
import type { LoadedModel } from "./characterModels.js";

/**
 * A housemate drawn with one of the rigged Quaternius models: recoloured from
 * their look, wearing their accessories, and animated with the model's clips.
 * Moves the clips don't cover (sitting, sleeping, dancing, swimming, carrying)
 * are posed by turning bones after the clip has been applied each frame.
 */

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TMP_V = new THREE.Vector3();
const TMP_Q1 = new THREE.Quaternion();
const TMP_Q2 = new THREE.Quaternion();
const TMP_Q3 = new THREE.Quaternion();

/** The models are authored in centimetres. */
const MODEL_SCALE = 0.0098;

type Role = "skin" | "ears" | "top" | "shirt" | "bottom" | "shoes" | "sole" | "hair" | "brows" | "eyes";

/** Which part of the look each of the model's materials shows, by mesh and material name. */
function roleOf(mesh: string, material: string): Role {
  const m = material.toLowerCase();
  if (m === "skin") return "skin";
  if (m === "ears") return "ears";
  // On the woman's head "Hair_Blond" is her hair, "Hair_Brown" her eyebrows and "Brown" her eyes.
  if (m === "hair_brown" || m === "eyebrows") return "brows";
  if (m.startsWith("hair")) return "hair";
  if (m === "eye" || m === "brown") return "eyes";
  if (mesh.endsWith("_Feet")) return m === "white" ? "sole" : "shoes";
  if (mesh.endsWith("_Legs")) return "bottom";
  if (m === "white") return "shirt";
  return "top";
}

const CLIPS: Partial<Record<AnimState | "run" | "interact", string>> = {
  idle: "CharacterArmature|Idle",
  walk: "CharacterArmature|Walk",
  run: "CharacterArmature|Run",
  wave: "CharacterArmature|Wave",
  interact: "CharacterArmature|Interact",
};

/** Clip to play for each state; poses on top come from `applyPose`. */
function clipFor(anim: AnimState): keyof typeof CLIPS {
  switch (anim) {
    case "walk":
      return "walk";
    case "workout":
      return "run";
    case "wave":
      return "wave";
    case "cook":
    case "drink":
    case "wash":
    case "laundry":
      return "interact";
    default:
      return "idle";
  }
}

export class Character {
  /** Add this to the avatar; it's already scaled to metres and faces +Z. */
  readonly object: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  /**
   * Bones by name. The FBX nests a copy of each bone inside itself once per mesh
   * (FootL › FootL › FootL…); the first one found is the outermost, which is the
   * one to turn — the copies inside follow it.
   */
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly materials: Array<{ material: THREE.MeshStandardMaterial; role: Role }> = [];
  private readonly anchors = new Map<AccessoryAnchor, THREE.Object3D>();
  private time = 0;
  /**
   * Rest pose (from the bind pose) of every bone we turn or move by hand. The
   * clips don't key every bone, so anything we changed is put back here at the
   * start of each frame — otherwise our turns would add up frame after frame.
   */
  private readonly rest = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  private readonly bindPose = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** In the shower or bath: clothes, shoes and most accessories off (towels on in the shower). */
  private undressed = false;
  private showering = false;
  private towels: THREE.Object3D[] = [];
  /** Accessories taken off for the shower (hats, glasses, jewellery, backpack, watch). */
  private removable: THREE.Object3D[] = [];

  constructor(
    model: LoadedModel,
    private look: Look,
  ) {
    const object = cloneSkinned(model.scene) as THREE.Group;
    object.scale.setScalar(MODEL_SCALE);
    this.object = new THREE.Group();
    this.object.add(object);
    object.traverse((o) => {
      if ((o as THREE.Bone).isBone && !this.bones.has(o.name)) {
        this.bones.set(o.name, o as THREE.Bone);
        this.bindPose.set(o as THREE.Bone, { q: o.quaternion.clone(), p: o.position.clone() });
      }
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const own = source.map((m) => {
        const material = new THREE.MeshStandardMaterial({ name: m.name, roughness: 0.8, metalness: 0, flatShading: true });
        this.materials.push({ material, role: roleOf(mesh.name, m.name) });
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
    });

    this.mixer = new THREE.AnimationMixer(object);
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = model.animations.find((a) => a.name === name);
      if (clip) this.actions.set(key, this.mixer.clipAction(clip));
    }
    this.play("idle", 0);
    this.mixer.update(0);

    // Accessory anchors: groups on the head, neck, chest and wrist bones, set up in
    // the bind pose so accessories can be authored in plain metres, model space.
    this.object.updateMatrixWorld(true);
    const anchorBones: Record<AccessoryAnchor, string> = { head: "Head", neck: "Neck", chest: "Chest", wrist: "WristL", hips: "Hips" };
    for (const [anchor, boneName] of Object.entries(anchorBones) as Array<[AccessoryAnchor, string]>) {
      const bone = this.bones.get(boneName);
      if (!bone) continue;
      const g = new THREE.Group();
      g.position.copy(bone.getWorldPosition(new THREE.Vector3()));
      this.object.add(g);
      bone.attach(g);
      this.anchors.set(anchor, g);
    }
    this.setLook(look);
  }

  setLook(look: Look): void {
    this.look = look;
    for (const anchor of this.anchors.values()) anchor.clear();
    this.removable = [];
    const female = look.body === 1;
    const colors = this.colors();
    const add = (slot: "hair" | "hat" | "glasses" | "neck" | "ears" | "back" | "wrist", index: number) => {
      if (index === 0) return;
      const built = buildAccessory(slot, index, { female, hairColor: colors.hair, topColor: colors.top });
      if (!built) return;
      this.anchors.get(built.anchor)?.add(built.object);
      if (slot !== "hair") this.removable.push(built.object);
    };
    // The woman's head is open at the back and top under her own hair, so any
    // other hairstyle (or none) gets a skull to sit on.
    if (female && look.hair !== 0) this.anchors.get("head")?.add(buildSkull(colors.skin));
    add("hair", look.hair);
    add("hat", look.hat);
    add("glasses", look.glasses);
    add("neck", look.neck);
    add("ears", look.ears);
    add("back", look.back);
    add("wrist", look.wrist);
    this.towels = buildTowels(female).map(({ anchor, object }) => {
      this.anchors.get(anchor)?.add(object);
      return object;
    });
    this.dress();
  }

  /** Colour for each material role, from the look (bare skin for clothes while undressed). */
  private colors(): Record<Role, string> {
    const look = this.look;
    const skin = LOOK_SLOTS.skin[look.skin]!;
    const bare = this.undressed;
    return {
      skin,
      ears: skin,
      top: bare ? skin : LOOK_SLOTS.top[look.top]!,
      shirt: bare ? skin : "#f4f4f4",
      bottom: bare ? skin : LOOK_SLOTS.bottom[look.bottom]!,
      shoes: bare ? skin : LOOK_SLOTS.shoes[look.shoes]!,
      sole: bare ? skin : "#e8e8e8",
      hair: LOOK_SLOTS.hairColor[look.hairColor]!,
      brows: LOOK_SLOTS.hairColor[look.hairColor]!,
      eyes: "#1a1110",
    };
  }

  /** Applies clothes colours, hair visibility, accessories and towels for the current state. */
  private dress(): void {
    const colors = this.colors();
    const ownHair = this.look.hair === 0;
    for (const { material, role } of this.materials) {
      material.color.set(colors[role]);
      material.color.convertSRGBToLinear();
      // Any other hairstyle replaces the model's own hair (and the woman's ears, which it hides).
      if (role === "hair" || role === "ears") material.visible = ownHair;
    }
    // In the bath the water covers you; towels are for the shower.
    for (const towel of this.towels) towel.visible = this.showering;
    for (const item of this.removable) item.visible = !this.undressed;
  }

  private play(key: string, fade = 0.2): void {
    const action = this.actions.get(key) ?? this.actions.get("idle");
    if (!action || action === this.current) return;
    action.reset().setEffectiveWeight(1).play();
    if (this.current) action.crossFadeFrom(this.current, fade, false);
    this.current = action;
  }

  update(dt: number, anim: AnimState, speed: number, carrying: boolean): void {
    this.time += dt;
    const undressed = anim === "shower" || anim === "bath";
    if (undressed !== this.undressed || (anim === "shower") !== this.showering) {
      this.undressed = undressed;
      this.showering = anim === "shower";
      this.dress();
    }
    const key = clipFor(anim);
    this.play(anim === "walk" && speed > 5 ? "run" : key);
    if (this.current && (key === "walk" || key === "run")) {
      // Match the stride to how fast we're actually moving.
      this.current.timeScale = THREE.MathUtils.clamp(speed / (key === "run" ? 6 : 2.4), 0.6, 2);
    } else if (this.current) this.current.timeScale = 1;
    for (const [bone, r] of this.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
    this.mixer.update(dt);
    this.applyPose(anim, carrying);
  }

  /** Bone tweaks layered on the clip for states the clips don't include. */
  private applyPose(anim: AnimState, carrying: boolean): void {
    const t = this.time;
    const X = AXIS_X;
    const Z = AXIS_Z;
    const Y = AXIS_Y;
    switch (anim) {
      case "sit":
      case "toilet":
      case "eat":
        // Thighs forward, shins back down; the avatar lowers the whole body onto the seat.
        this.seatedLegs();
        if (anim === "eat") {
          // Fork to mouth and back.
          const bite = Math.max(0, Math.sin(t * 2.2));
          this.turn("UpperArmL", X, -0.55);
          this.turn("UpperArmR", X, -0.55 - bite * 0.25);
          this.turn("LowerArmR", X, -0.4 - bite * 0.9);
        } else {
          this.turn("UpperArmL", X, -0.35);
          this.turn("UpperArmR", X, -0.35);
        }
        break;
      case "bath":
        // Sitting low in the tub, legs stretched out, arms resting on the rim.
        for (const side of ["L", "R"]) this.turn(`UpperLeg${side}`, X, -1.35);
        this.feetToShins();
        this.turn("UpperArmL", Z, 0.7);
        this.turn("UpperArmR", Z, -0.7);
        break;
      case "shower":
        // Hands in the hair, scrubbing.
        this.arm("L", Z, 2.2 + Math.sin(t * 8) * 0.12);
        this.arm("R", Z, -2.2 - Math.sin(t * 8 + 1) * 0.12);
        this.turn("LowerArmL", Z, 1.2);
        this.turn("LowerArmR", Z, -1.2);
        break;
      case "wash":
      case "laundry":
        this.turn("UpperArmL", X, -0.75 + Math.sin(t * 6) * 0.08);
        this.turn("UpperArmR", X, -0.75 - Math.sin(t * 6) * 0.08);
        break;
      case "cook":
        // Both hands over the hob, the right one stirring.
        this.turn("UpperArmL", X, -0.9);
        this.turn("UpperArmR", X, -0.9 + Math.cos(t * 5) * 0.15);
        this.turn("UpperArmR", Y, Math.sin(t * 5) * 0.25);
        break;
      case "drink":
        this.turn("UpperArmR", X, -1.1);
        this.turn("LowerArmR", X, -1.2 + Math.sin(t * 1.5) * 0.15);
        break;
      case "dance": {
        // Twist from the waist (not the hips, which carry the legs), arms up, and
        // alternate knee lifts with the feet carried along so the shins don't stretch.
        const beat = t * 6;
        // A small sway and lean to the beat — the body faces forward, it doesn't spin.
        this.turn("Abdomen", Y, Math.sin(beat / 2) * 0.07);
        this.turn("Abdomen", Z, Math.sin(beat / 2) * 0.06);
        this.arm("L", Z, 2.1 + Math.sin(beat) * 0.3);
        this.arm("R", Z, -2.1 - Math.sin(beat) * 0.3);
        for (const [side, phase] of [
          ["L", 0],
          ["R", Math.PI],
        ] as const) {
          const lift = Math.max(0, Math.sin(beat + phase));
          this.turn(`UpperLeg${side}`, X, -0.45 * lift);
          this.turn(`LowerLeg${side}`, X, 0.8 * lift);
        }
        this.feetToShins();
        break;
      }
      // ---- emotes from the wheel (wave and dance are above / from the clip)
      case "clap": {
        const hit = Math.abs(Math.sin(t * 7));
        this.arm("L", X, -1.15);
        this.arm("R", X, -1.15);
        this.turn("UpperArmL", Z, -0.55 + hit * 0.3);
        this.turn("UpperArmR", Z, 0.55 - hit * 0.3);
        break;
      }
      case "laugh":
        this.turn("Head", X, -0.25 + Math.abs(Math.sin(t * 9)) * 0.12);
        this.turn("Abdomen", X, -0.08 + Math.sin(t * 9) * 0.04);
        this.arm("L", X, -0.45);
        this.arm("R", X, -0.45);
        break;
      case "cry":
        this.turn("Head", X, 0.4);
        this.arm("L", X, -1.45);
        this.arm("R", X, -1.45);
        this.turn("LowerArmL", X, -1.25);
        this.turn("LowerArmR", X, -1.25);
        this.turn("Abdomen", X, 0.12 + Math.sin(t * 6) * 0.03);
        break;
      case "facepalm":
        this.turn("Head", X, 0.3);
        this.arm("R", X, -1.45);
        this.turn("LowerArmR", X, -1.5);
        break;
      case "shrug":
        this.turn("ShoulderL", Z, 0.25);
        this.turn("ShoulderR", Z, -0.25);
        this.arm("L", Z, 0.55);
        this.arm("R", Z, -0.55);
        this.turn("LowerArmL", X, -1.1);
        this.turn("LowerArmR", X, -1.1);
        this.turn("Head", Z, 0.12);
        break;
      case "point":
        this.arm("R", X, -1.5);
        this.turn("Head", Y, -0.1);
        break;
      case "thumbsUp":
        this.arm("R", X, -0.9);
        this.turn("LowerArmR", X, -1);
        this.turn("Head", Z, -0.08);
        break;
      case "bow":
        this.turn("Abdomen", X, 0.35);
        this.turn("Chest", X, 0.25);
        this.turn("Head", X, 0.2);
        break;
      case "salute":
        this.arm("R", Z, -1.25);
        this.turn("UpperArmR", X, -0.7);
        this.turn("LowerArmR", Z, -2);
        break;
      case "cheer": {
        const pump = Math.abs(Math.sin(t * 6)) * 0.3;
        this.arm("L", Z, 2.5 + pump);
        this.arm("R", Z, -2.5 - pump);
        this.turn("Head", X, -0.15);
        break;
      }
      case "think":
        this.arm("R", X, -1.05);
        this.turn("LowerArmR", X, -1.85);
        this.arm("L", X, -0.5);
        this.turn("LowerArmL", X, -1.2);
        this.turn("Head", Z, 0.15);
        this.turn("Head", X, -0.08);
        break;
      case "sulk":
        // Arms folded, head down.
        this.arm("L", X, -0.75);
        this.arm("R", X, -0.75);
        this.turn("LowerArmL", Y, -1.4);
        this.turn("LowerArmR", Y, 1.4);
        this.turn("Head", X, 0.28);
        break;
      case "flex":
        this.arm("L", Z, 1.5);
        this.arm("R", Z, -1.5);
        this.turn("LowerArmL", Z, 1.5 + Math.sin(t * 4) * 0.15);
        this.turn("LowerArmR", Z, -1.5 - Math.sin(t * 4) * 0.15);
        break;
      case "blowKiss": {
        const out = Math.max(0, Math.sin(t * 3));
        this.arm("R", X, -1.35 - out * 0.3);
        this.turn("LowerArmR", X, -1.5 + out * 1.3);
        break;
      }
      case "nod":
        this.turn("Head", X, Math.sin(t * 7) * 0.22);
        break;
      case "shakeHead":
        this.turn("Head", Y, Math.sin(t * 8) * 0.4);
        break;
      case "sitFloor":
        // Sitting on the floor, legs out in front, leaning back on the hands.
        for (const side of ["L", "R"] as const) this.turn(`UpperLeg${side}`, X, -Math.PI / 2);
        this.feetToShins();
        this.arm("L", X, 0.45);
        this.arm("R", X, 0.45);
        break;
      case "lieDown":
        this.turn("UpperArmL", Z, 0.15);
        this.turn("UpperArmR", Z, -0.15);
        break;
      case "swim": {
        // Front crawl, kept within the shoulder's comfortable range.
        const stroke = Math.sin(t * 4);
        this.arm("L", X, -1.5 + stroke * 1.1);
        this.arm("R", X, -1.5 - stroke * 1.1);
        break;
      }
      case "sleep":
        this.turn("UpperArmL", Z, 0.2);
        this.turn("UpperArmR", Z, -0.2);
        break;
    }
    if (carrying && (anim === "idle" || anim === "walk")) {
      this.arm("L", X, -1.25);
      this.arm("R", X, -1.25);
      this.turn("UpperArmL", Z, -0.25);
      this.turn("UpperArmR", Z, 0.25);
    }
  }

  /**
   * Raises an arm: a share of the turn goes to the shoulder (collarbone) so big
   * lifts don't pinch the shoulder and sleeve, the rest to the upper arm.
   */
  private arm(side: "L" | "R", axis: THREE.Vector3, angle: number): void {
    const shoulder = Math.abs(angle) > 1 ? 0.3 : 0.15;
    this.turn(`Shoulder${side}`, axis, angle * shoulder);
    this.turn(`UpperArm${side}`, axis, angle * (1 - shoulder));
  }

  /** Seated legs: thighs level, shins straight down, feet following. */
  private seatedLegs(): void {
    for (const side of ["L", "R"]) {
      this.turn(`UpperLeg${side}`, AXIS_X, -Math.PI / 2);
      this.turn(`LowerLeg${side}`, AXIS_X, Math.PI / 2);
    }
    this.feetToShins();
  }

  /**
   * The feet are separate bones on the root (the clips plant them with IK), so
   * when the legs are bent by hand the feet are moved to the ends of the shins.
   */
  private feetToShins(): void {
    for (const side of ["L", "R"]) {
      const end = this.bones.get(`LowerLeg${side}_end`);
      const foot = this.bones.get(`Foot${side}`);
      if (!end || !foot?.parent) continue;
      this.remember(foot);
      end.updateWorldMatrix(true, false);
      const p = end.getWorldPosition(TMP_V);
      foot.parent.updateWorldMatrix(true, false);
      foot.position.copy(foot.parent.worldToLocal(p));
      foot.updateWorldMatrix(false, true);
    }
  }

  /**
   * Turns a bone by `angle` around an axis of the character itself (x = its left,
   * y = up, z = forward), whatever the bone's own axes are. Bones are posed parent
   * first, so world matrices are refreshed as we go.
   */
  /** Saves a bone's rest pose the first time we touch it (see `rest`). */
  private remember(bone: THREE.Bone): void {
    if (!this.rest.has(bone)) this.rest.set(bone, { q: this.bindPose.get(bone)!.q.clone(), p: this.bindPose.get(bone)!.p.clone() });
  }

  private turn(boneName: string, axis: THREE.Vector3, angle: number): void {
    if (angle === 0) return;
    const root = this.object.getWorldQuaternion(TMP_Q1);
    const worldAxis = TMP_V.copy(axis).applyQuaternion(root);
    const spin = TMP_Q3.setFromAxisAngle(worldAxis, angle);
    const bone = this.bones.get(boneName);
    if (!bone?.parent) return;
    this.remember(bone);
    bone.parent.updateWorldMatrix(true, false);
    const parent = bone.parent.getWorldQuaternion(TMP_Q2);
    // local = parent⁻¹ · spin · parent, applied before the bone's own rotation.
    const local = parent.clone().invert().multiply(spin).multiply(parent);
    bone.quaternion.premultiply(local);
    bone.updateWorldMatrix(false, true);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const { material } of this.materials) material.dispose();
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.geometry.dispose();
    });
  }

  /** How many accessories are attached (for tests). */
  get accessoryCount(): number {
    let n = 0;
    for (const a of this.anchors.values()) n += a.children.length;
    return n;
  }
}
