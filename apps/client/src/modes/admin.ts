import * as THREE from "three";
import {
  CloseCode,
  Msg,
  type AdminAnnounceMessage,
  type AdminDiaryBroadcastMessage,
  type AdminMuteMessage,
  type AdminOpenVotingMessage,
  type AdminRevealMessage,
  type AdminStartTaskMessage,
  type AdminTargetMessage,
  type AnnouncementMessage,
  type ChatMessage,
  type DiaryChatMessage,
  type EventLogEntry,
  type HouseStateView,
  type RoundAdminView,
  type VoiceStateMessage,
  type PartyEffectMessage,
} from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { PartyRoom } from "../scene/partyRoom.js";
import { DayNight } from "../scene/dayNight.js";
import { SpectatorCamera, type CameraMode } from "../scene/spectatorCamera.js";
import { GemsView } from "../scene/gems.js";
import { PropsView } from "../scene/props.js";
import { StationSigns } from "../scene/gameHall.js";
import { isTyping } from "../input/keyboard.js";
import type { HouseRoom } from "../net/connection.js";
import { moviePlaybackUrl } from "../net/movies.js";
import { getStateCallbacks } from "../net/stateCallbacks.js";
import { AdminPanel, type TalkTarget } from "../ui/adminPanel.js";
import { Banners } from "../ui/banner.js";
import { ChatPanel } from "../ui/chat.js";
import { showDisconnected } from "../ui/lobby.js";
import { SpectatorHud, areaForKey } from "../ui/spectatorHud.js";
import { RoundPanel, WinnerScreen } from "../ui/roundPanel.js";
import { TaskPanel } from "../ui/taskPanel.js";
import type { MicResult } from "../voice/mic.js";
import { connectVoice } from "../voice/connectVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import type { RoutedVoice } from "../voice/VoiceProvider.js";
import { applyVoiceRouting } from "../voice/voiceRouting.js";
import { PlayersView } from "./playersView.js";
import { adminApi, type ConsoleAuth } from "../net/api.js";

/**
 * The Big Brother console (/bigbrother): watch the house like a viewer, plus
 * the control panel. Big Brother's mic reaches housemates only while a
 * hold-to-talk button is held — the Diary Room button reaches just the
 * housemate in session, the house button reaches everyone.
 */
export function startAdminMode(
  container: HTMLElement,
  room: HouseRoom,
  audioCtx: AudioContext,
  mic: MicResult,
  auth: ConsoleAuth,
  seasonId: string,
): void {
  container.classList.add("admin-mode");
  const { renderer, scene, camera, sun, hemi } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);
  const dayNight = new DayNight(scene, sun, hemi, house.root);
  const party = new PartyRoom(house.root, scene);
  room.onMessage(Msg.partyEffect, ({ kind }: PartyEffectMessage) => party.play(kind));
  const cam = new SpectatorCamera(camera, house.cameraBlockers, renderer.domElement);
  const $ = getStateCallbacks(room);

  // --- voice: a link to every housemate; the routing below decides who actually hears us ---
  let voice: RoutedVoice | null = null;
  let talking: TalkTarget | null = null;
  const setTalk = (target: TalkTarget, held: boolean) => {
    const next = held ? target : talking === target ? null : talking;
    if (next === talking) return;
    talking = next;
    voice?.setMuted(!talking);
    panel.setTalking(talking);
    // Only house-wide talk shows "Big Brother is speaking" to housemates; a Diary Room
    // conversation must not be announced to the rest of the house.
    const message: VoiceStateMessage = { speaking: talking === "house", muted: !mic.stream };
    room.send(Msg.voiceState, message);
  };
  const route = () => {
    if (!voice) return;
    applyVoiceRouting(voice, room.sessionId, room.state, (peer, ctx) =>
      talking === "house" ? ctx.housemates.has(peer) : talking === "diary" ? peer === ctx.diaryHousemate : false,
    );
  };
  const routingTimer = setInterval(route, 100);

  const players = new PlayersView(scene, room, $, null);
  const props = new PropsView(scene, room, (id) => players.avatarOf(id));
  const stationSigns = new StationSigns(scene);
  void connectVoice(room, new SpatialAudio(audioCtx), (id) => room.state.players?.has(id) ?? false, mic.stream).then(({ voice: v }) => {
    voice = v;
    v?.setMuted(!talking);
    if (v) players.setVoice(v);
    route();
  });

  // --- camera bar (no viewer extras) ---
  let following: string | null = null;
  const setCamera = (mode: CameraMode) => {
    if (mode.kind === "follow") {
      const target = players.remotes.get(mode.playerId);
      if (!target) return;
      following = mode.playerId;
      const r = target.avatar.root;
      cam.setMode(mode, { x: r.position.x, z: r.position.z, rotY: r.rotation.y });
      hud.setCamera(mode, target.state.name);
    } else {
      following = null;
      cam.setMode(mode);
      hud.setCamera(mode);
    }
  };
  const hud = new SpectatorHud(container, { onCamera: setCamera, onReact: () => {} }, { housemates: false, reactions: false });
  hud.setCamera(cam.mode);
  hud.setAudioStatus(mic.stream ? "🎧 Listening from the camera · Diary Room at full volume" : `🎧 Listening only — ${mic.reason}`, true);
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
  $.onRemove("players", (_p, id) => {
    if (id === following) setCamera({ kind: "house", area: "lounge" });
  });

  // --- control panel ---
  const send = <T>(type: string, message?: T) => room.send(type, message);
  const panel = new AdminPanel(
    container,
    {
      onAnnounce: (text) => send<AdminAnnounceMessage>(Msg.adminAnnounce, { text }),
      onCallDiary: (playerId) => {
        send<AdminTargetMessage>(Msg.adminCallDiary, { playerId });
        setCamera({ kind: "house", area: "diary" });
      },
      onEndDiary: () => send(Msg.adminEndDiary),
      onSetTime: (minutes) => send(Msg.adminSetTime, { minutes }),
      onAllLights: (on) => send(Msg.adminLights, { on }),
      onDiaryBroadcast: (broadcast) => send<AdminDiaryBroadcastMessage>(Msg.adminDiaryBroadcast, { broadcast }),
      onDiaryChat: (text) => send<DiaryChatMessage>(Msg.diaryChat, { text }),
      onStartTask: (type, reward) => send<AdminStartTaskMessage>(Msg.adminStartTask, { type, reward }),
      onEndTask: () => send(Msg.adminEndTask),
      onStartNominations: () => send(Msg.adminStartNominations),
      onCancelNominations: () => send(Msg.adminCancelNominations),
      onCloseNominations: () => send(Msg.adminCloseNominations),
      onBbNominate: (playerId) => send<AdminTargetMessage>(Msg.adminBbNominate, { playerId }),
      onOpenVoting: (seconds) => send<AdminOpenVotingMessage>(Msg.adminOpenVoting, { seconds }),
      onCloseVoting: () => send(Msg.adminCloseVoting),
      onReveal: (token) => send<AdminRevealMessage>(Msg.adminReveal, token ? { token } : {}),
      onStartFinale: () => send(Msg.adminStartFinale),
      onMute: (playerId, muted) => send<AdminMuteMessage>(Msg.adminMute, { playerId, muted }),
      onKick: (playerId, name) => {
        if (confirm(`Remove ${name} from the house?`)) send<AdminTargetMessage>(Msg.adminKick, { playerId });
      },
      onFollow: (playerId) => setCamera({ kind: "follow", playerId }),
      onTalk: setTalk,
    },
    mic.stream !== null,
    mic.stream ? undefined : mic.reason,
    adminApi(auth),
  );
  const refreshStats = () => {
    adminApi(auth)
      .stats(seasonId)
      .then((s) => panel.setStats(`${s.watchingNow} watching now · ${s.watchMinutes} min watched · ${s.votes} votes (${s.voteWeight} weight)`))
      .catch(() => {});
  };
  refreshStats();
  const statsTimer = setInterval(refreshStats, 15_000);
  room.onMessage(Msg.adminLog, (entries: EventLogEntry[]) => panel.addLog(entries));
  room.onMessage(Msg.roundAdmin, (view: RoundAdminView) => panel.setRound(view));
  room.send(Msg.roundSync);
  room.onMessage(Msg.diaryChat, (msg: ChatMessage) => panel.diaryChat.add(msg));

  // Keys: 1–6 / 0 cameras, hold T (Diary Room) or B (house) to talk.
  window.addEventListener("keydown", (e) => {
    if (e.repeat || isTyping(e)) return;
    if (e.code === "KeyT") return setTalk("diary", true);
    if (e.code === "KeyB") return setTalk("house", true);
    const choice = areaForKey(e.key);
    if (choice === "free") setCamera({ kind: "free" });
    else if (choice) setCamera({ kind: "house", area: choice });
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyT") setTalk("diary", false);
    if (e.code === "KeyB") setTalk("house", false);
  });
  // Never stay on air by accident (e.g. key released while the window was in the background).
  window.addEventListener("blur", () => {
    setTalk("diary", false);
    setTalk("house", false);
  });

  // --- what the house sees ---
  const banners = new Banners(container);
  const roundPanel = new RoundPanel(container, { canVote: false });
  const winner = new WinnerScreen(container);
  const taskPanel = new TaskPanel(container, {});
  const gems = new GemsView(scene);
  room.onMessage(Msg.announcement, ({ text, to }: AnnouncementMessage) => {
    if (to === "all") banners.announce(text);
  });
  const houseChat = new ChatPanel(container, () => {}, { className: "house-chat", label: "House chat", readOnly: true });
  room.onMessage(Msg.chat, (msg: ChatMessage) => {
    houseChat.add(msg);
    players.avatarOf(msg.fromId)?.showChat(msg.text);
  });
  room.onMessage(Msg.chatHistory, (h: ChatMessage[]) => h.forEach((m) => houseChat.add(m)));
  room.send(Msg.chatHistory);

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    clearInterval(routingTimer);
    clearInterval(statsTimer);
    voice?.leave();
    showDisconnected(
      container,
      code === CloseCode.consoleTakenOver
        ? "The console was opened in another window."
        : `Lost connection to the house (code ${code}).`,
    );
  });

  if (import.meta.env.DEV) Object.assign(window, { __bbn: { room, scene, cam, voice, audioCtx, remotes: players.remotes } });

  // --- render loop ---
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    players.update(dt);
    props.update(dt);
    stationSigns.update(room.state);
    const target = following ? players.remotes.get(following)?.avatar.root : undefined;
    cam.update(dt, target ? { x: target.position.x, z: target.position.z, rotY: target.rotation.y } : undefined);
    const ears = cam.listener;
    voice?.setListenerPosition({ x: ears.x, y: ears.y, z: ears.z }, ears.yaw);
    route();

    panel.update(room.state);
    roundPanel.update(room.state);
    winner.update(room.state);
    taskPanel.update(room.state);
    gems.update(dt, room.state.task);
    banners.setStatus("talking", talking === "house" ? "📣 You're on air to the whole house" : talking === "diary" ? "🎙️ Talking to the Diary Room" : null, "live");
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
