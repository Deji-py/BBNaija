import * as THREE from "three";
import type { TaskView } from "@bbn/shared";

/** Treasure-hunt gems: glowing, spinning octahedrons that vanish once found. */
export class GemsView {
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly geometry = new THREE.OctahedronGeometry(0.18);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x5ef0ff,
    emissive: 0x1aa9c4,
    emissiveIntensity: 1.2,
    flatShading: true,
  });
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  update(dt: number, task: TaskView | undefined): void {
    this.time += dt;
    const gems = task?.type === "treasure" ? [...task.gems] : [];
    const live = new Set<string>();
    for (const g of gems) {
      if (g.found) continue;
      live.add(g.id);
      let mesh = this.meshes.get(g.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        mesh.castShadow = true;
        this.meshes.set(g.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(g.x, 0.45 + Math.sin(this.time * 2 + Number(g.id)) * 0.08, g.z);
      mesh.rotation.y = this.time * 1.5;
    }
    for (const [id, mesh] of this.meshes) {
      if (live.has(id)) continue;
      mesh.removeFromParent();
      this.meshes.delete(id);
    }
  }
}
