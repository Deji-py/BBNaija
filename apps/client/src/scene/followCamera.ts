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
  /** When false, mouse drag/wheel are ignored (another camera mode owns the mouse). */
  pointerEnabled = true;
  /** performance.now() of the last mouse drag — lets an auto-follow camera back off while the user steers. */
  lastDragAt = -Infinity;

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
    // Deltas come from positions rather than movementX/Y, which touch screens don't reliably report.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const lift = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = spread();
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    dom.addEventListener("pointerdown", (e) => {
      if (!this.pointerEnabled) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = spread();
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointerup", lift);
    dom.addEventListener("pointercancel", lift);
    dom.addEventListener("pointermove", (e) => {
      const last = pointers.get(e.pointerId);
      if (!last || !this.pointerEnabled) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;
      this.lastDragAt = performance.now();
      if (pointers.size >= 2) {
        // Two fingers: pinch to zoom.
        const now = spread();
        if (pinch > 0) this.distance = THREE.MathUtils.clamp(this.distance * (pinch / Math.max(now, 1)), MIN_DISTANCE, MAX_DISTANCE);
        pinch = now;
        return;
      }
      const touch = e.pointerType === "touch" ? 1.6 : 1;
      this.rotate(-dx * 0.005 * touch, dy * 0.004 * touch);
    });
    dom.addEventListener(
      "wheel",
      (e) => {
        if (!this.pointerEnabled) return;
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, MIN_DISTANCE, MAX_DISTANCE);
      },
      { passive: false },
    );
  }
}
