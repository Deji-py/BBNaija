import * as THREE from "three";
import { SPAWN_POINT, WALK_SPEED, areaAt, moveWithCollision } from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { FollowCamera } from "../scene/followCamera.js";
import { Avatar } from "../entities/avatar.js";
import { Keyboard } from "../input/keyboard.js";
import { Hud } from "../ui/hud.js";

const TURN_SPEED = 2.2; // rad/s for Q/E camera turning
const FACE_TURN_RATE = 14; // how fast the avatar rotates to face its movement direction
/** Longest frame we simulate in one step. Prevents huge jumps (and wall tunnelling) after a tab stall. */
const MAX_DT = 0.05;

/**
 * Solo housemate mode (M1): one local avatar walking around the house.
 *
 * The game loop: every animation frame we (1) read input, (2) update the
 * simulation by the elapsed time `dt`, and (3) render. Scaling movement by
 * `dt` keeps speed the same whether the screen runs at 30, 60 or 144 Hz.
 */
export function startHousemateMode(container: HTMLElement, name: string, color: string): void {
  const { renderer, scene, camera } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);

  const avatar = new Avatar(name, color);
  avatar.root.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
  avatar.root.rotation.y = Math.PI; // face north, away from the camera
  scene.add(avatar.root);

  const followCam = new FollowCamera(camera, house.cameraBlockers, renderer.domElement);
  followCam.yaw = 0;
  followCam.update(0, avatar.root.position, true);

  const keyboard = new Keyboard();
  const hud = new Hud(container);

  const clock = new THREE.Clock();
  const move = new THREE.Vector2();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), MAX_DT);

    // --- input → camera-relative movement direction ---
    if (keyboard.isDown("KeyQ")) followCam.rotate(TURN_SPEED * dt);
    if (keyboard.isDown("KeyE")) followCam.rotate(-TURN_SPEED * dt);

    const { forward, right } = keyboard.moveAxes();
    const yaw = followCam.yaw;
    // "Forward" points from the camera toward the player, flattened onto the ground.
    move.set(-Math.sin(yaw) * forward + Math.cos(yaw) * right, -Math.cos(yaw) * forward - Math.sin(yaw) * right);
    if (move.lengthSq() > 1) move.normalize(); // diagonal shouldn't be faster

    // --- simulate ---
    const pos = avatar.root.position;
    const next = moveWithCollision({ x: pos.x, z: pos.z }, move.x * WALK_SPEED * dt, move.y * WALK_SPEED * dt);
    const speed = dt > 0 ? Math.hypot(next.x - pos.x, next.z - pos.z) / dt : 0;
    pos.x = next.x;
    pos.z = next.z;

    if (move.lengthSq() > 0) {
      const targetRot = Math.atan2(move.x, move.y);
      avatar.root.rotation.y = lerpAngle(avatar.root.rotation.y, targetRot, Math.min(dt * FACE_TURN_RATE, 1));
    }
    avatar.update(dt, speed);

    followCam.update(dt, pos);
    hud.setArea(areaAt(pos.x, pos.z)?.label ?? "Outside");
    hud.tick(dt);

    // --- render ---
    renderer.render(scene, camera);
  });
}

/** Interpolates between two angles along the shortest way round. */
function lerpAngle(from: number, to: number, t: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * t;
}
