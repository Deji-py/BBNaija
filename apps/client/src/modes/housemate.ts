import * as THREE from "three";
import {
  COOK_STAGE,
  CloseCode,
  GEM_PICKUP_RANGE,
  Msg,
  WALK_SPEED,
  activityExit,
  areaAt,
  collidersFor,
  PROPS,
  PROP_BY_ID,
  PROP_PICKUP_RANGE,
  distanceToProp,
  propColliders,
  type PropRefusedMessage,
  distanceToObject,
  openDoorSet,
  DIARY_DOOR_ID,
  insideDiaryRoom,
  nearestInteractable,
  nearestStation,
  GAMES,
  MOVIE_CHANNEL,
  MOVIE_MAX_LABEL,
  TV_CHANNELS,
  TV_STATIONS,
  type TvChannelMessage,
  type TvStationMessage,
  type ActionMessage,
  type AnnouncementMessage,
  type ChatMessage,
  type ChatSendMessage,
  type DiaryChatMessage,
  type EmoteMessage,
  type GameErrorMessage,
  type GameTableView,
  type HouseStateView,
  type Interactable,
  type NominateMessage,
  type NominationStatusMessage,
  type PlayerView,
  type QuizAnswerMessage,
  type VoiceStateMessage,
  type PartyEffectMessage,
} from "@bbn/shared";
import { setupScene } from "../scene/setupScene.js";
import { buildHouse } from "../scene/house.js";
import { PartyRoom } from "../scene/partyRoom.js";
import { DayNight, clockText } from "../scene/dayNight.js";
import { FollowCamera } from "../scene/followCamera.js";
import type { Avatar } from "../entities/avatar.js";
import { Keyboard, isTyping } from "../input/keyboard.js";
import { TouchControls } from "../input/touchControls.js";
import { Hud } from "../ui/hud.js";
import { ChatPanel } from "../ui/chat.js";
import { showDisconnected } from "../ui/lobby.js";
import type { HouseRoom } from "../net/connection.js";
import { moviePlaybackUrl, uploadMovie } from "../net/movies.js";
import { LocalPlayerController } from "../net/localPlayer.js";
import { lerpAngle } from "../net/interpolation.js";
import { getStateCallbacks } from "../net/stateCallbacks.js";
import { HEAD_HEIGHT, PlayersView, moodIcon, voiceIconFor } from "./playersView.js";
import { connectVoice } from "../voice/connectVoice.js";
import { SpatialAudio } from "../voice/spatialAudio.js";
import type { RoutedVoice } from "../voice/VoiceProvider.js";
import { SpeakingDetector, type MicResult } from "../voice/mic.js";
import { VoiceControls } from "../ui/voiceControls.js";
import { applyVoiceRouting } from "../voice/voiceRouting.js";
import { Banners } from "../ui/banner.js";
import { NominationCard, RoundPanel, WinnerScreen } from "../ui/roundPanel.js";
import { TvPanel } from "../ui/tvPanel.js";
import { TaskPanel } from "../ui/taskPanel.js";
import { GemsView } from "../scene/gems.js";
import { PropsView } from "../scene/props.js";
import { StationSigns } from "../scene/gameHall.js";
import { GamePanel } from "../games/panel.js";
import { NeedsPanel } from "../ui/needsPanel.js";
import { EmoteWheel } from "../ui/emoteWheel.js";

const TURN_SPEED = 2.2; // rad/s for Z/C camera turning
const FACE_TURN_RATE = 14; // how fast the avatar rotates to face its movement direction
/** Longest frame we simulate in one step. Prevents huge jumps (and wall tunnelling) after a tab stall. */
const MAX_DT = 0.05;
interface LocalPlayer {
  avatar: Avatar;
  controller: LocalPlayerController;
  state: PlayerView;
}

/** What pressing E says while you're using something. */
function stopPrompt(activity: string): string {
  if (activity === "pool") return "Get out of the pool";
  if (activity === "drinks") return "Put the drink down";
  if (activity === "bathtub") return "Get out of the bath";
  if (activity.startsWith("shower-")) return "Step out of the shower";
  if (activity.startsWith("toilet-")) return "Flush and get up";
  if (activity.startsWith("sink-") || activity.startsWith("washer-")) return "Stop";
  if (activity.startsWith("chair-")) return "Finish eating";
  return "Get up";
}

/**
 * Housemate mode: you control one avatar; everyone else in the room is drawn
 * from server state.
 *
 * The game loop: every animation frame we (1) read input, (2) update the
 * simulation by the elapsed time `dt`, and (3) render. Scaling movement by
 * `dt` keeps speed the same whether the screen runs at 30, 60 or 144 Hz.
 */
export function startHousemateMode(
  container: HTMLElement,
  room: HouseRoom,
  audioCtx: AudioContext,
  mic: MicResult,
  seasonId: string,
): void {
  const { renderer, scene, camera, sun, hemi } = setupScene(container);
  const house = buildHouse();
  scene.add(house.root);
  const dayNight = new DayNight(scene, sun, hemi, house.root);
  const party = new PartyRoom(house.root, scene);
  room.onMessage(Msg.partyEffect, ({ kind }: PartyEffectMessage) => party.play(kind));

  const followCam = new FollowCamera(camera, house.cameraBlockers, renderer.domElement);
  followCam.yaw = 0;
  const keyboard = new Keyboard();
  const hud = new Hud(container);
  const touch = new TouchControls(container, { onJump: () => jump() });
  if (touch.enabled) {
    container.classList.add("touch-ui");
    hud.setTouchHelp();
  }

  let local: LocalPlayer | null = null;

  // --- voice ---
  // Offer to other housemates with a larger session id; viewers always offer to us.
  // The server picks mesh or LiveKit after we ask (see connectVoice).
  let voice: RoutedVoice | null = null;
  let wantMuted = true;
  const voiceControls = new VoiceControls(container, mic.stream !== null, mic.stream ? undefined : mic.reason);
  const speaking = mic.stream ? new SpeakingDetector(audioCtx, mic.stream) : null;
  voiceControls.onTransmitChange((transmitting) => {
    wantMuted = !transmitting;
    voice?.setMuted(wantMuted);
  });

  // Speaking detection runs on a timer rather than the render loop, so the
  // indicator stays right while this tab is in the background.
  let sentVoiceState: VoiceStateMessage | null = null;
  const voiceStateTimer = setInterval(() => {
    const transmitting = voiceControls.isTransmitting();
    const state: VoiceStateMessage = {
      speaking: transmitting && (speaking?.isSpeaking() ?? false),
      muted: !mic.stream || voiceControls.muted || !!local?.state.adminMuted,
    };
    if (state.speaking !== sentVoiceState?.speaking || state.muted !== sentVoiceState.muted) {
      room.send(Msg.voiceState, state);
      sentVoiceState = state;
    }
    // Who hears whom (Diary Room privacy, Big Brother's mute). Also runs every frame;
    // the timer keeps it right while this tab is in the background.
    if (voice) applyVoiceRouting(voice, room.sessionId, room.state as HouseStateView);
  }, 100);

  // --- Big Brother: announcements, tasks, Diary Room ---
  const banners = new Banners(container);
  const taskPanel = new TaskPanel(container, {
    myId: room.sessionId,
    onAnswer: (answer) => {
      const message: QuizAnswerMessage = { answer };
      room.send(Msg.quizAnswer, message);
    },
  });
  const gems = new GemsView(scene);
  const roundPanel = new RoundPanel(container, { canVote: false });
  const winner = new WinnerScreen(container);
  const nomination = new NominationCard(container, (nomineeIds) => {
    const message: NominateMessage = { nomineeIds };
    room.send(Msg.nominate, message);
  });
  room.onMessage(Msg.nominationStatus, (msg: NominationStatusMessage) => nomination.setStatus(msg));
  room.onMessage(Msg.announcement, ({ text, to }: AnnouncementMessage) => {
    if (to === "all" || to === room.sessionId) banners.announce(text);
  });
  const diaryChat = new ChatPanel(
    container,
    (text) => {
      const message: DiaryChatMessage = { text };
      room.send(Msg.diaryChat, message);
    },
    { className: "diary-chat", label: "Diary Room", placeholder: "Talk to Big Brother (Enter)" },
  );
  diaryChat.setVisible(false);
  room.onMessage(Msg.diaryChat, (msg: ChatMessage) => diaryChat.add(msg));
  let wasInDiary = false;

  // --- chat ---
  const chat = new ChatPanel(
    container,
    (text) => {
      const message: ChatSendMessage = { text };
      room.send(Msg.chat, message);
    },
    { live: true },
  );
  room.onMessage(Msg.chat, (msg: ChatMessage) => {
    chat.add(msg);
    const avatar = msg.fromId === room.sessionId ? local?.avatar : players.avatarOf(msg.fromId);
    avatar?.showChat(msg.text);
  });
  room.onMessage(Msg.chatHistory, (history: ChatMessage[]) => history.forEach((m) => chat.add(m)));
  room.send(Msg.chatHistory); // ask only after the handler above is registered

  // --- react to server state ---
  const $ = getStateCallbacks(room);
  /** What blocks walking: walls, furniture, shut doors and solid props. Refreshed every frame from state. */
  const currentColliders = () => {
    const state = room.state as HouseStateView;
    return collidersFor(openDoorSet(state.openDoors ?? ""), propColliders(state.props?.entries() ?? []));
  };
  let doorColliders = currentColliders();
  const syncDoors = () => {
    doorColliders = currentColliders();
    house.doors.setOpen((room.state as HouseStateView).openDoors ?? "");
  };
  $.listen("openDoors", syncDoors);
  syncDoors();
  const players = new PlayersView(scene, room, $, null, (player, avatar) => {
    const controller = new LocalPlayerController(
      { x: player.x, z: player.z },
      (input) => room.send(Msg.input, input),
      () => doorColliders,
      // Swimming in the pool, running with Shift (not when exhausted), or walking.
      () =>
        player.activity === "pool"
          ? "swim"
          : (keyboard.isDown("ShiftLeft", "ShiftRight") || touch.running) && (player.needs?.energy ?? 100) >= 8
            ? "run"
            : "walk",
    );
    local = { avatar, controller, state: player };
    $.onChange(player, () => {
      // Swimmers keep swimming when they move; anything else gets you up first.
      const exit = player.activity && player.activity !== "pool" ? activityExit(player.activity, player.x, player.z) : null;
      controller.reconcile(player.x, player.z, player.lastSeq, exit);
    });
    followCam.update(0, avatar.root.position, true);
  });
  players.onCountChange((n) => hud.setPlayerCount(n));
  const props = new PropsView(scene, room as unknown as { state: HouseStateView }, (id) =>
    id === room.sessionId ? local?.avatar : players.avatarOf(id),
  );
  let propNoticeTimer = 0;
  room.onMessage(Msg.propRefused, ({ reason }: PropRefusedMessage) => {
    banners.setStatus("prop", reason, "warn");
    clearTimeout(propNoticeTimer);
    propNoticeTimer = window.setTimeout(() => banners.setStatus("prop", null), 2500);
  });
  // --- emote wheel (hold Q) ---
  const emoteWheel = new EmoteWheel(
    container,
    (name) => {
      const message: EmoteMessage = { name };
      room.send(Msg.emote, message);
    },
    () => !!local && !gamePanel.isOpen && document.activeElement?.tagName !== "INPUT",
  );

  // --- needs: how your housemate is feeling ---
  const needsPanel = new NeedsPanel(container);

  // --- games hall ---
  const stationSigns = new StationSigns(scene);
  const gamePanel = new GamePanel(container, { send: (type, message) => room.send(type, message), canPlay: true });
  room.onMessage(Msg.gameTable, (table: GameTableView) => gamePanel.onTable(table));
  room.onMessage(Msg.gameError, (msg: GameErrorMessage) => gamePanel.onError(msg));

  void connectVoice(room, new SpatialAudio(audioCtx), (id) => room.state.players.has(id) && room.sessionId < id, mic.stream).then(
    ({ voice: v }) => {
      voice = v;
      v?.setMuted(wantMuted);
      if (v) players.setVoice(v);
    },
  );

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
  let uploadedToken = "";
  const channelPanel = new TvPanel(
    container,
    "TV channels",
    [...TV_CHANNELS, { id: MOVIE_CHANNEL, label: "Your movie" }],
    (channel) => {
      const token = uploadedToken || (room.state as HouseStateView).tvMovie;
      if (channel === MOVIE_CHANNEL && !token) {
        channelPanel.setStatus("Upload a movie first.");
        return;
      }
      channelPanel.setStatus(null);
      const message: TvChannelMessage = channel === MOVIE_CHANNEL ? { channel, token } : { channel };
      room.send(Msg.tvChannel, message);
    },
    "Everyone in the house sees the same channel. An uploaded movie plays for the whole house.",
    undefined,
    {
      label: `Upload a movie (max ${MOVIE_MAX_LABEL})`,
      accept: "video/mp4,video/webm,.mp4,.webm",
      onFile: (file) => {
        channelPanel.setStatus("Uploading…", true);
        void uploadMovie(seasonId, file)
          .then((token) => {
            uploadedToken = token;
            const message: TvChannelMessage = { channel: MOVIE_CHANNEL, token };
            room.send(Msg.tvChannel, message);
            channelPanel.setStatus(null);
          })
          .catch((err: unknown) => {
            channelPanel.setStatus(err instanceof Error ? err.message : "Couldn't upload that movie.");
          });
      },
    },
  );
  const musicPanel = new TvPanel(
    container,
    "Sound bar",
    TV_STATIONS,
    (station) => {
      const message: TvStationMessage = { station };
      room.send(Msg.tvStation, message);
    },
    "Stations play from the sound bar for the whole house. A file from your device plays only here.",
    {
      label: "Play a file from this device",
      onFile: (file) => house.tv.playFile(file),
      onStopFile: () => house.tv.stopFile(),
    },
    undefined,
    {
      onToggle: () => {
        const message: ActionMessage = { objectId: "home-theater" };
        room.send(Msg.action, message);
      },
    },
    "sound-bar",
  );

  // DJ booth controls while the party's on.
  const djPanel = new TvPanel(
    container,
    "DJ booth",
    [
      { id: "confetti", label: "🎊 Confetti cannon" },
      { id: "fireworks", label: "🎆 Fireworks over the garden" },
    ],
    (kind) => {
      const message: PartyEffectMessage = { kind: kind as PartyEffectMessage["kind"] };
      room.send(Msg.partyEffect, message);
    },
    "Everyone in the house sees these. Press E at the booth to stop the party.",
    undefined,
    undefined,
    undefined,
    "dj-panel",
  );

  room.onLeave((code) => {
    renderer.setAnimationLoop(null);
    clearInterval(voiceStateTimer);
    voice?.leave();
    const evicted = code === CloseCode.evicted;
    showDisconnected(
      container,
      evicted
        ? "You've been evicted. You can still watch the rest of the season."
        : code === CloseCode.kicked
          ? "Big Brother has removed you from the house."
          : code === CloseCode.joinedElsewhere
            ? "You entered the house from another window, so this one was closed."
            : code === 1000
              ? "You left the house."
              : `Lost connection to the house (code ${code}).`,
      evicted
        ? { title: "Evicted", action: { label: "Watch the house", href: location.pathname.replace(/^\/house\//, "/watch/") } }
        : undefined,
    );
  });

  // --- interaction & emote keys ---
  /** What pressing E would do right now (null = nothing in reach). */
  let eTarget: string | null = null;

  /** E, or tapping the prompt: use whatever's in reach. */
  const use = () => {
    if (!local || gamePanel.isOpen || !eTarget) return;
    if (eTarget.startsWith("station:")) gamePanel.open(eTarget.slice(8));
    else if (eTarget === "diary:request") room.send(Msg.diaryRequest);
    else if (eTarget === "diary:leave") room.send(Msg.diaryLeave);
    else {
      const message: ActionMessage = { objectId: eTarget };
      room.send(Msg.action, message);
    }
  };
  const jump = () => {
    if (!local || gamePanel.isOpen) return;
    room.send(Msg.jump);
    local.avatar.hop();
  };
  hud.onPromptTap(use);

  window.addEventListener("keydown", (e) => {
    if (e.repeat || isTyping(e) || !local || gamePanel.isOpen) return;
    if (e.code === "KeyE") {
      use();
    } else if (e.code === "Space") {
      e.preventDefault();
      jump();
    } else if (e.code === "Digit1" || e.code === "Digit2") {
      const message: EmoteMessage = { name: e.code === "Digit1" ? "wave" : "dance" };
      room.send(Msg.emote, message);
    }
  });

  /** Works out the "Press E" prompt from where we are, the current task and who's using what. */
  function updatePrompt(me: PlayerView, x: number, z: number, inDiary: boolean): void {
    eTarget = null;
    if (inDiary) {
      if (!(room.state as HouseStateView).diaryConfession) return hud.setPrompt(null);
      eTarget = "diary:leave";
      return hud.setPrompt("Leave the Diary Room");
    }
    if (me.carrying) {
      eTarget = "prop:drop";
      return hud.setPrompt(`Put down the ${PROP_BY_ID.get(me.carrying)?.label ?? "item"}`);
    }
    if (me.activity) {
      eTarget = me.activity;
      hud.setPrompt(stopPrompt(me.activity));
      return;
    }
    const task = room.state.task?.status === "running" ? room.state.task : undefined;

    // Treasure hunt: a gem in reach beats any furniture.
    if (task?.type === "treasure") {
      const gem = [...task.gems].find((g) => !g.found && Math.hypot(g.x - x, g.z - z) <= GEM_PICKUP_RANGE);
      if (gem) {
        eTarget = `gem:${gem.id}`;
        return hud.setPrompt("Pick up the hidden gem 💎");
      }
    }

    // Fridge and counter only matter during the cooking challenge, at the right step.
    const usable = (it: Interactable) =>
      it.kind !== "task" ||
      (task?.type === "cooking" &&
        ((it.id === "fridge" && me.cookStage === COOK_STAGE.start) ||
          (it.id === "counter" && me.cookStage === COOK_STAGE.hasIngredients)));
    const it = nearestInteractable(x, z, usable);

    // A carryable prop in reach, if it's nearer than the nearest usable object.
    const state = room.state as HouseStateView;
    let nearestProp: { id: string; label: string; dist: number } | null = null;
    for (const spec of PROPS) {
      const pose = state.props?.get(spec.id);
      if (!pose || pose.heldBy) continue;
      const dist = distanceToProp(spec, pose, x, z);
      if (dist <= PROP_PICKUP_RANGE && (!nearestProp || dist < nearestProp.dist)) nearestProp = { id: spec.id, label: spec.label, dist };
    }
    if (nearestProp && (!it || nearestProp.dist < distanceToObject(it.id, x, z))) {
      eTarget = `prop:${nearestProp.id}`;
      return hud.setPrompt(`Pick up the ${nearestProp.label}`);
    }
    // A game station in reach (the games hall has nothing else to use).
    const station = nearestStation(x, z);
    if (station && (!it || station.dist < distanceToObject(it.id, x, z))) {
      const def = GAMES[station.station.game];
      const busy = state.stations?.get(station.station.id);
      eTarget = `station:${station.station.id}`;
      const mine = gamePanel.seatedStation === station.station.id;
      return hud.setPrompt(mine ? `Back to your ${def.name} game ${def.icon}` : busy === "playing" ? `Watch ${def.name} ${def.icon}` : `Play ${def.name} ${def.icon}`);
    }
    if (!it) return hud.setPrompt(null);
    if (it.kind === "toggle") {
      eTarget = it.id;
      const st = room.state as HouseStateView;
      const on = it.id === "home-theater" ? st.theaterOn : it.id === "dj-booth" ? st.partyOn : st.tvOn;
      return hud.setPrompt(on ? it.promptOff : it.prompt);
    }
    if (it.kind === "door") {
      const open = openDoorSet((room.state as HouseStateView).openDoors ?? "").has(it.id);
      if (!open && it.id === DIARY_DOOR_ID && !insideDiaryRoom(x, z)) return diaryDoorPrompt();
      eTarget = it.id;
      return hud.setPrompt(open ? it.promptOff : it.prompt);
    }
    if (it.id === "diary-chair") return hud.setPrompt("Only when Big Brother calls you", false);
    if (it.kind === "task") {
      eTarget = it.id;
      return hud.setPrompt(it.prompt);
    }
    if (it.kind === "light") {
      eTarget = it.id;
      const off = ((room.state as HouseStateView).lightsOff ?? "").split(" ").includes(it.id.slice("light-".length));
      return hud.setPrompt(off ? it.prompt : it.promptOff);
    }
    const users = [...room.state.players.values()].filter((p) => p.activity === it.id).length;
    const capacity = it.kind === "slots" ? it.slots.length : it.capacity;
    if (users >= capacity) return hud.setPrompt(it.kind === "pool" ? "The pool is full" : "Someone's using that", false);
    eTarget = it.id;
    hud.setPrompt(it.prompt);
  }

  /** Outside the shut Diary Room door: security takes your request (or lets you in to confess when Big Brother's away). */
  function diaryDoorPrompt(): void {
    const state = room.state as HouseStateView;
    if (state.diaryHousemate) return hud.setPrompt("🛡️ Someone's in the Diary Room", false);
    if (state.bigBrotherId) {
      eTarget = "diary:request";
      return hud.setPrompt("🛡️ Ask security to tell Big Brother you want to talk");
    }
    if (state.round?.phase === "nominations") return hud.setPrompt("🛡️ Diary Room: wait for Big Brother to call you", false);
    eTarget = "diary:request";
    hud.setPrompt("🛡️ Confess in the Diary Room (viewers watch, the house doesn't)");
  }

  /** Diary Room session, Big Brother's mute and voice: banners, chat and mic follow the server's state. */
  function updateBigBrotherState(me: PlayerView, inDiary: boolean): void {
    const state = room.state as HouseStateView;
    if (inDiary !== wasInDiary) {
      wasInDiary = inDiary;
      diaryChat.setVisible(inDiary);
      if (inDiary) diaryChat.clear();
    }
    banners.setStatus(
      "diary",
      !inDiary
        ? null
        : state.diaryConfession
          ? "🎙️ Confession: viewers can see and hear you. The house can't."
          : state.diaryBroadcast
            ? "🎙️ You're in the Diary Room. Big Brother and the viewers can hear you. The house can't."
            : "🎙️ You're in the Diary Room. Only Big Brother can hear you. The house can't.",
      "live",
    );
    banners.setStatus("muted", me.adminMuted ? "🔇 Big Brother has muted you." : null, "warn");
    banners.setStatus("bb", state.bigBrotherSpeaking ? "🔊 Big Brother is speaking" : null, "live");
    voiceControls.setForcedMute(me.adminMuted ? "Muted by Big Brother" : null);
    chat.setEnabled(
      !me.adminMuted && !inDiary,
      me.adminMuted ? "Big Brother has muted you" : "House chat is paused while you're in the Diary Room",
    );
    diaryChat.setEnabled(inDiary);
  }

  // Dev-only handle for poking at the scene from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __bbn: { room, scene, remotes: players.remotes, voice, audioCtx, followCam, getLocal: () => local, dayNight, house, party } });

  // --- game loop ---
  const clock = new THREE.Clock();
  const move = new THREE.Vector2();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), MAX_DT);

    if (local) {
      // While a game is open, the keyboard belongs to the game.
      const playing = gamePanel.isOpen;
      if (!playing && keyboard.isDown("KeyZ")) followCam.rotate(TURN_SPEED * dt);
      if (!playing && keyboard.isDown("KeyC")) followCam.rotate(-TURN_SPEED * dt);

      const me = local.state;
      const inDiary = (room.state as HouseStateView).diaryHousemate === room.sessionId;
      const pos = local.avatar.root.position;
      // Eviction is a scripted walk the server drives. Follow that position instead of predicting keys.
      if (me.exiting) {
        const dist = Math.hypot(me.x - pos.x, me.z - pos.z);
        if (dist > 2.5) {
          pos.x = me.x;
          pos.z = me.z;
        } else {
          const k = 1 - Math.exp(-14 * dt);
          pos.x += (me.x - pos.x) * k;
          pos.z += (me.z - pos.z) * k;
        }
        local.avatar.root.rotation.y = me.rotY;
        local.avatar.update(dt, WALK_SPEED, "walk");
      } else {
      // In the Diary Room you stay in the chair until Big Brother lets you go.
      const keys = keyboard.moveAxes();
      const axes = keys.forward || keys.right ? keys : touch.moveAxes();
      const { forward, right } = inDiary || playing || emoteWheel.isOpen ? { forward: 0, right: 0 } : axes;
      const yaw = followCam.yaw;
      // "Forward" points from the camera toward the player, flattened onto the ground.
      move.set(-Math.sin(yaw) * forward + Math.cos(yaw) * right, -Math.cos(yaw) * forward - Math.sin(yaw) * right);
      if (move.lengthSq() > 1) move.normalize(); // diagonal shouldn't be faster
      const moving = move.lengthSq() > 0;

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
      // In the pool you're always swimming, moving or not.
      const serverAnim = me.anim === "walk" || me.anim === "idle" ? null : me.anim;
      local.avatar.update(dt, speed, me.activity === "pool" ? "swim" : moving || !serverAnim ? undefined : serverAnim);
      }

      // Our ears follow the avatar, facing where the camera looks.
      voice?.setListenerPosition({ x: pos.x, y: HEAD_HEIGHT, z: pos.z }, followCam.yaw);
      if (sentVoiceState) local.avatar.setVoiceState(voiceIconFor({ ...sentVoiceState, adminMuted: me.adminMuted }));
      local.avatar.setPerks(me.perks ? [...me.perks] : []);
      local.avatar.setCarrying(!!me.carrying);
      needsPanel.update(me.needs);
      local.avatar.setMood(moodIcon(me.needs));

      followCam.update(dt, pos);
      hud.setArea(areaAt(pos.x, pos.z)?.label ?? "Outside");
      updatePrompt(me, pos.x, pos.z, inDiary || me.exiting);
      // Called to the Diary Room or leaving the house: the game window closes.
      if ((inDiary || me.exiting) && gamePanel.isOpen) gamePanel.close();
      const state = room.state as HouseStateView;
      channelPanel.setOpen(state.tvOn && distanceToObject("tv", pos.x, pos.z) <= 1.8, state.tvChannel);
      const atSoundBar = distanceToObject("home-theater", pos.x, pos.z) <= 1.8;
      musicPanel.setOpen(atSoundBar, state.tvStation, house.tv.localFile);
      musicPanel.setPower(state.theaterOn);
      djPanel.setOpen(!!state.partyOn && distanceToObject("dj-booth", pos.x, pos.z) <= 2.2, "");
      updateBigBrotherState(me, inDiary);
      nomination.setVisible(inDiary && (room.state as HouseStateView).round?.phase === "nominations");
    }

    doorColliders = currentColliders();
    players.update(dt);
    props.update(dt);
    stationSigns.update(room.state as HouseStateView);
    if (voice) applyVoiceRouting(voice, room.sessionId, room.state as HouseStateView);
    roundPanel.update(room.state as HouseStateView);
    winner.update(room.state as HouseStateView);
    taskPanel.update(room.state as HouseStateView);
    gems.update(dt, (room.state as HouseStateView).task);

    house.tv.animate(dt);
    house.doors.animate(dt);
    house.guards.animate(dt);
    dayNight.update((room.state as HouseStateView).dayMinutes ?? 600);
    hud.setClock(`${dayNight.night > 0.55 ? "🌙" : "☀️"} ${clockText((room.state as HouseStateView).dayMinutes ?? 600)}`);
    house.lights.set((room.state as HouseStateView).lightsOff ?? "");
    party.update(dt, !!(room.state as HouseStateView).partyOn);
    house.setShowers(new Set([...(room.state.players?.values() ?? [])].map((p) => p.activity).filter((a) => a.startsWith("shower-"))));
    hud.tick(dt);
    renderer.render(scene, camera);
  });
}
