import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

/**
 * The rigged Quaternius character models (CC0) in public/models. Each file is
 * loaded once; avatars get their own skinned copy via `cloneModel`.
 */

export type BaseModel = "hoodie" | "suit";

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const cache = new Map<BaseModel, Promise<LoadedModel>>();

export function loadModel(name: BaseModel): Promise<LoadedModel> {
  let p = cache.get(name);
  if (!p) {
    p = new FBXLoader().loadAsync(`/models/${name}.fbx`).then((scene) => {
      if (name === "suit") splitOffEars(scene);
      return { scene, animations: scene.animations };
    });
    cache.set(name, p);
  }
  return p;
}

/**
 * The woman's ears are long low-poly flaps meant to sit under her hair. Give
 * them their own material slot ("Ears") so they can be hidden when she wears a
 * different hairstyle. Triangles found by colour-picking the head mesh.
 */
const SUIT_EAR_TRIANGLES = new Set([59, 60, 61, 62, 280, 281, 282, 283]);

function splitOffEars(scene: THREE.Group): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== "Suit_Head" || !Array.isArray(mesh.material)) return;
    const skin = mesh.material.find((m) => m.name === "Skin");
    if (!skin) return;
    const ears = skin.clone();
    ears.name = "Ears";
    mesh.material.push(ears);
    const earsIndex = mesh.material.length - 1;
    const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
    for (const g of mesh.geometry.groups) {
      for (let i = g.start; i < g.start + g.count; i += 3) {
        const materialIndex = SUIT_EAR_TRIANGLES.has(i / 3) ? earsIndex : g.materialIndex!;
        const last = groups[groups.length - 1];
        if (last && last.materialIndex === materialIndex && last.start + last.count === i) last.count += 3;
        else groups.push({ start: i, count: 3, materialIndex });
      }
    }
    mesh.geometry.clearGroups();
    for (const g of groups) mesh.geometry.addGroup(g.start, g.count, g.materialIndex);
  });
}
