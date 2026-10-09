import * as THREE from "three";

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Shared flat-shaded material per colour. Reusing materials keeps GPU state
 * changes low, and flat shading gives the faceted low-poly look.
 */
export function mat(color: THREE.ColorRepresentation, opts: { emissive?: number; opacity?: number } = {}) {
  const key = `${String(color)}|${opts.emissive ?? ""}|${opts.opacity ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.85,
      metalness: 0,
      emissive: opts.emissive ?? 0x000000,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

/** Box mesh whose bottom sits at y (not centred), which is what furniture usually wants. */
export function box(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
