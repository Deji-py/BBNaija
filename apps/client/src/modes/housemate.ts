import * as THREE from "three";
import {
  Msg,
  activityExit,
  areaAt,
  nearestInteractable,
  type ActionMessage,
  type ChatMessage,
  type ChatSendMessage,
  type EmoteMessage,
  type PlayerView,
  type VoiceStateMessage,
} from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { FollowCamera } from "../scene/followCamera.js";
import type { Avatar } from "../entities/avatar.js";
import { Keyboard, isTyping } from "../input/keyboard.js";
import { Hud } from "../ui/hud.js";
import { ChatPanel } from "../ui/chat.js";
import { showDisconnected } from "../ui/lobby.js";
import type { HouseRoom } from "../net/connection.js";
import { LocalPlayerController } from "../net/localPlayer.js";
import { lerpAngle } from "../net/interpolation.js";
import { getStateCallbacks } from "../net/stateCallbacks.js";
import { HEAD_HEIGHT, PlayersView, voiceIconFor } from "./playersView.js";
import { MeshVoiceProvider } from "../voice/meshVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import { SpeakingDetector, type MicResult } from "../voice/mic.js";
import { VoiceControls } from "../ui/voiceControls.js";

const TURN_SPEED = 2.2; // rad/s for Z/C camera turning
const FACE_TURN_RATE = 14; // how fast the avatar rotates to face its movement direction
/** Longest frame we simulate in one step. Prevents huge jumps (and wall tunnelling) after a tab stall. */
const MAX_DT = 0.05;
interface LocalPlayer {
  avatar: Avatar;
  controller: LocalPlayerController;
  state: PlayerView;
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

  // --- voice ---
  // Offer to other housemates with a larger session id; viewers always offer to us.
  const voice = new MeshVoiceProvider(
    room,
    new SpatialAudio(audioCtx),
    (id) => room.state.players.has(id) && room.sessionId < id,
  );
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

  // --- chat ---
  const chat = new ChatPanel(container, (text) => {
    const message: ChatSendMessage = { text };
    room.send(Msg.chat, message);
  });
  room.onMessage(Msg.chat, (msg: ChatMessage) => {
    chat.add(msg);
    const avatar = msg.fromId === room.sessionId ? local?.avatar : players.avatarOf(msg.fromId);
    avatar?.showChat(msg.text);
  });
  room.onMessage(Msg.chatHistory, (history: ChatMessage[]) => history.forEach((m) => chat.add(m)));
  room.send(Msg.chatHistory); // ask only after the handler above is registered

  // --- react to server state ---
  const $ = getStateCallbacks(room);
  const players = new PlayersView(scene, room, $, voice, (player, avatar) => {
    const controller = new LocalPlayerController({ x: player.x, z: player.z }, (input) => room.send(Msg.input, input));
    local = { avatar, controller, state: player };
    $.onChange(player, () => {
      const exit = player.activity ? activityExit(player.activity, player.x, player.z) : null;
      controller.reconcile(player.x, player.z, player.lastSeq, exit);
    });
    followCam.update(0, avatar.root.position, true);
  });
  players.onCountChange((n) => hud.setPlayerCount(n));

  $.listen("tvOn", (on) => house.tv.setOn(on));

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    clearInterval(voiceStateTimer);
    voice.leave();
    showDisconnected(container, code === 1000 ? "You left the house." : `Lost connection to the house (code ${code}).`);
  });

  // --- interaction & emote keys ---
  /** What pressing E would do right now (null = nothing in reach). */
  let eTarget: string | null = null;

  window.addEventListener("keydown", (e) => {
    if (e.repeat || isTyping(e) || !local) return;
    if (e.code === "KeyE" && eTarget) {
      const message: ActionMessage = { objectId: eTarget };
      room.send(Msg.action, message);
    } else if (e.code === "Digit1" || e.code === "Digit2") {
      const message: EmoteMessage = { name: e.code === "Digit1" ? "wave" : "dance" };
      room.send(Msg.emote, message);
    }
  });

  /** Works out the "Press E" prompt from where we are and who's using what. */
  function updatePrompt(me: PlayerView, x: number, z: number): void {
    if (me.activity) {
      eTarget = me.activity;
      hud.setPrompt(me.activity === "pool" ? "Get out of the pool" : "Get up");
      return;
    }
    const it = nearestInteractable(x, z);
    eTarget = null;
    if (!it) return hud.setPrompt(null);
    if (it.kind === "toggle") {
      eTarget = it.id;
      return hud.setPrompt(room.state.tvOn ? it.promptOff : it.prompt);
    }
    const users = [...room.state.players.values()].filter((p) => p.activity === it.id).length;
    const capacity = it.kind === "slots" ? it.slots.length : it.capacity;
    if (users >= capacity) return hud.setPrompt(it.kind === "pool" ? "The pool is full" : "Someone's using that", false);
    eTarget = it.id;
    hud.setPrompt(it.prompt);
  }

  // Dev-only handle for poking at the scene from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __bbn: { room, scene, remotes: players.remotes, voice, audioCtx, followCam, getLocal: () => local } });

  // --- game loop ---
  const clock = new THREE.Clock();
  const move = new THREE.Vector2();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), MAX_DT);

    if (local) {
      if (keyboard.isDown("KeyZ")) followCam.rotate(TURN_SPEED * dt);
      if (keyboard.isDown("KeyC")) followCam.rotate(-TURN_SPEED * dt);

      const { forward, right } = keyboard.moveAxes();
      const yaw = followCam.yaw;
      // "Forward" points from the camera toward the player, flattened onto the ground.
      move.set(-Math.sin(yaw) * forward + Math.cos(yaw) * right, -Math.cos(yaw) * forward - Math.sin(yaw) * right);
      if (move.lengthSq() > 1) move.normalize(); // diagonal shouldn't be faster
      const moving = move.lengthSq() > 0;

      const me = local.state;
      const pos = local.avatar.root.position;
      const next = local.controller.update(dt, move.x, move.y);
      const speed = dt > 0 ? Math.hypot(next.x - pos.x, next.z - pos.z) / dt : 0;
      pos.x = next.x;
      pos.z = next.z;
      if (moving) {
        const targetRot = Math.atan2(move.x, move.y);
        local.avatar.root.rotation.y = lerpAngle(local.avatar.root.rotation.y, targetRot, Math.min(dt * FACE_TURN_RATE, 1));
      } else if (me.activity) {
        local.avatar.root.rotation.y = me.rotY; // face the way the seat/bed/stove points
      }
      // Our own walking is predicted locally; anything else (sitting, dancing…) comes from the server.
      const serverAnim = me.anim === "walk" || me.anim === "idle" ? null : me.anim;
      local.avatar.update(dt, speed, moving || !serverAnim ? undefined : serverAnim);

      // Our ears follow the avatar, facing where the camera looks.
      voice.setListenerPosition({ x: pos.x, y: HEAD_HEIGHT, z: pos.z }, followCam.yaw);
      if (sentVoiceState) local.avatar.setVoiceState(voiceIconFor(sentVoiceState));

      followCam.update(dt, pos);
      hud.setArea(areaAt(pos.x, pos.z)?.label ?? "Outside");
      updatePrompt(me, pos.x, pos.z);
    }

    players.update(dt);

    house.tv.animate(dt);
    hud.tick(dt);
    renderer.render(scene, camera);
  });
}
