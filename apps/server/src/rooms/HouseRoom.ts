import { Room, type Client } from "colyseus";
import {
  AVATAR_COLORS,
  EMOTES,
  INTERACTABLE_BY_ID,
  MAX_AUDIO_VIEWERS,
  MAX_HOUSEMATES,
  MAX_VIEWERS,
  MAX_SDP_LENGTH,
  Msg,
  NAME_MAX_LENGTH,
  REACTIONS,
  SPAWN_POINT,
  TICK_RATE_HZ,
  activityExit,
  applyInputStep,
  areaAt,
  chooseSlot,
  distanceToObject,
  type AnimState,
  type EmoteName,
  type InputMessage,
  type JoinOptions,
  type Reaction,
  type ReactionMessage,
  type ViewerWelcome,
  type VoicePeerLeft,
  type VoiceSignalMessage,
  type VoiceSignalRelay,
  type VoiceStateMessage,
} from "@bbn/shared";
import { HouseState, Player } from "../schema/HouseState.js";
import { ChatLog } from "../systems/chat.js";
import { RateLimiter } from "../systems/rateLimit.js";

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
 */
export class HouseRoom extends Room<{ state: HouseState }> {
  // Housemates and viewers share the room; onJoin enforces each limit separately.
  override maxClients = MAX_HOUSEMATES + MAX_VIEWERS;
  override state = new HouseState();
  override patchRate = 1000 / TICK_RATE_HZ;
  override maxMessagesPerSecond = 60;

  private readonly sims = new Map<string, PlayerSim>();
  private readonly chat = new ChatLog();
  /** Spectators, by session id. Not part of the synced state: housemates never see who's watching. */
  private readonly viewers = new Map<string, Viewer>();
  private readonly viewerChat = new ChatLog();
  private readonly reactionLimiter = new RateLimiter(5, 300);

  override onCreate(): void {
    this.state.tvOn = false;
    this.state.viewerCount = 0;

    this.onMessage(Msg.input, (client, message: unknown) => {
      const input = parseInput(message);
      const sim = this.sims.get(client.sessionId);
      if (!input || !sim) return;
      if (sim.queue.length >= MAX_QUEUED_INPUTS) return;
      sim.queue.push(input);
    });

    // WebRTC signalling: the server never touches audio, it just forwards the
    // connection offer/answer between two housemates so they can link up directly.
    // Allowed links: housemate ↔ housemate, and viewer → housemate (listen-only).
    // Never viewer ↔ viewer.
    this.onMessage(Msg.voiceSignal, (client, message: unknown) => {
      const signal = parseVoiceSignal(message);
      if (!signal || signal.to === client.sessionId) return;
      const target = this.clients.getById(signal.to);
      if (!target) return;
      const senderIsHousemate = this.state.players.get(client.sessionId)?.voice === true;
      const targetIsHousemate = this.state.players.get(signal.to)?.voice === true;
      const senderIsListener = this.viewers.get(client.sessionId)?.audio === true;
      const targetIsListener = this.viewers.get(signal.to)?.audio === true;
      const allowed =
        (senderIsHousemate && (targetIsHousemate || targetIsListener)) || (senderIsListener && targetIsHousemate);
      if (!allowed) return;
      const relay: VoiceSignalRelay = { from: client.sessionId, data: signal.data };
      target.send(Msg.voiceSignal, relay);
    });

    this.onMessage(Msg.voiceState, (client, message: unknown) => {
      const state = parseVoiceState(message);
      const player = this.state.players.get(client.sessionId);
      if (!state || !player) return;
      if (player.speaking !== state.speaking) player.speaking = state.speaking;
      if (player.muted !== state.muted) player.muted = state.muted;
    });

    this.onMessage(Msg.action, (client, message: unknown) => {
      const objectId = (message as { objectId?: unknown } | null)?.objectId;
      if (typeof objectId === "string") this.handleAction(client.sessionId, objectId);
    });

    this.onMessage(Msg.emote, (client, message: unknown) => {
      const name = (message as { name?: unknown } | null)?.name;
      const player = this.state.players.get(client.sessionId);
      const sim = this.sims.get(client.sessionId);
      if (!player || !sim || !EMOTES.includes(name as EmoteName) || player.activity) return;
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
      const text = ChatLog.sanitize((message as { text?: unknown } | null)?.text);
      if (!player || !text || !this.chat.allow(client.sessionId)) return;
      this.broadcast(Msg.chat, this.chat.add(player, text));
    });

    this.onMessage(Msg.chatHistory, (client) => {
      client.send(Msg.chatHistory, this.chat.recent());
    });

    // --- viewers only ---
    this.onMessage(Msg.viewerChat, (client, message: unknown) => {
      const viewer = this.viewers.get(client.sessionId);
      const text = ChatLog.sanitize((message as { text?: unknown } | null)?.text);
      if (!viewer || !text || !this.viewerChat.allow(client.sessionId)) return;
      this.sendToViewers(Msg.viewerChat, this.viewerChat.add({ id: client.sessionId, ...viewer }, text));
    });

    this.onMessage(Msg.viewerChatHistory, (client) => {
      if (this.viewers.has(client.sessionId)) client.send(Msg.viewerChatHistory, this.viewerChat.recent());
    });

    this.onMessage(Msg.viewerReact, (client, message: unknown) => {
      const emoji = (message as { emoji?: unknown } | null)?.emoji;
      if (!this.viewers.has(client.sessionId) || !REACTIONS.includes(emoji as Reaction)) return;
      if (!this.reactionLimiter.allow(client.sessionId)) return;
      const reaction: ReactionMessage = { emoji: emoji as Reaction };
      this.sendToViewers(Msg.viewerReact, reaction);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE_HZ);
    console.log(`[house ${this.roomId}] created`);
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    if (options.role === "viewer") return this.joinViewer(client, options);
    if (this.state.players.size >= MAX_HOUSEMATES) throw new Error("The house is full");

    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(options.name);
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

    this.state.players.set(client.sessionId, player);
    this.sims.set(client.sessionId, {
      queue: [],
      credit: MAX_INPUT_CREDIT,
      ticksSinceStep: WALK_GRACE_TICKS,
      emote: null,
      emoteTicksLeft: 0,
    });
    console.log(`[house ${this.roomId}] ${player.name} joined (${this.state.players.size}/${this.maxClients})`);
  }

  override onLeave(client: Client): void {
    const viewer = this.viewers.get(client.sessionId);
    if (viewer) {
      this.viewers.delete(client.sessionId);
      this.viewerChat.forget(client.sessionId);
      this.reactionLimiter.forget(client.sessionId);
      this.state.viewerCount = this.viewers.size;
      if (viewer.audio) {
        const left: VoicePeerLeft = { id: client.sessionId };
        this.sendToHousemates(Msg.voicePeerLeft, left);
      }
      return;
    }

    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sims.delete(client.sessionId);
    this.chat.forget(client.sessionId);
    console.log(`[house ${this.roomId}] ${player?.name ?? client.sessionId} left`);
  }

  override onDispose(): void {
    console.log(`[house ${this.roomId}] disposed`);
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

  private sendToViewers(type: string, message: unknown): void {
    for (const c of this.clients) if (this.viewers.has(c.sessionId)) c.send(type, message);
  }

  private sendToHousemates(type: string, message: unknown): void {
    for (const c of this.clients) if (this.state.players.has(c.sessionId)) c.send(type, message);
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

  /**
   * Press E near an object. The server re-checks everything the client's prompt
   * showed (distance, free spot) because clients can't be trusted.
   */
  private handleAction(playerId: string, objectId: string): void {
    const player = this.state.players.get(playerId);
    const sim = this.sims.get(playerId);
    const it = INTERACTABLE_BY_ID.get(objectId);
    if (!player || !sim || !it) return;

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

    const occupied = [...this.state.players.values()].filter((p) => p.activity === objectId);
    const slot = chooseSlot(it, player, occupied);
    if (!slot) return; // full

    // Drop movement still queued from before pressing E, and tell the client we've
    // handled it so its prediction doesn't replay those steps.
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
    if (it && it.kind !== "toggle") anim = it.activity;
    else if (sim.emote) anim = sim.emote;
    else anim = sim.ticksSinceStep < WALK_GRACE_TICKS ? "walk" : "idle";
    if (player.anim !== anim) player.anim = anim;
  }

  /** One server tick: apply queued inputs to each player within their movement budget. */
  private tick(): void {
    for (const [id, sim] of this.sims) {
      const player = this.state.players.get(id);
      if (!player) continue;

      sim.credit = Math.min(sim.credit + 1, MAX_INPUT_CREDIT);

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
  }
}

function parseInput(message: unknown): InputMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { seq, dx, dz } = message as Record<string, unknown>;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof dx !== "number" || typeof dz !== "number") return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  return { seq, dx, dz };
}

function parseVoiceSignal(message: unknown): VoiceSignalMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { to, data } = message as Record<string, unknown>;
  if (typeof to !== "string" || typeof data !== "object" || data === null) return null;
  const { type, sdp } = data as Record<string, unknown>;
  if (type !== "offer" && type !== "answer") return null;
  if (typeof sdp !== "string" || sdp.length > MAX_SDP_LENGTH) return null;
  return { to, data: { type, sdp } };
}

function parseVoiceState(message: unknown): VoiceStateMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { speaking, muted } = message as Record<string, unknown>;
  if (typeof speaking !== "boolean" || typeof muted !== "boolean") return null;
  return { speaking, muted };
}

function sanitizeName(raw: unknown, fallback = "Housemate"): string {
  const name = typeof raw === "string" ? raw.replace(/[\p{C}]/gu, "").trim().slice(0, NAME_MAX_LENGTH) : "";
  return name || fallback;
}

function sanitizeColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : AVATAR_COLORS[0];
}
