import * as THREE from "three";

/**
 * Low-poly accessories for the character creator: hairstyles, hats, glasses,
 * jewellery, headphones, a backpack and a watch. Each is built in metres,
 * relative to the bone it hangs from (with the model facing +Z, y up), and
 * follows that bone as the character animates.
 *
 * Measured on both models: the head bone sits at the base of the skull. The
 * man's skull centre is ~0.165 m above it and 0.04 m behind (radius ~0.12);
 * the woman's is lower and further forward (see HEADS).
 */

export type AccessoryAnchor = "head" | "neck" | "chest" | "wrist" | "hips";
type Slot = "hair" | "hat" | "glasses" | "neck" | "ears" | "back" | "wrist";

interface Options {
  female: boolean;
  hairColor: string;
  topColor: string;
}

/** Head measurements relative to the head bone, per body (the woman's head sits further forward and a little smaller). */
const HEADS = {
  man: { center: new THREE.Vector3(0, 0.165, -0.04), r: 0.12, eyeY: 0.15, faceZ: 0.092 },
  woman: { center: new THREE.Vector3(0, 0.14, 0.02), r: 0.106, eyeY: 0.11, faceZ: 0.118 },
};
// Set for the body being dressed at the start of each build (see `useHead`).
let HEAD = HEADS.man.center;
let R = HEADS.man.r;
let EYE_Y = HEADS.man.eyeY;
let FACE_Z = HEADS.man.faceZ;

function useHead(female: boolean): void {
  const h = female ? HEADS.woman : HEADS.man;
  HEAD = h.center;
  R = h.r;
  EYE_Y = h.eyeY;
  FACE_Z = h.faceZ;
}

function std(color: THREE.ColorRepresentation, opts: { metal?: number; rough?: number; emissive?: number; transparent?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.8,
    metalness: opts.metal ?? 0,
    flatShading: true,
    emissive: opts.emissive ?? 0,
    transparent: opts.transparent !== undefined,
    opacity: opts.transparent ?? 1,
  });
  m.color.convertSRGBToLinear();
  return m;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Hair or fabric hugging the top of the skull; `depth` is how far down it reaches (fraction of a full sphere). */
function skullCap(material: THREE.Material, radius = R + 0.008, depth = 0.62): THREE.Mesh {
  const cap = mesh(new THREE.SphereGeometry(radius, 14, 10, 0, Math.PI * 2, 0, Math.PI * depth), material, HEAD.x, HEAD.y, HEAD.z);
  cap.scale.set(1.02, 1.05, 1.15);
  // Tip it back a little so it sits higher on the forehead than at the nape.
  cap.rotation.x = -0.12;
  return cap;
}

function hair(index: number, o: Options): THREE.Object3D | null {
  const m = std(o.hairColor);
  const g = new THREE.Group();
  const top = HEAD.y + R;
  switch (index) {
    case 2: // buzz cut
      g.add(skullCap(m, R + 0.004, 0.55));
      break;
    case 3: {
      // afro
      const puff = mesh(new THREE.IcosahedronGeometry(0.2, 1), m, 0, HEAD.y + 0.06, HEAD.z - 0.02);
      puff.scale.set(1.05, 0.95, 1);
      g.add(puff);
      break;
    }
    case 4: {
      // high-top fade
      g.add(skullCap(m, R + 0.004, 0.5));
      g.add(mesh(new THREE.BoxGeometry(0.21, 0.16, 0.24), m, 0, top + 0.01, HEAD.z));
      break;
    }
    case 5: // braids
    case 6: {
      // locs
      g.add(skullCap(m));
      const n = index === 5 ? 10 : 14;
      const thick = index === 5 ? 0.014 : 0.022;
      const length = o.female ? 0.42 : 0.3;
      for (let i = 0; i < n; i++) {
        // Spread around the sides and back of the head (φ = 0 is straight behind).
        const phi = -1.7 + (3.4 * i) / (n - 1);
        const x = Math.sin(phi) * (R + 0.012);
        const z = HEAD.z - Math.cos(phi) * (R + 0.012);
        const strand = mesh(new THREE.CylinderGeometry(thick, thick * 0.8, length, 5), m, x, HEAD.y + 0.02 - length / 2, z);
        strand.rotation.z = Math.sin(phi) * 0.15;
        strand.rotation.x = -Math.cos(phi) * 0.15;
        g.add(strand);
      }
      break;
    }
    case 7: // bun
      g.add(skullCap(m));
      g.add(mesh(new THREE.IcosahedronGeometry(0.075, 1), m, 0, top + 0.02, HEAD.z - 0.07));
      break;
    case 8: {
      // ponytail
      g.add(skullCap(m));
      const tail = mesh(new THREE.CylinderGeometry(0.04, 0.015, 0.34, 6), m, 0, HEAD.y - 0.08, HEAD.z - R - 0.06);
      tail.rotation.x = 0.35;
      g.add(tail);
      g.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 5, 10), std("#e63946"), 0, HEAD.y + 0.08, HEAD.z - R - 0.005));
      break;
    }
    case 9: // mohawk
      g.add(skullCap(std("#2b2b2b"), R + 0.003, 0.5));
      for (let i = 0; i < 5; i++) {
        const fin = mesh(new THREE.ConeGeometry(0.03, 0.12, 4), m, 0, top - 0.01 + Math.sin((i / 4) * Math.PI) * 0.025, HEAD.z + 0.08 - i * 0.045);
        fin.rotation.x = -0.3 + i * 0.15;
        g.add(fin);
      }
      break;
    case 10: // curly
      g.add(skullCap(m));
      for (let i = 0; i < 16; i++) {
        const a = i * 2.4;
        const r = 0.035 + (i / 16) * 0.07;
        g.add(mesh(new THREE.IcosahedronGeometry(0.042, 0), m, Math.cos(a) * r, top - 0.015 + (0.07 - r) * 0.4, HEAD.z + Math.sin(a) * r));
      }
      break;
    case 11: // cornrows
      g.add(skullCap(m, R + 0.004, 0.58));
      for (let i = -3; i <= 3; i++) {
        const row = mesh(new THREE.TorusGeometry(R + 0.01, 0.009, 4, 16, Math.PI * 0.9), m, i * 0.028, HEAD.y, HEAD.z);
        row.rotation.y = Math.PI / 2;
        row.rotation.z = Math.PI * 0.05;
        g.add(row);
      }
      break;
    default:
      return null; // 0 = the model's own hair, 1 = bald
  }
  return g;
}

function hat(index: number, o: Options): THREE.Object3D | null {
  const g = new THREE.Group();
  const top = HEAD.y + R;
  switch (index) {
    case 1: {
      // cap with a peak, in your top's colour
      const m = std(o.topColor);
      g.add(skullCap(m, R + 0.02, 0.5));
      const peak = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 12, 1, false, -Math.PI / 2, Math.PI), m, 0, HEAD.y + 0.07, HEAD.z + 0.1);
      peak.scale.set(1, 1, 0.9);
      peak.rotation.x = 0.12;
      g.add(peak);
      g.add(mesh(new THREE.SphereGeometry(0.012, 6, 4), m, 0, top + 0.025, HEAD.z));
      break;
    }
    case 2: {
      // beanie
      const m = std("#c1121f");
      const dome = skullCap(m, R + 0.025, 0.55);
      dome.scale.y = 1.25;
      g.add(dome);
      g.add(mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.06, 14), std("#9b0e18"), 0, HEAD.y + 0.06, HEAD.z));
      g.add(mesh(new THREE.IcosahedronGeometry(0.035, 0), std("#fefae0"), 0, top + 0.07, HEAD.z));
      break;
    }
    case 3: {
      // bucket hat
      const m = std("#d4a373");
      g.add(mesh(new THREE.CylinderGeometry(R * 0.9, R + 0.02, 0.12, 14), m, 0, top - 0.02, HEAD.z));
      const brim = mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.075, 0.05, 14, 1, true), m, 0, HEAD.y + 0.07, HEAD.z);
      brim.material = m.clone();
      (brim.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      g.add(brim);
      break;
    }
    case 4: {
      // fedora
      const m = std("#3d2b1f");
      g.add(mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.95, 0.12, 12), m, 0, top + 0.01, HEAD.z));
      g.add(mesh(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.012, 16), m, 0, HEAD.y + 0.085, HEAD.z));
      g.add(mesh(new THREE.CylinderGeometry(R * 0.96, R * 0.96, 0.025, 12), std("#111111"), 0, HEAD.y + 0.105, HEAD.z));
      break;
    }
    case 5: {
      // fila (Yoruba cap), slouched to one side
      const m = std("#7b2cbf");
      const cap = mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.16, 14), m, 0.02, top - 0.01, HEAD.z);
      cap.rotation.z = -0.2;
      g.add(cap);
      const fold = mesh(new THREE.SphereGeometry(R * 0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0.06, top + 0.06, HEAD.z);
      fold.scale.y = 0.4;
      fold.rotation.z = -0.5;
      g.add(fold);
      break;
    }
    case 6: {
      // gele (head wrap): stacked folds and a fan at the back
      const m = std("#f3a712", { metal: 0.2, rough: 0.5 });
      for (let i = 0; i < 3; i++) {
        const fold = mesh(new THREE.TorusGeometry(R + 0.02 - i * 0.015, 0.035, 6, 14), m, 0, HEAD.y + 0.08 + i * 0.05, HEAD.z - i * 0.01);
        fold.rotation.x = Math.PI / 2 + 0.25;
        g.add(fold);
      }
      g.add(skullCap(m, R + 0.03, 0.4));
      for (let i = -2; i <= 2; i++) {
        const fan = mesh(new THREE.ConeGeometry(0.06, 0.2, 4), m, i * 0.05, top + 0.08, HEAD.z - 0.06);
        fan.rotation.z = -i * 0.3;
        fan.rotation.x = -0.3;
        g.add(fan);
      }
      break;
    }
    case 7: {
      // headband
      const band = mesh(new THREE.TorusGeometry(R + 0.012, 0.016, 5, 18), std(o.topColor), 0, HEAD.y + 0.085, HEAD.z);
      band.rotation.x = Math.PI / 2 + 0.2;
      band.scale.set(1, 1.12, 1);
      g.add(band);
      break;
    }
    default:
      return null;
  }
  return g;
}

function glasses(index: number): THREE.Object3D | null {
  if (index === 0) return null;
  const g = new THREE.Group();
  const frame = std(index === 1 ? "#222222" : index === 2 ? "#111111" : "#c9a227", { metal: index === 3 ? 0.6 : 0, rough: 0.4 });
  const lens = std(index === 1 ? "#cfe8ff" : "#0b0b0b", { transparent: index === 1 ? 0.3 : 0.9, rough: 0.1 });
  for (const side of [-1, 1]) {
    const x = side * 0.045;
    if (index === 3) {
      g.add(mesh(new THREE.TorusGeometry(0.026, 0.004, 4, 14), frame, x, EYE_Y, FACE_Z));
      g.add(mesh(new THREE.CircleGeometry(0.026, 14), lens, x, EYE_Y, FACE_Z - 0.001));
    } else {
      const w = index === 2 ? 0.06 : 0.052;
      const h = index === 2 ? 0.038 : 0.034;
      g.add(mesh(new THREE.BoxGeometry(w + 0.008, h + 0.008, 0.006), frame, x, EYE_Y, FACE_Z - 0.002));
      g.add(mesh(new THREE.BoxGeometry(w, h, 0.007), lens, x, EYE_Y, FACE_Z));
    }
    const arm = mesh(new THREE.BoxGeometry(0.005, 0.005, 0.13), frame, side * 0.112, EYE_Y + 0.005, FACE_Z - 0.065);
    g.add(arm);
  }
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), frame, 0, EYE_Y + 0.008, FACE_Z));
  return g;
}

function neckwear(index: number, o: Options): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (index) {
    case 1: {
      const chain = mesh(new THREE.TorusGeometry(0.085, 0.008, 5, 20), std("#d4af37", { metal: 0.9, rough: 0.25 }), 0, -0.03, 0.01);
      chain.rotation.x = Math.PI / 2 - 0.5;
      chain.scale.set(1, 1.15, 1);
      g.add(chain);
      g.add(mesh(new THREE.OctahedronGeometry(0.02, 0), std("#d4af37", { metal: 0.9, rough: 0.25 }), 0, -0.1, 0.085));
      break;
    }
    case 2: {
      const m = std("#e63946");
      const wrap = mesh(new THREE.TorusGeometry(0.075, 0.03, 6, 14), m, 0, 0, 0);
      wrap.rotation.x = Math.PI / 2 - 0.2;
      g.add(wrap);
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.02), m, 0.04, -0.1, 0.085));
      break;
    }
    case 3: {
      const m = std(o.topColor === "#111111" ? "#c1121f" : "#111111");
      for (const side of [-1, 1]) {
        const wing = mesh(new THREE.ConeGeometry(0.026, 0.05, 4), m, side * 0.024, -0.04, 0.085);
        wing.rotation.z = side * Math.PI / 2;
        g.add(wing);
      }
      g.add(mesh(new THREE.BoxGeometry(0.016, 0.018, 0.016), m, 0, -0.04, 0.088));
      break;
    }
    default:
      return null;
  }
  return g;
}

function earwear(index: number): THREE.Object3D | null {
  const g = new THREE.Group();
  if (index === 1) {
    const gold = std("#d4af37", { metal: 0.9, rough: 0.25 });
    for (const side of [-1, 1]) {
      const hoop = mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 12), gold, side * (R + 0.002), HEAD.y - 0.06, HEAD.z + 0.02);
      hoop.rotation.y = Math.PI / 2;
      g.add(hoop);
    }
    return g;
  }
  if (index === 2) {
    const m = std("#1f2937", { rough: 0.5 });
    const band = mesh(new THREE.TorusGeometry(R + 0.03, 0.012, 5, 16, Math.PI), m, 0, HEAD.y, HEAD.z);
    band.rotation.y = Math.PI / 2;
    g.add(band);
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 12), m, side * (R + 0.02), HEAD.y - 0.01, HEAD.z + 0.01);
      cup.rotation.z = Math.PI / 2;
      g.add(cup);
      const pad = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.037, 10), std("#e63946"), side * (R + 0.02), HEAD.y - 0.01, HEAD.z + 0.01);
      pad.rotation.z = Math.PI / 2;
      g.add(pad);
    }
    return g;
  }
  return null;
}

function backpack(o: Options): THREE.Object3D {
  const g = new THREE.Group();
  const m = std(o.topColor === "#2b2d42" ? "#e4572e" : "#2b2d42");
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.36, 0.13), m, 0, -0.12, -0.2));
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.14, 0.05), std("#f3a712"), 0, -0.2, -0.28));
  for (const side of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.34, 0.02), m, side * 0.09, -0.1, 0.12));
  return g;
}

function watch(): THREE.Object3D {
  const g = new THREE.Group();
  const strap = mesh(new THREE.TorusGeometry(0.032, 0.008, 4, 12), std("#111111"), 0, 0.04, 0);
  strap.rotation.x = Math.PI / 2;
  g.add(strap);
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), std("#d4af37", { metal: 0.9, rough: 0.3 }), 0.035, 0.04, 0));
  return g;
}

/** A closed skull in the skin tone, for heads that rely on their own hair to cover the scalp. */
export function buildSkull(skin: string): THREE.Object3D {
  const h = HEADS.woman;
  const skull = mesh(new THREE.SphereGeometry(1, 16, 12), std(skin), 0, h.center.y, h.center.z);
  skull.scale.set(0.098, 0.112, 0.105);
  return skull;
}

/**
 * Bath towels worn in the shower and bath: one round the waist (on the hips
 * bone) and, for women, one wrapped round the chest (on the chest bone).
 */
export function buildTowels(female: boolean): Array<{ anchor: AccessoryAnchor; object: THREE.Object3D }> {
  const cloth = std("#f8fafc");
  cloth.side = THREE.DoubleSide;
  const waist = mesh(new THREE.CylinderGeometry(0.165, 0.2, 0.36, 14, 1, true), cloth, 0, -0.12, 0.01);
  waist.scale.z = 0.85;
  const fold = mesh(new THREE.TorusGeometry(0.16, 0.02, 5, 14), cloth, 0, 0.05, 0.01);
  fold.rotation.x = Math.PI / 2;
  fold.scale.y = 0.85;
  const out: Array<{ anchor: AccessoryAnchor; object: THREE.Object3D }> = [
    { anchor: "hips", object: new THREE.Group().add(waist, fold) },
  ];
  if (female) {
    const wrap = mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.22, 14, 1, true), cloth, 0, -0.06, 0.02);
    wrap.scale.z = 0.95;
    out.push({ anchor: "chest", object: wrap });
  }
  return out;
}

/** Builds the accessory for one slot's choice, and the bone it hangs from. */
export function buildAccessory(slot: Slot, index: number, o: Options): { anchor: AccessoryAnchor; object: THREE.Object3D } | null {
  useHead(o.female);
  let object: THREE.Object3D | null = null;
  let anchor: AccessoryAnchor = "head";
  switch (slot) {
    case "hair":
      object = hair(index, o);
      break;
    case "hat":
      object = hat(index, o);
      break;
    case "glasses":
      object = glasses(index);
      break;
    case "ears":
      object = earwear(index);
      break;
    case "neck":
      object = neckwear(index, o);
      anchor = "neck";
      break;
    case "back":
      object = index ? backpack(o) : null;
      anchor = "chest";
      break;
    case "wrist":
      object = index ? watch() : null;
      anchor = "wrist";
      break;
  }
  return object ? { anchor, object } : null;
}
