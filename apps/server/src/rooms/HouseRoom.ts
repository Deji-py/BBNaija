import { Room, type Client } from "colyseus";
import {
  CloseCode,
  EMOTES,
  INTERACTABLE_BY_ID,
  MAX_AUDIO_VIEWERS,
  MAX_HOUSEMATES,
  MAX_VIEWERS,
  Msg,
  REACTIONS,
  REWARD_IDS,
  SPAWN_POINT,
  TASKS,
  TICK_RATE_HZ,
  activityExit,
  applyInputStep,
  areaAt,
  chooseSlot,
  distanceToObject,
  type AnimState,
  type AnnouncementMessage,
  type ChatMessage,
  type EmoteName,
  type InputMessage,
  type JoinOptions,
  type Reaction,
  type ReactionMessage,
  type RewardId,
  type SlotInteractable,
  type TaskType,
  type ViewerWelcome,
  type VoicePeerLeft,
  type VoiceSignalRelay,
} from "@bbn/shared";
import { isAdminSecret, isProduction } from "../config.js";
import { userFromSession } from "../accounts/auth.js";
import { housemateAccess } from "../accounts/seasons.js";
import { HouseState, Player } from "../schema/HouseState.js";
import { ChatLog } from "../systems/chat.js";
import { eventLog } from "../systems/eventLog.js";
import { RateLimiter } from "../systems/rateLimit.js";
import { TaskRunner } from "../systems/tasks.js";
import { field, parseInput, parseVoiceSignal, parseVoiceState, sanitizeColor, sanitizeName } from "./parse.js";

/** Inputs a client may have waiting before we start dropping them. */
const MAX_QUEUED_INPUTS = 10;
/**
 * Movement budget: each tick grants one input step, and unused steps bank up
 * to this many. Makes it impossible to move faster than walking speed on
 * average, however fast a (modified) client sends inputs.
 */
const MAX_INPUT_CREDIT = 4;
/**
 * Jitter buffer: inputs arrive unevenly (network timing, client frame timing),
 * but we want each player to move exactly one step per tick. So we normally
 * apply one queued input per tick, and only apply a second when more than this
 * many are waiting (catch-up after a delay). A late packet is then absorbed by
 * the input already waiting, instead of causing a pause followed by a double step.
 */
const JITTER_BUFFER_TARGET = 2;
/** Ticks a player keeps the "walk" animation after their last step, so it doesn't flicker. */
const WALK_GRACE_TICKS = 2;
/** How long a wave lasts. Dancing continues until you move or emote again. */
const WAVE_TICKS = Math.round(2.5 * TICK_RATE_HZ);

/** How Big Brother appears in house chat and the Diary Room. */
const BIG_BROTHER = { id: "bigbrother", name: "Big Brother", color: "#e0243b" } as const;

/** What onAuth decided about a joining client (available as `client.auth` in onJoin). */
interface JoinAuth {
  role: "housemate" | "viewer" | "admin";
  /** Signed-in account, if any. */
  userId?: string;
  /** Name from the account / application. */
  name?: string;
}

interface Viewer {
  name: string;
  color: string;
  /** Holds one of the MAX_AUDIO_VIEWERS listen-only voice slots. */
  audio: boolean;
}

interface PlayerSim {
  queue: InputMessage[];
  credit: number;
  ticksSinceStep: number;
  emote: EmoteName | null;
  emoteTicksLeft: number;
}

/**
 * One live house. The server is authoritative: clients only send *inputs*
 * ("I want to move this way"), the server applies them with the shared
 * collision code and broadcasts the resulting positions.
 *
 * Three kinds of client share the room: housemates (in `state.players`),
 * viewers (watching via /watch) and the Big Brother console (/bigbrother).
 */
export class HouseRoom extends Room<{ state: HouseState }> {
  // Housemates, viewers and the console share the room; onJoin enforces each limit separately.
  override maxClients = MAX_HOUSEMATES + MAX_VIEWERS + 1;
  override state = new HouseState();
  override patchRate = 1000 / TICK_RATE_HZ;
  override maxMessagesPerSecond = 60;

  private readonly sims = new Map<string, PlayerSim>();
  private readonly chat = new ChatLog();
  /** Spectators, by session id. Not part of the synced state: housemates never see who's watching. */
  private readonly viewers = new Map<string, Viewer>();
  private readonly viewerChat = new ChatLog();
  private readonly reactionLimiter = new RateLimiter(5, 300);
  private readonly events = eventLog;
  private unsubscribeLog: () => void = () => {};
  private tasks!: TaskRunner;
  private diaryChatId = 1;

  /** Session ids by account, so one account can't be in the house twice. */
  private readonly sessionByUser = new Map<string, string>();

  /**
   * Who may join as what:
   * - console: the admin secret;
   * - housemate: a signed-in user selected for the live season (in development,
   *   the admin secret also admits test housemates such as `pnpm bots`);
   * - viewer: anyone (signing in just sets your viewer-chat name).
   */
  override async onAuth(_client: Client, options: Partial<JoinOptions> = {}): Promise<JoinAuth> {
    if (options.role === "admin") {
      if (!isAdminSecret(options.adminSecret)) throw new Error("Wrong admin secret");
      return { role: "admin" };
    }
    const user = await userFromSession(options.sessionToken);
    if (options.role === "viewer") return { role: "viewer", userId: user?.id, name: user?.displayName ?? undefined };

    if (!isProduction && isAdminSecret(options.adminSecret)) return { role: "housemate" }; // dev test housemate
    if (!user) throw new Error("Please sign in to enter the house");
    const access = await housemateAccess(user.id);
    if (!access) throw new Error("Only selected housemates of the live season can enter the house");
    return { role: "housemate", userId: user.id, name: access.displayName };
  }

  override onCreate(): void {
    this.state.tvOn = false;
    this.state.viewerCount = 0;
    this.state.bigBrotherId = "";
    this.state.bigBrotherSpeaking = false;
    this.state.diaryHousemate = "";
    this.state.diaryBroadcast = true;
    this.state.serverTime = Date.now();

    this.tasks = new TaskRunner(this.state, this.clock, {
      log: (type, text) => this.events.add(type, text),
      announce: (text) => this.announce(text),
      standUp: (player) => {
        const sim = this.sims.get(player.id);
        if (sim && player.activity) this.standUp(player, sim);
      },
    });

    this.registerHousemateMessages();
    this.registerVoiceMessages();
    this.registerViewerMessages();
    this.registerAdminMessages();

    this.unsubscribeLog = eventLog.subscribe((entry) => this.sendToAdmin(Msg.adminLog, [entry]));

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE_HZ);
    // Clients line their countdowns up with this.
    this.clock.setInterval(() => (this.state.serverTime = Date.now()), 1000);
    this.events.add("room", "House opened");
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}, auth?: JoinAuth): void {
    if (auth?.role === "admin") return this.joinAdmin(client);
    if (auth?.role === "viewer") return this.joinViewer(client, { ...options, name: auth.name ?? options.name });

    // Same account entering again (e.g. a second tab): the newest window wins.
    const previous = auth?.userId ? this.sessionByUser.get(auth.userId) : undefined;
    if (previous) this.clients.getById(previous)?.leave(CloseCode.joinedElsewhere);
    else if (this.state.players.size >= MAX_HOUSEMATES) throw new Error("The house is full");
    if (auth?.userId) this.sessionByUser.set(auth.userId, client.sessionId);

    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(auth?.name ?? options.name);
    player.color = sanitizeColor(options.color);

    const spawn = this.freeSpawnPoint();
    player.x = spawn.x;
    player.z = spawn.z;
    player.rotY = Math.PI;
    player.anim = "idle";
    player.area = areaAt(player.x, player.z)?.id ?? "";
    player.lastSeq = 0;
    player.voice = options.voice === true;
    player.speaking = false;
    player.muted = true;
    player.activity = "";
    player.adminMuted = false;
    player.cookStage = 0;

    this.state.players.set(client.sessionId, player);
    this.sims.set(client.sessionId, {
      queue: [],
      credit: MAX_INPUT_CREDIT,
      ticksSinceStep: WALK_GRACE_TICKS,
      emote: null,
      emoteTicksLeft: 0,
    });
    this.tasks.running?.scores.set(client.sessionId, 0);
    this.events.add("join", `${player.name} entered the house (${this.state.players.size}/${MAX_HOUSEMATES})`);
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;

    if (id === this.state.bigBrotherId) {
      this.state.bigBrotherId = "";
      this.state.bigBrotherSpeaking = false;
      if (this.state.diaryHousemate) this.endDiary("the console closed");
      this.events.add("admin", "Big Brother console disconnected");
      return;
    }

    const viewer = this.viewers.get(id);
    if (viewer) {
      this.viewers.delete(id);
      this.viewerChat.forget(id);
      this.reactionLimiter.forget(id);
      this.state.viewerCount = this.viewers.size;
      if (viewer.audio) {
        const left: VoicePeerLeft = { id };
        this.sendToHousemates(Msg.voicePeerLeft, left);
        this.sendToAdmin(Msg.voicePeerLeft, left);
      }
      return;
    }

    const player = this.state.players.get(id);
    for (const [userId, sessionId] of this.sessionByUser) if (sessionId === id) this.sessionByUser.delete(userId);
    if (id === this.state.diaryHousemate) this.state.diaryHousemate = "";
    this.state.players.delete(id);
    this.sims.delete(id);
    this.chat.forget(id);
    this.tasks.onPlayerLeft(id);
    this.events.add("leave", `${player?.name ?? id} left the house`);
  }

  override onDispose(): void {
    this.unsubscribeLog();
    console.log(`[house ${this.roomId}] disposed`);
  }

  // ---------------------------------------------------------------- housemates

  private registerHousemateMessages(): void {
    this.onMessage(Msg.input, (client, message: unknown) => {
      const input = parseInput(message);
      const sim = this.sims.get(client.sessionId);
      if (!input || !sim) return;
      if (sim.queue.length >= MAX_QUEUED_INPUTS) return;
      sim.queue.push(input);
    });

    this.onMessage(Msg.action, (client, message: unknown) => {
      const objectId = field(message, "objectId");
      if (typeof objectId === "string") this.handleAction(client.sessionId, objectId);
    });

    this.onMessage(Msg.emote, (client, message: unknown) => {
      const name = field(message, "name");
      const player = this.state.players.get(client.sessionId);
      const sim = this.sims.get(client.sessionId);
      if (!player || !sim || !EMOTES.includes(name as EmoteName) || player.activity) return;
      if (this.isInDiary(player.id)) return;
      if (name === "dance" && sim.emote === "dance") {
        sim.emote = null; // pressing dance again stops dancing
      } else {
        sim.emote = name as EmoteName;
        sim.emoteTicksLeft = name === "wave" ? WAVE_TICKS : Infinity;
      }
      this.updateAnim(player, sim);
    });

    this.onMessage(Msg.chat, (client, message: unknown) => {
      const player = this.state.players.get(client.sessionId);
      const text = ChatLog.sanitize(field(message, "text"));
      if (!player || !text || player.adminMuted || this.isInDiary(player.id)) return;
      if (!this.chat.allow(client.sessionId)) return;
      this.broadcast(Msg.chat, this.chat.add(player, text));
    });

    this.onMessage(Msg.chatHistory, (client) => {
      client.send(Msg.chatHistory, this.chat.recent());
    });

    this.onMessage(Msg.quizAnswer, (client, message: unknown) => {
      const answer = field(message, "answer");
      if (typeof answer === "number") this.tasks.onQuizAnswer(client.sessionId, answer);
    });

    // Diary Room text: between Big Brother and the housemate in session (viewers too when broadcast).
    this.onMessage(Msg.diaryChat, (client, message: unknown) => {
      const isAdmin = client.sessionId === this.state.bigBrotherId;
      const player = this.state.players.get(client.sessionId);
      if (!this.state.diaryHousemate || (!isAdmin && client.sessionId !== this.state.diaryHousemate)) return;
      const text = ChatLog.sanitize(field(message, "text"));
      if (!text || !this.chat.allow(`diary:${client.sessionId}`)) return;
      const from = isAdmin ? BIG_BROTHER : player!;
      const msg: ChatMessage = { id: this.diaryChatId++, fromId: from.id, name: from.name, color: from.color, text, at: Date.now() };
      this.clients.getById(this.state.diaryHousemate)?.send(Msg.diaryChat, msg);
      this.sendToAdmin(Msg.diaryChat, msg);
      if (this.state.diaryBroadcast) this.sendToViewers(Msg.diaryChat, msg);
    });
  }

  /**
   * Press E near an object. The server re-checks everything the client's prompt
   * showed (distance, free spot) because clients can't be trusted.
   */
  private handleAction(playerId: string, objectId: string): void {
    const player = this.state.players.get(playerId);
    const sim = this.sims.get(playerId);
    if (!player || !sim || this.isInDiary(playerId)) return;

    if (objectId.startsWith("gem:")) {
      this.tasks.pickGem(player, objectId.slice(4));
      return;
    }

    const it = INTERACTABLE_BY_ID.get(objectId);
    if (!it) return;

    // E while using something = get up.
    if (player.activity) {
      if (player.activity === objectId) this.standUp(player, sim);
      return;
    }
    if (distanceToObject(objectId, player.x, player.z) > it.range) return;

    if (it.kind === "toggle") {
      this.state.tvOn = !this.state.tvOn;
      return;
    }
    if (it.kind === "task") {
      this.tasks.onTaskObject(player, objectId);
      return;
    }

    const occupied = [...this.state.players.values()].filter((p) => p.activity === objectId);
    const slot = chooseSlot(it, player, occupied);
    if (!slot) return; // full
    this.placeInSlot(player, sim, objectId, slot);
  }

  /** Put a player into an object's spot (seat, bed…), cancelling queued movement. */
  private placeInSlot(player: Player, sim: PlayerSim, objectId: string, slot: { x: number; z: number; rotY: number }): void {
    // Drop movement still queued from before, and tell the client we've handled it
    // so its prediction doesn't replay those steps.
    const last = sim.queue.at(-1);
    if (last) player.lastSeq = last.seq;
    sim.queue.length = 0;
    sim.emote = null;

    player.x = slot.x;
    player.z = slot.z;
    player.rotY = slot.rotY;
    player.activity = objectId;
    this.updateAnim(player, sim);
  }

  private standUp(player: Player, sim: PlayerSim): void {
    const exit = activityExit(player.activity, player.x, player.z);
    if (exit) {
      player.x = exit.x;
      player.z = exit.z;
    }
    player.activity = "";
    this.updateAnim(player, sim);
  }

  /** What a player's animation should be. Activity beats emote beats walk/idle. */
  private updateAnim(player: Player, sim: PlayerSim): void {
    let anim: AnimState;
    const it = player.activity ? INTERACTABLE_BY_ID.get(player.activity) : undefined;
    if (it && (it.kind === "slots" || it.kind === "pool")) anim = it.activity;
    else if (sim.emote) anim = sim.emote;
    else anim = sim.ticksSinceStep < WALK_GRACE_TICKS ? "walk" : "idle";
    if (player.anim !== anim) player.anim = anim;
  }

  /**
   * Spawn slots form a small circle around the spawn point, so new arrivals
   * don't stack on top of each other. Takes the first slot nobody is standing on.
   */
  private freeSpawnPoint(): { x: number; z: number } {
    const slots = Array.from({ length: MAX_HOUSEMATES }, (_, i) => {
      const angle = (i / MAX_HOUSEMATES) * Math.PI * 2;
      return { x: SPAWN_POINT.x + Math.sin(angle) * 1.2, z: SPAWN_POINT.z + Math.cos(angle) * 1.2 };
    });
    const players = [...this.state.players.values()];
    return slots.find((s) => players.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 0.8)) ?? slots[0]!;
  }

  private isInDiary(playerId: string): boolean {
    return playerId === this.state.diaryHousemate;
  }

  /** One server tick: apply queued inputs to each player within their movement budget. */
  private tick(): void {
    for (const [id, sim] of this.sims) {
      const player = this.state.players.get(id);
      if (!player) continue;

      sim.credit = Math.min(sim.credit + 1, MAX_INPUT_CREDIT);

      if (this.isInDiary(id)) {
        // Held in the Diary Room chair: acknowledge inputs (so prediction stays in step) but don't move.
        const last = sim.queue.at(-1);
        if (last) player.lastSeq = last.seq;
        sim.queue.length = 0;
      }

      const steps = sim.queue.length > JITTER_BUFFER_TARGET ? 2 : 1;
      for (let i = 0; i < steps && sim.credit >= 1 && sim.queue.length > 0; i++) {
        const input = sim.queue.shift()!;
        sim.credit -= 1;
        if (input.dx !== 0 || input.dz !== 0) {
          // Moving gets you up off whatever you were using, and ends any emote.
          if (player.activity) this.standUp(player, sim);
          sim.emote = null;
          const pos = applyInputStep({ x: player.x, z: player.z }, input.dx, input.dz);
          if (pos.x !== player.x) player.x = pos.x;
          if (pos.z !== player.z) player.z = pos.z;
          player.rotY = Math.atan2(input.dx, input.dz);
          sim.ticksSinceStep = -1;
        }
        player.lastSeq = input.seq;
      }
      sim.ticksSinceStep++;

      if (sim.emote && --sim.emoteTicksLeft <= 0) sim.emote = null;
      this.updateAnim(player, sim);
      const area = areaAt(player.x, player.z)?.id ?? "";
      if (player.area !== area) player.area = area;
    }
    this.tasks.tick();
  }

  // ---------------------------------------------------------------- voice

  private registerVoiceMessages(): void {
    // WebRTC signalling: the server never touches audio, it just forwards the
    // connection offer/answer so two browsers can link up directly.
    // Allowed links: housemate ↔ housemate, housemate ↔ Big Brother, and
    // listening viewer → housemate. Never viewer ↔ viewer or viewer ↔ Big Brother.
    // (Who actually hears whom on those links is decided by voicePolicy.ts on each client.)
    this.onMessage(Msg.voiceSignal, (client, message: unknown) => {
      const signal = parseVoiceSignal(message);
      if (!signal || signal.to === client.sessionId) return;
      const target = this.clients.getById(signal.to);
      if (!target) return;
      const kind = (id: string) =>
        this.state.players.get(id)?.voice
          ? "housemate"
          : id === this.state.bigBrotherId
            ? "admin"
            : this.viewers.get(id)?.audio
              ? "listener"
              : "none";
      const from = kind(client.sessionId);
      const to = kind(signal.to);
      const allowed =
        (from === "housemate" && to !== "none") || ((from === "admin" || from === "listener") && to === "housemate");
      if (!allowed) return;
      const relay: VoiceSignalRelay = { from: client.sessionId, data: signal.data };
      target.send(Msg.voiceSignal, relay);
    });

    this.onMessage(Msg.voiceState, (client, message: unknown) => {
      const state = parseVoiceState(message);
      if (!state) return;
      if (client.sessionId === this.state.bigBrotherId) {
        this.state.bigBrotherSpeaking = state.speaking;
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const speaking = state.speaking && !player.adminMuted;
      if (player.speaking !== speaking) player.speaking = speaking;
      if (player.muted !== state.muted) player.muted = state.muted;
    });
  }

  // ---------------------------------------------------------------- viewers

  private registerViewerMessages(): void {
    this.onMessage(Msg.viewerChat, (client, message: unknown) => {
      const viewer = this.viewers.get(client.sessionId);
      const text = ChatLog.sanitize(field(message, "text"));
      if (!viewer || !text || !this.viewerChat.allow(client.sessionId)) return;
      this.sendToViewers(Msg.viewerChat, this.viewerChat.add({ id: client.sessionId, ...viewer }, text));
    });

    this.onMessage(Msg.viewerChatHistory, (client) => {
      if (this.viewers.has(client.sessionId)) client.send(Msg.viewerChatHistory, this.viewerChat.recent());
    });

    this.onMessage(Msg.viewerReact, (client, message: unknown) => {
      const emoji = field(message, "emoji");
      if (!this.viewers.has(client.sessionId) || !REACTIONS.includes(emoji as Reaction)) return;
      if (!this.reactionLimiter.allow(client.sessionId)) return;
      const reaction: ReactionMessage = { emoji: emoji as Reaction };
      this.sendToViewers(Msg.viewerReact, reaction);
    });
  }

  private joinViewer(client: Client, options: Partial<JoinOptions>): void {
    if (this.viewers.size >= MAX_VIEWERS) throw new Error("This house is full of viewers right now");
    const audioSlotsUsed = [...this.viewers.values()].filter((v) => v.audio).length;
    const viewer: Viewer = {
      name: sanitizeName(options.name, `Viewer ${Math.floor(1000 + Math.random() * 9000)}`),
      color: sanitizeColor(options.color),
      audio: options.voice === true && audioSlotsUsed < MAX_AUDIO_VIEWERS,
    };
    this.viewers.set(client.sessionId, viewer);
    this.state.viewerCount = this.viewers.size;
    const welcome: ViewerWelcome = { audio: viewer.audio };
    client.send(Msg.viewerWelcome, welcome);
  }

  // ---------------------------------------------------------------- Big Brother

  private joinAdmin(client: Client): void {
    // One console at a time: a new one takes over (e.g. after a page reload).
    const previous = this.state.bigBrotherId ? this.clients.getById(this.state.bigBrotherId) : undefined;
    previous?.leave(CloseCode.consoleTakenOver);
    this.state.bigBrotherId = client.sessionId;
    this.state.bigBrotherSpeaking = false;
    client.send(Msg.adminLog, this.events.all());
    this.events.add("admin", "Big Brother console connected");
  }

  private registerAdminMessages(): void {
    /** Registers a handler that silently ignores anyone but the console. */
    const admin = (type: string, handler: (message: unknown, client: Client) => void) =>
      this.onMessage(type, (client, message: unknown) => {
        if (client.sessionId === this.state.bigBrotherId) handler(message, client);
      });

    admin(Msg.adminAnnounce, (message) => {
      const text = ChatLog.sanitize(field(message, "text"));
      if (text) this.announce(text);
    });

    admin(Msg.adminCallDiary, (message) => {
      const id = field(message, "playerId");
      if (typeof id === "string") this.callToDiary(id);
    });

    admin(Msg.adminEndDiary, () => this.endDiary("Big Brother ended the session"));

    admin(Msg.adminDiaryBroadcast, (message) => {
      const broadcast = field(message, "broadcast");
      if (typeof broadcast !== "boolean") return;
      this.state.diaryBroadcast = broadcast;
      this.events.add("diary", `Diary Room ${broadcast ? "is broadcast to viewers" : "is private"}`);
    });

    admin(Msg.adminStartTask, (message) => {
      const type = field(message, "type");
      const reward = field(message, "reward");
      if (!(typeof type === "string" && type in TASKS) || !REWARD_IDS.includes(reward as RewardId)) return;
      this.tasks.start(type as TaskType, reward as RewardId);
    });

    admin(Msg.adminEndTask, () => this.tasks.end("admin"));

    admin(Msg.adminMute, (message) => {
      const id = field(message, "playerId");
      const muted = field(message, "muted");
      const player = typeof id === "string" ? this.state.players.get(id) : undefined;
      if (!player || typeof muted !== "boolean") return;
      player.adminMuted = muted;
      if (muted) player.speaking = false;
      this.events.add("moderation", `${player.name} was ${muted ? "muted" : "unmuted"} by Big Brother`);
    });

    admin(Msg.adminKick, (message) => {
      const id = field(message, "playerId");
      const player = typeof id === "string" ? this.state.players.get(id) : undefined;
      if (!player) return;
      this.events.add("moderation", `${player.name} was removed from the house by Big Brother`);
      this.clients.getById(player.id)?.leave(CloseCode.kicked);
    });
  }

  /** Text banner for everyone, also kept in house chat. */
  private announce(text: string): void {
    const message: AnnouncementMessage = { text, to: "all" };
    this.broadcast(Msg.announcement, message);
    this.broadcast(Msg.chat, this.chat.add(BIG_BROTHER, text));
    this.events.add("announcement", text);
  }

  private callToDiary(playerId: string): void {
    const player = this.state.players.get(playerId);
    const sim = this.sims.get(playerId);
    if (!player || !sim || this.state.diaryHousemate === playerId) return;
    if (this.state.diaryHousemate) this.endDiary("another housemate was called");

    // Clear the chair if someone's sitting in it, and get the caller up from whatever they're doing.
    for (const p of this.state.players.values()) {
      const s = this.sims.get(p.id);
      if (p.activity === "diary-chair" && s) this.standUp(p, s);
    }
    if (player.activity) this.standUp(player, sim);

    const chair = INTERACTABLE_BY_ID.get("diary-chair") as SlotInteractable;
    this.placeInSlot(player, sim, "diary-chair", chair.slots[0]!);
    this.state.diaryHousemate = playerId;

    const call: AnnouncementMessage = { text: "Big Brother would like to see you in the Diary Room.", to: playerId };
    this.clients.getById(playerId)?.send(Msg.announcement, call);
    this.events.add("diary", `${player.name} was called to the Diary Room`);
  }

  private endDiary(reason: string): void {
    const player = this.state.players.get(this.state.diaryHousemate);
    const sim = player && this.sims.get(player.id);
    this.state.diaryHousemate = "";
    if (player && sim && player.activity === "diary-chair") this.standUp(player, sim);
    if (player) this.events.add("diary", `${player.name} left the Diary Room (${reason})`);
  }

  // ---------------------------------------------------------------- helpers

  private sendToViewers(type: string, message: unknown): void {
    for (const c of this.clients) if (this.viewers.has(c.sessionId)) c.send(type, message);
  }

  private sendToHousemates(type: string, message: unknown): void {
    for (const c of this.clients) if (this.state.players.has(c.sessionId)) c.send(type, message);
  }

  private sendToAdmin(type: string, message: unknown): void {
    if (this.state.bigBrotherId) this.clients.getById(this.state.bigBrotherId)?.send(type, message);
  }
}
