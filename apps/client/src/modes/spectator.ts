import * as THREE from "three";
import {
  Msg,
  type AnnouncementMessage,
  type CaptionMessage,
  type ChatMessage,
  type ChatSendMessage,
  type ReactionMessage,
  type VoteAckMessage,
  type HouseStateView,
  type VoteMessage,
  type GameErrorMessage,
  type GameTableView,
  type PartyEffectMessage,
} from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { PartyRoom } from "../scene/partyRoom.js";
import { DayNight } from "../scene/dayNight.js";
import { SpectatorCamera, type CameraMode } from "../scene/spectatorCamera.js";
import { AutoDirector } from "../scene/autoDirector.js";
import { isTyping } from "../input/keyboard.js";
import type { HouseRoom } from "../net/connection.js";
import { moviePlaybackUrl } from "../net/movies.js";
import { getSessionToken, paymentsApi } from "../net/api.js";
import { getStateCallbacks } from "../net/stateCallbacks.js";
import { ChatPanel } from "../ui/chat.js";
import { CaptionFeed } from "../ui/captions.js";
import { showDisconnected } from "../ui/lobby.js";
import { SpectatorHud, areaForKey } from "../ui/spectatorHud.js";
import { connectVoice } from "../voice/connectVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import type { RoutedVoice } from "../voice/VoiceProvider.js";
import { PlayersView } from "./playersView.js";
import { applyVoiceRouting } from "../voice/voiceRouting.js";
import { Banners } from "../ui/banner.js";
import { RoundPanel, WinnerScreen } from "../ui/roundPanel.js";
import { TaskPanel } from "../ui/taskPanel.js";
import { GemsView } from "../scene/gems.js";
import { PropsView } from "../scene/props.js";
import { StationSigns } from "../scene/gameHall.js";
import { GamePanel } from "../games/panel.js";
import { LiveGamesList } from "../games/liveGames.js";

/**
 * Spectator mode (/watch). There is no avatar: the viewer receives the same
 * live state as housemates and renders the house from it, so watching costs
 * no video encoding — just the game state and (for the first few viewers) audio.
 */
export function startSpectatorMode(container: HTMLElement, room: HouseRoom, audioCtx: AudioContext, seasonId: string): void {
  const { renderer, scene, camera, sun, hemi } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);
  const dayNight = new DayNight(scene, sun, hemi, house.root);
  const party = new PartyRoom(house.root, scene);
  room.onMessage(Msg.partyEffect, ({ kind }: PartyEffectMessage) => party.play(kind));
  const cam = new SpectatorCamera(camera, house.cameraBlockers, renderer.domElement);

  // --- audio: receive-only links to every housemate, heard from the camera ---
  let voice: RoutedVoice | null = null;
  const $ = getStateCallbacks(room);

  const players = new PlayersView(scene, room, $, null);
  const props = new PropsView(scene, room, (id) => players.avatarOf(id));

  // --- games hall: viewers can watch any game in progress ---
  const stationSigns = new StationSigns(scene);
  const gamePanel = new GamePanel(container, { send: (type, message) => room.send(type, message), canPlay: false });
  room.onMessage(Msg.gameTable, (table: GameTableView) => gamePanel.onTable(table));
  room.onMessage(Msg.gameError, (msg: GameErrorMessage) => gamePanel.onError(msg));
  // Top-left column under the status bar: live captions, then games in progress.
  const leftColumn = document.createElement("div");
  leftColumn.className = "spec-left";
  container.append(leftColumn);
  const houseChatSlot = document.createElement("div");
  houseChatSlot.className = "house-chat-slot";
  leftColumn.append(houseChatSlot);
  const captions = new CaptionFeed(leftColumn, (ids) => {
    const id = ids.find((i) => players.remotes.has(i));
    if (id) setCamera({ kind: "follow", playerId: id });
  });
  const liveGames = new LiveGamesList(leftColumn, (id) => gamePanel.open(id));

  // --- HUD ---
  let following: string | null = null;
  // The auto director drives the camera until the viewer picks a camera or housemate themselves.
  let auto = true;
  const director = new AutoDirector();
  const lastChatAt = new Map<string, number>();
  const lastCaptionAt = new Map<string, number>();
  let directorCheckAt = 0;
  const setCamera = (mode: CameraMode, fromDirector = false) => {
    if (!fromDirector) auto = false;
    if (mode.kind === "follow") {
      const target = players.remotes.get(mode.playerId);
      if (!target) {
        if (fromDirector) director.reset(); // not drawn yet: re-plan next check
        return;
      }
      following = mode.playerId;
      cam.setMode(mode, { x: target.avatar.root.position.x, z: target.avatar.root.position.z, rotY: target.avatar.root.rotation.y });
      hud.setCamera(mode, target.state.name, auto);
    } else {
      following = null;
      cam.setMode(mode);
      hud.setCamera(mode, undefined, auto);
    }
  };

  const hud = new SpectatorHud(container, {
    onCamera: setCamera,
    onReact: (emoji) => {
      hud.floatReaction(emoji);
      const message: ReactionMessage = { emoji };
      room.send(Msg.viewerReact, message);
    },
    onAuto: () => {
      auto = true;
      director.reset();
      directorCheckAt = 0;
    },
  });
  hud.setCamera(cam.mode, undefined, auto);
  hud.setAudioStatus("Connecting audio…", true);
  // A viewer never sends audio. Mesh viewers past the listen cap get silence;
  // LiveKit viewers all subscribe.
  void connectVoice(room, new SpatialAudio(audioCtx), () => true, null).then(({ voice: v, grant }) => {
    voice = v;
    if (v) players.setVoice(v);
    if (!v) {
      hud.setAudioStatus(
        grant.provider === "livekit" ? "🔇 Couldn't open live audio" : "🔇 Audio is full for now — more listeners coming soon",
        false,
      );
      return;
    }
    hud.setAudioStatus("🔊 Live audio — you hear what the camera hears", true);
  });
  $.listen("viewerCount", (n) => hud.setViewerCount(n));
  house.tv.attach(audioCtx);
  party.attach(audioCtx);
  const syncTv = () => {
    const state = room.state as HouseStateView;
    house.tv.setChannel(state.tvChannel, moviePlaybackUrl(seasonId, state.tvChannel, state.tvMovie));
    house.tv.setOn(state.tvOn);
    house.tv.setStation(state.tvStation);
    house.tv.setTheater(state.theaterOn);
  };
  $.listen("tvOn", syncTv);
  $.listen("tvChannel", syncTv);
  $.listen("tvMovie", syncTv);
  $.listen("theaterOn", syncTv);
  $.listen("tvStation", syncTv);
  syncTv();
  const syncDoors = () => house.doors.setOpen((room.state as HouseStateView).openDoors ?? "");
  $.listen("openDoors", syncDoors);
  syncDoors();

  // If the housemate we follow leaves, fall back to the lounge camera (in auto, the director picks the next shot).
  $.onRemove("players", (_p, id) => {
    if (id === following && !auto) setCamera({ kind: "house", area: "lounge" });
  });

  // House chat is visible to viewers (read-only); viewer chat is only ever sent to viewers.
  const houseChat = new ChatPanel(houseChatSlot, () => {}, { className: "house-chat", label: "House chat", readOnly: true, live: true });
  const viewerChat = new ChatPanel(
    hud.rightColumn,
    (text) => {
      const message: ChatSendMessage = { text };
      room.send(Msg.viewerChat, message);
    },
    { className: "viewer-chat", label: "Viewer chat", placeholder: matchMedia("(pointer: coarse)").matches ? "Chat with viewers…" : "Chat with viewers (Enter)", live: true },
  );
  room.onMessage(Msg.chat, (msg: ChatMessage) => {
    houseChat.add(msg);
    lastChatAt.set(msg.fromId, performance.now());
    players.avatarOf(msg.fromId)?.showChat(msg.text);
  });
  room.onMessage(Msg.chatHistory, (h: ChatMessage[]) => h.forEach((m) => houseChat.add(m)));
  room.onMessage(Msg.viewerChat, (msg: ChatMessage) => viewerChat.add(msg));
  room.onMessage(Msg.viewerChatHistory, (h: ChatMessage[]) => h.forEach((m) => viewerChat.add(m)));
  room.onMessage(Msg.viewerReact, ({ emoji }: ReactionMessage) => hud.floatReaction(emoji));
  room.onMessage(Msg.caption, (c: CaptionMessage) => {
    captions.add(c);
    for (const id of c.focus) lastCaptionAt.set(id, performance.now());
  });
  room.onMessage(Msg.captionHistory, (list: CaptionMessage[]) => captions.addHistory(list, room.state.serverTime || Date.now()));

  // Big Brother: announcements, tasks (watch only), Diary Room transcript when it's broadcast.
  const banners = new Banners(container);
  const roundPanel = new RoundPanel(container, {
    canVote: true,
    signedIn: !!getSessionToken(),
    onVote: (token) => {
      const message: VoteMessage = { token };
      room.send(Msg.vote, message);
    },
  });
  room.onMessage(Msg.voteAck, ({ ok, text, token }: VoteAckMessage) => roundPanel.setVoteResult(ok, text, token));
  if (getSessionToken() && seasonId) {
    void paymentsApi.config().then((cfg) => {
      if (!cfg.enabled) return;
      roundPanel.setPacks(cfg.packs, (packId) => {
        void paymentsApi.checkout(packId, seasonId).then(
          (url) => {
            location.href = url;
          },
          (err) => roundPanel.setVoteResult(false, err instanceof Error ? err.message : "Couldn't start the payment.", ""),
        );
      });
    }).catch(() => {});
  }
  const winner = new WinnerScreen(container);
  const taskPanel = new TaskPanel(container, {});
  const gems = new GemsView(scene);
  room.onMessage(Msg.announcement, ({ text, to }: AnnouncementMessage) => {
    if (to === "all") banners.announce(text);
  });
  const diaryChat = new ChatPanel(container, () => {}, { className: "diary-chat", label: "Diary Room", readOnly: true });
  diaryChat.setVisible(false);
  room.onMessage(Msg.diaryChat, (msg: ChatMessage) => diaryChat.add(msg));
  let diaryShown = "";
  const routingTimer = setInterval(() => {
    if (voice) applyVoiceRouting(voice, room.sessionId, room.state);
  }, 100);
  room.send(Msg.chatHistory);
  room.send(Msg.viewerChatHistory);
  room.send(Msg.captionHistory);

  window.addEventListener("keydown", (e) => {
    if (e.repeat || isTyping(e)) return;
    const choice = areaForKey(e.key);
    if (choice === "free") setCamera({ kind: "free" });
    else if (choice) setCamera({ kind: "house", area: choice });
  });

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    clearInterval(routingTimer);
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
    props.update(dt);
    stationSigns.update(room.state);
    liveGames.update(room.state);

    const now = performance.now();
    if (auto && now >= directorCheckAt) {
      directorCheckAt = now + 500;
      const state = room.state as HouseStateView;
      const shot = director.next(now, {
        players: [...(room.state.players?.entries() ?? [])].map(([id, p]) => ({ id, x: p.x, z: p.z, speaking: p.speaking, activity: p.activity })),
        diaryBroadcast: state.diaryHousemate && state.diaryBroadcast ? state.diaryHousemate : null,
        partyOn: !!state.partyOn,
        lastChatAt,
        lastCaptionAt,
      });
      if (shot) setCamera(shot, true);
    }

    const target = following ? players.remotes.get(following)?.avatar.root : undefined;
    cam.update(dt, target ? { x: target.position.x, z: target.position.z, rotY: target.rotation.y } : undefined);
    const ears = cam.listener;
    voice?.setListenerPosition({ x: ears.x, y: ears.y, z: ears.z }, ears.yaw);

    hud.setHousemates([...(room.state.players?.entries() ?? [])], following);
    if (voice) applyVoiceRouting(voice, room.sessionId, room.state);
    roundPanel.update(room.state);
    winner.update(room.state);
    taskPanel.update(room.state);
    gems.update(dt, room.state.task);

    const diaryWho = room.state.diaryHousemate ? room.state.players?.get(room.state.diaryHousemate)?.name : undefined;
    const diaryKey = diaryWho ? `${diaryWho}|${room.state.diaryBroadcast}` : "";
    if (diaryKey !== diaryShown) {
      if (!diaryShown || !diaryKey.startsWith(diaryShown.split("|")[0]!)) diaryChat.clear();
      diaryShown = diaryKey;
      diaryChat.setVisible(!!diaryWho && room.state.diaryBroadcast);
      banners.setStatus(
        "diary",
        diaryWho
          ? room.state.diaryBroadcast
            ? `🎙️ ${diaryWho} is in the Diary Room — press 6 to watch`
            : `🔒 ${diaryWho} is in the Diary Room (private session)`
          : null,
        "live",
      );
    }
    house.tv.animate(dt);
    house.doors.animate(dt);
    house.guards.animate(dt);
    dayNight.update((room.state as HouseStateView).dayMinutes ?? 600);
    house.lights.set((room.state as HouseStateView).lightsOff ?? "");
    party.update(dt, !!(room.state as HouseStateView).partyOn);
    house.setShowers(new Set([...(room.state.players?.values() ?? [])].map((p) => p.activity).filter((a) => a.startsWith("shower-"))));
    renderer.render(scene, camera);
  });
}
