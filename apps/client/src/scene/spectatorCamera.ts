import * as THREE from "three";
import { HOUSE_CAMERAS, type AreaId } from "@bbn/shared";
import { FollowCamera } from "./followCamera.js";
import { Keyboard } from "../input/keyboard.js";
import { lerpAngle } from "../net/interpolation.js";

export type CameraMode =
  | { kind: "house"; area: AreaId }
  | { kind: "follow"; playerId: string }
  | { kind: "free" };

const FLY_SPEED = 8; // m/s
const FLY_FAST = 3; // Shift multiplier
/** Free camera stays inside this box. */
const BOUNDS = { minX: -30, maxX: 30, minY: 0.5, maxY: 30, minZ: -25, maxZ: 40 };
/** After the viewer drags the follow camera, wait this long before swinging back behind the housemate. */
const FOLLOW_RESUME_MS = 3000;

/**
 * The three spectator camera modes:
 * - house:  fixed "CCTV" camera in a room — a hard cut, like switching channels;
 * - follow: third-person camera behind a housemate (drag to look around);
 * - free:   fly anywhere with WASD + mouse.
 */
export class SpectatorCamera {
  mode: CameraMode = { kind: "house", area: "lounge" };

  private readonly follow: FollowCamera;
  private readonly keyboard = new Keyboard();
  private readonly free = { pos: new THREE.Vector3(5, 12, 22), yaw: 0, pitch: -0.55 };
  private readonly forward = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    cameraBlockers: THREE.Object3D[],
    dom: HTMLElement,
  ) {
    this.follow = new FollowCamera(camera, cameraBlockers, dom);
    this.follow.pitch = 0.45;
    this.follow.distance = 6;
    this.bindFreeLook(dom);
    this.applyHouseCamera("lounge");
  }

  /** Our "ears" for spatial audio: the camera position and the way it faces (follow-camera yaw convention). */
  get listener(): { x: number; y: number; z: number; yaw: number } {
    this.camera.getWorldDirection(this.forward);
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      yaw: Math.atan2(-this.forward.x, -this.forward.z),
    };
  }

  setMode(mode: CameraMode, followTarget?: { x: number; z: number; rotY: number }): void {
    this.mode = mode;
    this.follow.pointerEnabled = mode.kind === "follow";
    if (mode.kind === "house") this.applyHouseCamera(mode.area);
    if (mode.kind === "follow" && followTarget) {
      this.follow.yaw = followTarget.rotY + Math.PI; // start behind them
      this.follow.update(0, new THREE.Vector3(followTarget.x, 0, followTarget.z), true);
    }
    if (mode.kind === "free") {
      // Start flying from wherever the camera is now.
      this.camera.getWorldDirection(this.forward);
      this.free.pos.copy(this.camera.position);
      this.free.yaw = Math.atan2(-this.forward.x, -this.forward.z);
      this.free.pitch = Math.asin(THREE.MathUtils.clamp(this.forward.y, -1, 1));
    }
  }

  /** `target` is the followed housemate's current (interpolated) pose, when following. */
  update(dt: number, target?: { x: number; z: number; rotY: number }): void {
    if (this.mode.kind === "follow" && target) {
      // Swing back behind the housemate unless the viewer has been steering.
      if (performance.now() - this.follow.lastDragAt > FOLLOW_RESUME_MS) {
        this.follow.yaw = lerpAngle(this.follow.yaw, target.rotY + Math.PI, Math.min(dt * 1.5, 1));
      }
      this.follow.update(dt, new THREE.Vector3(target.x, 0, target.z));
    } else if (this.mode.kind === "free") {
      this.updateFree(dt);
    }
  }

  private applyHouseCamera(area: AreaId): void {
    const cam = HOUSE_CAMERAS.find((c) => c.id === area) ?? HOUSE_CAMERAS[0]!;
    this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    this.camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
  }

  private updateFree(dt: number): void {
    const k = this.keyboard;
    const f = this.free;
    const speed = FLY_SPEED * (k.isDown("ShiftLeft", "ShiftRight") ? FLY_FAST : 1) * dt;
    const forward = (k.isDown("KeyW", "ArrowUp") ? 1 : 0) - (k.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const right = (k.isDown("KeyD", "ArrowRight") ? 1 : 0) - (k.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    const up = (k.isDown("KeyE", "Space") ? 1 : 0) - (k.isDown("KeyQ") ? 1 : 0);

    // Fly where you look (including up/down), strafe sideways, Q/E for straight down/up.
    const cp = Math.cos(f.pitch);
    f.pos.x += (-Math.sin(f.yaw) * cp * forward + Math.cos(f.yaw) * right) * speed;
    f.pos.z += (-Math.cos(f.yaw) * cp * forward - Math.sin(f.yaw) * right) * speed;
    f.pos.y += (Math.sin(f.pitch) * forward + up) * speed;
    f.pos.set(
      THREE.MathUtils.clamp(f.pos.x, BOUNDS.minX, BOUNDS.maxX),
      THREE.MathUtils.clamp(f.pos.y, BOUNDS.minY, BOUNDS.maxY),
      THREE.MathUtils.clamp(f.pos.z, BOUNDS.minZ, BOUNDS.maxZ),
    );

    this.camera.position.copy(f.pos);
    this.camera.lookAt(
      f.pos.x - Math.sin(f.yaw) * cp,
      f.pos.y + Math.sin(f.pitch),
      f.pos.z - Math.cos(f.yaw) * cp,
    );
  }

  private bindFreeLook(dom: HTMLElement): void {
    let dragging = false;
    dom.addEventListener("pointerdown", () => {
      if (this.mode.kind === "free") dragging = true;
    });
    window.addEventListener("pointerup", () => (dragging = false));
    dom.addEventListener("pointermove", (e) => {
      if (!dragging || this.mode.kind !== "free") return;
      this.free.yaw -= e.movementX * 0.004;
      this.free.pitch = THREE.MathUtils.clamp(this.free.pitch - e.movementY * 0.004, -1.4, 1.4);
    });
  }
}
