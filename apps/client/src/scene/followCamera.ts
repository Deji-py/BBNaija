import * as THREE from "three";

const MIN_DISTANCE = 3;
const MAX_DISTANCE = 14;
const MIN_PITCH = 0.15;
const MAX_PITCH = 1.3;
const HEAD_HEIGHT = 1.5;

/**
 * Third-person camera orbiting the player.
 *
 * - `yaw` turns around the player, `pitch` tilts up/down, `distance` zooms.
 * - Each frame the camera eases toward its target position, which smooths
 *   out small movements without feeling laggy.
 * - If a wall sits between the player and the camera, the camera is pulled in
 *   in front of it so the player never disappears behind a wall.
 */
export class FollowCamera {
  yaw = Math.PI; // start behind the player, looking north
  pitch = 0.6;
  distance = 8;

  private readonly raycaster = new THREE.Raycaster();
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly blockers: THREE.Object3D[],
    dom: HTMLElement,
  ) {
    this.bindPointer(dom);
  }

  rotate(deltaYaw: number, deltaPitch = 0): void {
    this.yaw += deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, MIN_PITCH, MAX_PITCH);
  }

  update(dt: number, target: THREE.Vector3, snap = false): void {
    this.focus.set(target.x, target.y + HEAD_HEIGHT, target.z);

    // Spherical offset from the focus point.
    this.dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    let dist = this.distance;
    this.raycaster.set(this.focus, this.dir);
    this.raycaster.far = dist;
    const hit = this.raycaster.intersectObjects(this.blockers, false)[0];
    if (hit) dist = Math.max(hit.distance - 0.25, 0.5);

    this.desired.copy(this.focus).addScaledVector(this.dir, dist);

    // Snap inward instantly when blocked (otherwise we'd see through the wall), ease otherwise.
    const t = snap || hit ? 1 : 1 - Math.exp(-dt * 12);
    this.camera.position.lerp(this.desired, t);
    this.camera.lookAt(this.focus);
  }

  private bindPointer(dom: HTMLElement): void {
    let dragging = false;
    dom.addEventListener("pointerdown", (e) => {
      dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointerup", (e) => {
      dragging = false;
      dom.releasePointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.rotate(-e.movementX * 0.005, e.movementY * 0.004);
    });
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, MIN_DISTANCE, MAX_DISTANCE);
      },
      { passive: false },
    );
  }
}
