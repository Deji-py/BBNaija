import * as THREE from "three";
import { Callbacks } from "@colyseus/sdk";
import { Msg, areaAt, type PlayerView } from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { FollowCamera } from "../scene/followCamera.js";
import { Avatar } from "../entities/avatar.js";
import { Keyboard } from "../input/keyboard.js";
import { Hud } from "../ui/hud.js";
import { showDisconnected } from "../ui/lobby.js";
import type { HouseRoom } from "../net/connection.js";
import { LocalPlayerController } from "../net/localPlayer.js";
import { SnapshotBuffer, lerpAngle } from "../net/interpolation.js";

const TURN_SPEED = 2.2; // rad/s for Q/E camera turning
const FACE_TURN_RATE = 14; // how fast the avatar rotates to face its movement direction
/** Longest frame we simulate in one step. Prevents huge jumps (and wall tunnelling) after a tab stall. */
const MAX_DT = 0.05;

interface RemotePlayer {
  avatar: Avatar;
  buffer: SnapshotBuffer;
}

interface LocalPlayer {
  avatar: Avatar;
  controller: LocalPlayerController;
}

/**
 * Housemate mode: you control one avatar; everyone else in the room is drawn
 * from server state.
 *
 * The game loop: every animation frame we (1) read input, (2) update the
 * simulation by the elapsed time `dt`, and (3) render. Scaling movement by
 * `dt` keeps speed the same whether the screen runs at 30, 60 or 144 Hz.
 */
export function startHousemateMode(container: HTMLElement, room: HouseRoom): void {
  const { renderer, scene, camera } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);

  const followCam = new FollowCamera(camera, house.cameraBlockers, renderer.domElement);
  followCam.yaw = 0;
  const keyboard = new Keyboard();
  const hud = new Hud(container);

  let local: LocalPlayer | null = null;
  const remotes = new Map<string, RemotePlayer>();

  // --- react to server state ---
  const $ = Callbacks.get(room as never) as unknown as StateCallbacks;

  $.onAdd("players", (player, id) => {
    const avatar = new Avatar(player.name, player.color);
    avatar.root.position.set(player.x, 0, player.z);
    avatar.root.rotation.y = player.rotY;
    scene.add(avatar.root);

    if (id === room.sessionId) {
      const controller = new LocalPlayerController({ x: player.x, z: player.z }, (input) =>
        room.send(Msg.input, input),
      );
      local = { avatar, controller };
      $.onChange(player, () => controller.reconcile(player.x, player.z, player.lastSeq));
      followCam.update(0, avatar.root.position, true);
    } else {
      const remote: RemotePlayer = { avatar, buffer: new SnapshotBuffer(player) };
      remotes.set(id, remote);
      $.onChange(player, () => remote.buffer.push(player));
    }
    hud.setPlayerCount(room.state.players.size);
  });

  $.onRemove("players", (_player, id) => {
    remotes.get(id)?.avatar.dispose();
    remotes.delete(id);
    hud.setPlayerCount(room.state.players.size);
  });

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    showDisconnected(container, code === 1000 ? "You left the house." : `Lost connection to the house (code ${code}).`);
  });

  // Dev-only handle for poking at the scene from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __bbn: { room, remotes, getLocal: () => local } });

  // --- game loop ---
  const clock = new THREE.Clock();
  const move = new THREE.Vector2();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), MAX_DT);

    if (local) {
      if (keyboard.isDown("KeyQ")) followCam.rotate(TURN_SPEED * dt);
      if (keyboard.isDown("KeyE")) followCam.rotate(-TURN_SPEED * dt);

      const { forward, right } = keyboard.moveAxes();
      const yaw = followCam.yaw;
      // "Forward" points from the camera toward the player, flattened onto the ground.
      move.set(-Math.sin(yaw) * forward + Math.cos(yaw) * right, -Math.cos(yaw) * forward - Math.sin(yaw) * right);
      if (move.lengthSq() > 1) move.normalize(); // diagonal shouldn't be faster

      const pos = local.avatar.root.position;
      const next = local.controller.update(dt, move.x, move.y);
      const speed = dt > 0 ? Math.hypot(next.x - pos.x, next.z - pos.z) / dt : 0;
      pos.x = next.x;
      pos.z = next.z;
      if (move.lengthSq() > 0) {
        const targetRot = Math.atan2(move.x, move.y);
        local.avatar.root.rotation.y = lerpAngle(local.avatar.root.rotation.y, targetRot, Math.min(dt * FACE_TURN_RATE, 1));
      }
      local.avatar.update(dt, speed);

      followCam.update(dt, pos);
      hud.setArea(areaAt(pos.x, pos.z)?.label ?? "Outside");
    }

    const now = performance.now();
    for (const { avatar, buffer } of remotes.values()) {
      const pose = buffer.sample(now);
      const pos = avatar.root.position;
      const speed = dt > 0 ? Math.hypot(pose.x - pos.x, pose.z - pos.z) / dt : 0;
      pos.set(pose.x, 0, pose.z);
      avatar.root.rotation.y = pose.rotY;
      avatar.update(dt, speed);
    }

    hud.tick(dt);
    renderer.render(scene, camera);
  });
}

/**
 * The slice of the Colyseus callbacks API we use, typed against our shared
 * view types (the client decodes state by reflection and has no schema classes).
 */
interface StateCallbacks {
  onAdd(collection: "players", cb: (player: PlayerView, id: string) => void): () => void;
  onRemove(collection: "players", cb: (player: PlayerView, id: string) => void): () => void;
  onChange(instance: PlayerView, cb: () => void): () => void;
}
