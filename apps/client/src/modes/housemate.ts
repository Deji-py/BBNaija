import * as THREE from "three";
import { Callbacks } from "@colyseus/sdk";
import { Msg, areaAt, type PlayerView, type VoiceStateMessage } from "@bbn/shared";
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
import { MeshVoiceProvider } from "../voice/meshVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import { SpeakingDetector, type MicResult } from "../voice/mic.js";
import { VoiceControls } from "../ui/voiceControls.js";
import type { VoiceIconState } from "../entities/voiceIcon.js";

const TURN_SPEED = 2.2; // rad/s for Q/E camera turning
const FACE_TURN_RATE = 14; // how fast the avatar rotates to face its movement direction
/** Longest frame we simulate in one step. Prevents huge jumps (and wall tunnelling) after a tab stall. */
const MAX_DT = 0.05;
/** Height of a housemate's mouth/ears, for positioning voices. */
const HEAD_HEIGHT = 1.65;

interface RemotePlayer {
  avatar: Avatar;
  buffer: SnapshotBuffer;
  state: PlayerView;
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
export function startHousemateMode(container: HTMLElement, room: HouseRoom, audioCtx: AudioContext, mic: MicResult): void {
  const { renderer, scene, camera } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);

  const followCam = new FollowCamera(camera, house.cameraBlockers, renderer.domElement);
  followCam.yaw = 0;
  const keyboard = new Keyboard();
  const hud = new Hud(container);

  let local: LocalPlayer | null = null;
  const remotes = new Map<string, RemotePlayer>();

  // --- voice ---
  const voice = new MeshVoiceProvider(room, new SpatialAudio(audioCtx));
  const voiceControls = new VoiceControls(container, mic.stream !== null, mic.stream ? undefined : mic.reason);
  const speaking = mic.stream ? new SpeakingDetector(audioCtx, mic.stream) : null;
  voice.join(mic.stream);
  voiceControls.onTransmitChange((transmitting) => voice.setMuted(!transmitting));

  // Speaking detection runs on a timer rather than the render loop, so the
  // indicator stays right while this tab is in the background.
  let sentVoiceState: VoiceStateMessage | null = null;
  const voiceStateTimer = setInterval(() => {
    const transmitting = voiceControls.isTransmitting();
    const state: VoiceStateMessage = {
      speaking: transmitting && (speaking?.isSpeaking() ?? false),
      muted: !mic.stream || voiceControls.muted,
    };
    if (state.speaking !== sentVoiceState?.speaking || state.muted !== sentVoiceState.muted) {
      room.send(Msg.voiceState, state);
      sentVoiceState = state;
    }
  }, 100);

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
      const remote: RemotePlayer = { avatar, buffer: new SnapshotBuffer(player), state: player };
      remotes.set(id, remote);
      $.onChange(player, () => remote.buffer.push(player));
      if (player.voice) voice.addPeer(id);
    }
    hud.setPlayerCount(room.state.players.size);
  });

  $.onRemove("players", (_player, id) => {
    voice.removePeer(id);
    remotes.get(id)?.avatar.dispose();
    remotes.delete(id);
    hud.setPlayerCount(room.state.players.size);
  });

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    clearInterval(voiceStateTimer);
    voice.leave();
    showDisconnected(container, code === 1000 ? "You left the house." : `Lost connection to the house (code ${code}).`);
  });

  // Dev-only handle for poking at the scene from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __bbn: { room, remotes, voice, audioCtx, getLocal: () => local } });

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
      // Our ears follow the avatar, facing where the camera looks.
      voice.setListenerPosition({ x: pos.x, y: HEAD_HEIGHT, z: pos.z }, followCam.yaw);
      if (sentVoiceState) local.avatar.setVoiceState(iconFor(sentVoiceState));

      local.avatar.update(dt, speed);

      followCam.update(dt, pos);
      hud.setArea(areaAt(pos.x, pos.z)?.label ?? "Outside");
    }

    const now = performance.now();
    for (const [id, { avatar, buffer, state }] of remotes) {
      const pose = buffer.sample(now);
      voice.setSourcePosition(id, { x: pose.x, y: HEAD_HEIGHT, z: pose.z });
      avatar.setVoiceState(state.voice ? iconFor(state) : "none");
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

function iconFor(s: { speaking: boolean; muted: boolean }): VoiceIconState {
  return s.muted ? "muted" : s.speaking ? "speaking" : "none";
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
