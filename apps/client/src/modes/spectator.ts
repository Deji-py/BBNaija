import * as THREE from "three";
import {
  Msg,
  type ChatMessage,
  type ChatSendMessage,
  type ReactionMessage,
  type ViewerWelcome,
} from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { SpectatorCamera, type CameraMode } from "../scene/spectatorCamera.js";
import { isTyping } from "../input/keyboard.js";
import type { HouseRoom } from "../net/connection.js";
import { getStateCallbacks } from "../net/stateCallbacks.js";
import { ChatPanel } from "../ui/chat.js";
import { showDisconnected } from "../ui/lobby.js";
import { SpectatorHud, areaForKey } from "../ui/spectatorHud.js";
import { MeshVoiceProvider } from "../voice/meshVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import { PlayersView } from "./playersView.js";

/**
 * Spectator mode (/watch). There is no avatar: the viewer receives the same
 * live state as housemates and renders the house from it, so watching costs
 * no video encoding — just the game state and (for the first few viewers) audio.
 */
export function startSpectatorMode(container: HTMLElement, room: HouseRoom, audioCtx: AudioContext): void {
  const { renderer, scene, camera } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);
  const cam = new SpectatorCamera(camera, house.cameraBlockers, renderer.domElement);

  // --- audio: receive-only links to every housemate, heard from the camera ---
  let voice: MeshVoiceProvider | null = null;
  const $ = getStateCallbacks(room);

  // The server tells us right after joining whether we got an audio slot.
  // Until then (and if not), PlayersView runs without voice. A viewer always
  // makes the offer: housemates don't know who's watching.
  const voiceReady = new Promise<MeshVoiceProvider | null>((resolve) => {
    room.onMessage(Msg.viewerWelcome, ({ audio }: ViewerWelcome) => {
      if (!audio) {
        hud.setAudioStatus("🔇 Audio is full for now — more listeners coming soon", false);
        return resolve(null);
      }
      const v = new MeshVoiceProvider(room, new SpatialAudio(audioCtx), () => true);
      v.join(null);
      hud.setAudioStatus("🔊 Live audio — you hear what the camera hears", true);
      resolve(v);
    });
  });

  const players = new PlayersView(scene, room, $, null);
  void voiceReady.then((v) => {
    voice = v;
    if (v) players.setVoice(v);
  });

  // --- HUD ---
  let following: string | null = null;
  const setCamera = (mode: CameraMode) => {
    if (mode.kind === "follow") {
      const target = players.remotes.get(mode.playerId);
      if (!target) return;
      following = mode.playerId;
      cam.setMode(mode, { x: target.avatar.root.position.x, z: target.avatar.root.position.z, rotY: target.avatar.root.rotation.y });
      hud.setCamera(mode, target.state.name);
    } else {
      following = null;
      cam.setMode(mode);
      hud.setCamera(mode);
    }
  };

  const hud = new SpectatorHud(container, {
    onCamera: setCamera,
    onReact: (emoji) => {
      const message: ReactionMessage = { emoji };
      room.send(Msg.viewerReact, message);
    },
  });
  hud.setCamera(cam.mode);
  hud.setAudioStatus("Connecting audio…", true);
  $.listen("viewerCount", (n) => hud.setViewerCount(n));
  $.listen("tvOn", (on) => house.tv.setOn(on));

  // If the housemate we follow leaves, fall back to the lounge camera.
  $.onRemove("players", (_p, id) => {
    if (id === following) setCamera({ kind: "house", area: "lounge" });
  });

  // House chat is visible to viewers (read-only); viewer chat is only ever sent to viewers.
  const houseChat = new ChatPanel(container, () => {}, { className: "house-chat", label: "House chat", readOnly: true });
  const viewerChat = new ChatPanel(
    hud.rightColumn,
    (text) => {
      const message: ChatSendMessage = { text };
      room.send(Msg.viewerChat, message);
    },
    { className: "viewer-chat", label: "Viewer chat", placeholder: "Chat with other viewers (Enter)" },
  );
  room.onMessage(Msg.chat, (msg: ChatMessage) => {
    houseChat.add(msg);
    players.avatarOf(msg.fromId)?.showChat(msg.text);
  });
  room.onMessage(Msg.chatHistory, (h: ChatMessage[]) => h.forEach((m) => houseChat.add(m)));
  room.onMessage(Msg.viewerChat, (msg: ChatMessage) => viewerChat.add(msg));
  room.onMessage(Msg.viewerChatHistory, (h: ChatMessage[]) => h.forEach((m) => viewerChat.add(m)));
  room.onMessage(Msg.viewerReact, ({ emoji }: ReactionMessage) => hud.floatReaction(emoji));
  room.send(Msg.chatHistory);
  room.send(Msg.viewerChatHistory);

  window.addEventListener("keydown", (e) => {
    if (e.repeat || isTyping(e)) return;
    const choice = areaForKey(e.key);
    if (choice === "free") setCamera({ kind: "free" });
    else if (choice) setCamera({ kind: "house", area: choice });
  });

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    voice?.leave();
    showDisconnected(container, code === 1000 ? "You stopped watching." : `Lost connection to the house (code ${code}).`);
  });

  if (import.meta.env.DEV) {
    Object.assign(window, { __bbn: { room, scene, cam, remotes: players.remotes, getVoice: () => voice, audioCtx } });
  }

  // --- render loop ---
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    players.update(dt);

    const target = following ? players.remotes.get(following)?.avatar.root : undefined;
    cam.update(dt, target ? { x: target.position.x, z: target.position.z, rotY: target.rotation.y } : undefined);
    const ears = cam.listener;
    voice?.setListenerPosition({ x: ears.x, y: ears.y, z: ears.z }, ears.yaw);

    hud.setHousemates([...(room.state.players?.entries() ?? [])], following);
    house.tv.animate(dt);
    renderer.render(scene, camera);
  });
}
