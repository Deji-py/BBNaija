import * as THREE from "three";
import { AREAS, FURNITURE, WALLS, type AreaId, type Furniture } from "@bbn/shared";
import { box, mat } from "./materials.js";

const FLOOR_COLORS: Record<AreaId, number> = {
  lounge: 0xc9a27a,
  kitchen: 0xdcd6c8,
  bedroom: 0x8f7aa8,
  gym: 0x55606e,
  diary: 0x6b1f2a,
  garden: 0x6aa84f,
};

const WALL_COLOR = 0xefe8da;
const FENCE_COLOR = 0x8b6a46;
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x5c3d24;

export interface House {
  root: THREE.Group;
  /** Meshes that should block the camera (walls and fences). */
  cameraBlockers: THREE.Object3D[];
}

/** Builds the whole house from the shared layout data. */
export function buildHouse(): House {
  const root = new THREE.Group();
  root.name = "house";

  // Lawn surrounding everything.
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x4f8a3c));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  root.add(lawn);

  // One floor slab per area, coloured so each room reads at a glance.
  for (const a of AREAS) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(a.maxX - a.minX, a.maxZ - a.minZ), mat(FLOOR_COLORS[a.id]));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((a.minX + a.maxX) / 2, 0, (a.minZ + a.maxZ) / 2);
    floor.receiveShadow = true;
    root.add(floor);
  }

  const cameraBlockers: THREE.Object3D[] = [];
  for (const w of WALLS) {
    const mesh = box(
      w.maxX - w.minX,
      w.height,
      w.maxZ - w.minZ,
      w.kind === "wall" ? WALL_COLOR : FENCE_COLOR,
      (w.minX + w.maxX) / 2,
      0,
      (w.minZ + w.maxZ) / 2,
    );
    root.add(mesh);
    if (w.kind === "wall") cameraBlockers.push(mesh);
  }

  for (const f of FURNITURE) root.add(buildFurniture(f));

  return { root, cameraBlockers };
}

/**
 * Each builder works in local space: width along X, depth along Z, and the
 * object's front facing +Z. The group is then rotated to `facing`.
 */
function buildFurniture(f: Furniture): THREE.Group {
  const g = new THREE.Group();
  g.name = f.id;
  const facing = f.facing ?? 0;
  // When turned sideways, the world-space footprint's w/d swap in local space.
  const sideways = Math.abs(Math.sin(facing)) > 0.5;
  const w = sideways ? f.d : f.w;
  const d = sideways ? f.w : f.d;
  const h = f.h;

  switch (f.kind) {
    case "sofa": {
      const c = 0x2f7f86;
      g.add(box(w, 0.45, d, c));
      g.add(box(w, h, 0.28, c, 0, 0, -d / 2 + 0.14));
      g.add(box(0.25, 0.65, d, c, -w / 2 + 0.125));
      g.add(box(0.25, 0.65, d, c, w / 2 - 0.125));
      for (let i = 0; i < 3; i++) g.add(box(w / 3 - 0.3, 0.12, d - 0.35, 0x3b98a0, -w / 3 + (i * w) / 3, 0.45, 0.07));
      break;
    }
    case "coffeeTable":
      g.add(box(w, 0.08, d, WOOD, 0, h - 0.08));
      g.add(box(w - 0.2, h - 0.08, d - 0.2, DARK_WOOD));
      break;
    case "tv": {
      g.add(box(w, 0.5, d, DARK_WOOD));
      g.add(box(w * 0.9, 1.0, 0.08, 0x111111, 0, 0.6));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 0.9), mat(0x3a6ea5, { emissive: 0x1a3550 }));
      screen.position.set(0, 1.1, 0.045);
      g.add(screen);
      break;
    }
    case "counter":
      g.add(box(w, h - 0.06, d, 0xf3f1ec));
      g.add(box(w, 0.06, d, 0x3a3a3f, 0, h - 0.06));
      break;
    case "stove": {
      g.add(box(w, h, d, 0x2b2b30));
      for (const [bx, bz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]] as const) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 8), mat(0x777777));
        burner.position.set(bx, h + 0.015, bz);
        g.add(burner);
      }
      break;
    }
    case "fridge":
      g.add(box(w, h, d, 0xcfd6dc));
      g.add(box(0.06, 0.5, 0.06, 0x888888, w / 2 - 0.2, 1.1, d / 2 + 0.03));
      break;
    case "diningTable":
      g.add(box(w, 0.08, d, WOOD, 0, h - 0.08));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(box(0.1, h - 0.08, 0.1, DARK_WOOD, sx * (w / 2 - 0.15), 0, sz * (d / 2 - 0.15)));
      }
      break;
    case "bed": {
      const blankets = [0xd9485f, 0x3f7fd9, 0xe0a83a];
      const blanket = blankets[Number(f.id.split("-")[1] ?? 0) % blankets.length] ?? blankets[0]!;
      g.add(box(w, 0.3, d, DARK_WOOD));
      g.add(box(w - 0.1, 0.2, d - 0.1, 0xf5f5f5, 0, 0.3));
      g.add(box(w - 0.08, 0.08, d * 0.6, blanket, 0, 0.5, d * 0.18));
      g.add(box(w * 0.6, 0.12, 0.4, 0xffffff, 0, 0.5, -d / 2 + 0.35));
      g.add(box(w, 1.0, 0.1, DARK_WOOD, 0, 0, -d / 2 + 0.05));
      break;
    }
    case "treadmill":
      g.add(box(w, 0.2, d, 0x222428));
      g.add(box(w * 0.75, 0.03, d * 0.85, 0x3d3f45, 0, 0.2, -0.05));
      g.add(box(0.08, h, 0.08, 0x9aa0a8, -w / 2 + 0.06, 0, d / 2 - 0.1));
      g.add(box(0.08, h, 0.08, 0x9aa0a8, w / 2 - 0.06, 0, d / 2 - 0.1));
      g.add(box(w, 0.25, 0.25, 0x222428, 0, h - 0.1, d / 2 - 0.15));
      break;
    case "weights":
      g.add(box(w, 0.1, d, 0x333333, 0, h - 0.1));
      g.add(box(w, 0.1, d, 0x333333, 0, 0.4));
      for (let i = 0; i < 5; i++) {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 6), mat(0x1c1c1c));
        bell.rotation.x = Math.PI / 2;
        bell.position.set(-w / 2 + 0.3 + i * ((w - 0.6) / 4), h + 0.1, 0);
        g.add(bell);
      }
      g.add(box(0.08, h, d, 0x666666, -w / 2 + 0.04));
      g.add(box(0.08, h, d, 0x666666, w / 2 - 0.04));
      break;
    case "bench":
      g.add(box(w, 0.1, d, 0x1e1e1e, 0, h - 0.1));
      g.add(box(0.15, h - 0.1, d * 0.8, 0x666666));
      break;
    case "diaryChair": {
      const red = 0xb3122e;
      g.add(box(w, 0.5, d, red));
      g.add(box(w, h, 0.3, red, 0, 0, -d / 2 + 0.15));
      g.add(box(0.25, 0.75, d, red, -w / 2 + 0.125));
      g.add(box(0.25, 0.75, d, red, w / 2 - 0.125));
      break;
    }
    case "pool": {
      const border = 0xe7e1d3;
      const water = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat(0x3fb4e0, { emissive: 0x0b3a52, opacity: 0.9 }));
      water.position.y = 0.03;
      water.receiveShadow = true;
      g.add(water);
      g.add(box(w + 0.6, 0.15, 0.3, border, 0, 0, -d / 2 - 0.15));
      g.add(box(w + 0.6, 0.15, 0.3, border, 0, 0, d / 2 + 0.15));
      g.add(box(0.3, 0.15, d, border, -w / 2 - 0.15));
      g.add(box(0.3, 0.15, d, border, w / 2 + 0.15));
      break;
    }
    case "lounger": {
      g.add(box(w, 0.3, d, 0xf0f0f0));
      g.add(box(w - 0.05, 0.06, d * 0.6, 0x2f9fd0, 0, 0.3, d * 0.2));
      // Backrest hinged at the seat, tilted up toward the head (-Z) end.
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.32, -d / 2 + d * 0.4);
      hinge.rotation.x = 0.7;
      hinge.add(box(w - 0.05, 0.06, d * 0.4, 0x2f9fd0, 0, 0, -d * 0.2));
      g.add(hinge);
      break;
    }
    case "tree": {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h * 0.45, 6), mat(0x6b4a2b));
      trunk.position.y = (h * 0.45) / 2;
      trunk.castShadow = true;
      g.add(trunk);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 0), mat(0x3e8a3a));
      leaves.position.y = h * 0.62;
      leaves.castShadow = true;
      g.add(leaves);
      break;
    }
    case "rug": {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xb5524a));
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.01;
      rug.receiveShadow = true;
      g.add(rug);
      break;
    }
  }

  g.position.set(f.x, 0, f.z);
  g.rotation.y = facing;
  return g;
}
