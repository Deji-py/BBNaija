import * as THREE from "three";
import { FURNITURE, encodeLook, type Look } from "@bbn/shared";
import { Avatar } from "../entities/avatar.js";

/** Black suit, sunglasses, buzz cut and a watch. Indices into LOOK_SLOTS. */
const GUARD_LOOK: Look = { body: 1, skin: 1, hair: 2, hairColor: 0, top: 9, bottom: 1, shoes: 0, hat: 0, glasses: 2, neck: 0, ears: 0, back: 0, wrist: 1 };

/**
 * House security at the Diary Room door. They stand where the "guard" furniture
 * is (which also makes them solid) and only idle; the server enforces the door rule.
 */
export class HouseGuards {
  private readonly guards: Avatar[] = [];

  constructor(root: THREE.Object3D) {
    const look = encodeLook(GUARD_LOOK);
    for (const f of FURNITURE) {
      if (f.kind !== "guard") continue;
      const guard = new Avatar("BBNaija Security", 0x111111, look);
      guard.root.position.set(f.x, 0, f.z);
      guard.root.rotation.y = f.facing ?? 0;
      guard.root.add(idBadge());
      root.add(guard.root);
      this.guards.push(guard);
    }
  }

  animate(dt: number): void {
    for (const guard of this.guards) guard.update(dt, 0, "idle");
  }
}

/** Green-and-white BBNaija ID card on a lanyard, on the chest. */
function idBadge(): THREE.Object3D {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 96, 128);
  ctx.fillStyle = "#008753";
  ctx.fillRect(0, 0, 96, 44);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BBNaija", 48, 29);
  ctx.fillStyle = "#111111";
  ctx.font = "800 15px system-ui, sans-serif";
  ctx.fillText("SECURITY", 48, 84);
  ctx.fillStyle = "#008753";
  ctx.fillRect(14, 100, 68, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.15), new THREE.MeshStandardMaterial({ map: texture }));
  card.position.set(0, 1.18, 0.2);
  return card;
}
