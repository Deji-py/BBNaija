import { Room, type Client } from "colyseus";
import {
  CloseCode,
  EMOTES,
  LOOPING_EMOTES,
  LIGHT_SWITCHES,
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
  decodeLook,
  encodeLook,
  LOOK_SLOTS,
  applyInputStep,
  areaAt,
  chooseSlot,
  housemateStatus,
  distanceToObject,
  collidersFor,
  DOORS,
  PROPS,
  PROP_BY_ID,
  REALTIME_HZ,
  PROP_PICKUP_RANGE,
  distanceToProp,
  doorBox,
  placeProp,
  propColliders,
  type PropRefusedMessage,
  type PartyEffectMessage,
  openDoorList,
  MOVIE_CHANNEL,
  tvChannel,
  tvStation,
  type AnimState,
  type AnnouncementMessage,
  type ChatMessage,
  type EmoteName,
  type InputMessage,
  type VoiceGrant,
  type JoinOptions,
  type Reaction,
  type ReactionMessage,
  type RewardId,
  type SlotInteractable,
  type TaskType,
  type HouseSummary,
  type ViewerWelcome,
  type VoicePeerLeft,
  type VoiceSignalRelay,
} from "@bbn/shared";
import { isAdminSecret, isProduction } from "../config.js";
import { userFromSession } from "../accounts/auth.js";
import { getSeason, housemateAccess, isHostOf } from "../accounts/seasons.js";
import { savePerks } from "../accounts/seasons.js";
import { HouseState, Prop, Player, Round } from "../schema/HouseState.js";
import { ChatLog } from "../systems/chat.js";
import { currentMovieToken, movieTokenMatches } from "../movies/store.js";
import { eventLog } from "../systems/eventLog.js";
import { db } from "../db/client.js";
import { livekitConfigured, livekitGrant } from "../voice/livekit.js";
import { RateLimiter } from "../systems/rateLimit.js";
import { SeasonRound } from "../systems/round.js";
import { TaskRunner } from "../systems/tasks.js";
import { GameHall } from "../systems/gameHall.js";
import { NeedsSystem } from "../systems/needs.js";
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
/** How long a one-off emote (wave, clap, laugh…) lasts. Looping ones (dance, sitting, lying) continue until you move. */
const WAVE_TICKS = Math.round(2.5 * TICK_RATE_HZ);
/** One house day lasts this many real minutes. */
const DAY_REAL_MINUTES = 48;
/** Running costs energy, so you can't run when you're exhausted. */
const MIN_ENERGY_TO_RUN = 8;

/** How Big Brother appears in house chat and the Diary Room. */
const BIG_BROTHER = { id: "bigbrother", name: "Big Brother", color: "#e0243b" } as const;

/** What onAuth decided about a joining client (available as `client.auth` in onJoin). */
interface JoinAuth {
  role: "housemate" | "viewer" | "admin";
  /** Signed-in account, if any. */
  userId?: string;
  /** Name from the account / application. */
  name?: string;
  /** Rewards this housemate still holds (immunity, nomination power, crown). */
  perks?: string[];
}

interface Viewer {
  name: string;
  color: string;
  /** Holds one of the MAX_AUDIO_VIEWERS listen-only voice slots. */
  audio: boolean;
  /** Set when they joined signed in. Required to vote. */
  userId?: string;
}

interface PlayerSim {
  queue: InputMessage[];
  credit: number;
  ticksSinceStep: number;
  emote: EmoteName | null;
  emoteTicksLeft: number;
  /** Ticks since the last running step (for the energy cost of running). */
  ticksSinceRun: number;
}

/**
 * One live house. The server is authoritative: clients only send *inputs*
 * ("I want to move this way"), the server applies them with the shared
 * collision code and broadcasts the resulting positions.
 *
 * Three kinds of client share the room: housemates (in `state.players`),
 * viewers (watching via /watch) and the Big Brother console (/bigbrother).
 */
export class HouseRoom extends Room<{ state: HouseState; metadata: HouseSummary }> {
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
  private readonly jumpLimiter = new RateLimiter(3, 400);
  private readonly partyLimiter = new RateLimiter(3, 1500);
  private unsubscribeLog: () => void = () => {};
  private tasks!: TaskRunner;
  private games!: GameHall;
  private needs!: NeedsSystem;
  private round!: SeasonRound;
  /** The season (house) this room belongs to. One room per live season (see filterBy in index.ts). */
  private seasonId = "";
  /** Ids of doors currently open. Shut doors are colliders; this stays in step with `state.openDoors`. */
  private readonly openDoors = new Set<string>();
  private diaryChatId = 1;

  /** Session ids by account, so one account can't be in the house twice. */
  private readonly sessionByUser = new Map<string, string>();

  /**
   * Who may join this house as what:
   * - console: the platform admin secret, or the season's host (signed in);
   * - housemate: a signed-in user selected for this season while it's live (in
   *   development, the admin secret also admits test housemates such as `pnpm bots`);
   * - viewer: anyone, while the season is live (signing in just sets your viewer-chat name).
   */
  override async onAuth(_client: Client, options: Partial<JoinOptions> = {}): Promise<JoinAuth> {
    const season = await getSeason(this.seasonId);
    if (!season) throw new Error("This house doesn't exist");
    const user = await userFromSession(options.sessionToken);

    if (options.role === "admin") {
      if (isAdminSecret(options.adminSecret) || isHostOf(user, season)) return { role: "admin" };
      throw new Error(user ? "You don't host this house" : "Wrong admin secret");
    }
    if (options.role === "viewer") {
      if (season.status !== "live") throw new Error("This house isn't live right now");
      return { role: "viewer", userId: user?.id, name: user?.displayName ?? undefined };
    }

    if (!isProduction && isAdminSecret(options.adminSecret)) return { role: "housemate" }; // dev test housemate
    if (!user) throw new Error("Please sign in to enter the house");
    const access = await housemateAccess(user.id, season.id);
    if (!access) throw new Error("Only selected housemates of this live season can enter the house");
    return { role: "housemate", userId: user.id, name: access.displayName, perks: access.perks };
  }

  override async onCreate(options: Partial<JoinOptions> = {}): Promise<void> {
    // A room only ever exists for a real season; anything else is refused before anyone joins.
    const season = await getSeason(options.seasonId);
    if (!season) throw new Error("This house doesn't exist");
    this.seasonId = season.id;
    this.state.tvOn = false;
    this.state.tvChannel = "";
    this.state.tvMovie = currentMovieToken(this.seasonId);
    this.state.theaterOn = false;
    this.state.tvStation = "";
    this.state.openDoors = "";
    this.state.lightsOff = "";
    this.state.dayMinutes = 10 * 60; // the house wakes up at 10:00
    this.state.partyOn = false;
    // Every light object starts in its place; housemates can carry them around from there.
    for (const spec of PROPS) {
      const prop = new Prop();
      prop.x = spec.x;
      prop.z = spec.z;
      prop.y = spec.y;
      prop.rotY = spec.rotY;
      prop.heldBy = "";
      this.state.props.set(spec.id, prop);
    }
    this.state.viewerCount = 0;
    this.state.bigBrotherId = "";
    this.state.bigBrotherSpeaking = false;
    this.state.diaryHousemate = "";
    this.state.diaryBroadcast = true;
    this.state.serverTime = Date.now();
    const round = new Round();
    round.phase = "free";
    round.round = 0;
    round.kind = "";
    round.voteEndsAt = 0;
    round.votingOpen = false;
    round.evictedName = "";
    round.winnerName = "";
    round.winnerColor = "";
    this.state.round = round;

    this.tasks = new TaskRunner(this.state, this.clock, {
      log: (type, text) => this.log(type, text),
      announce: (text) => this.announce(text),
      standUp: (player) => {
        const sim = this.sims.get(player.id);
        if (sim && player.activity) this.standUp(player, sim);
      },
      onReward: (player) => {
        const userId = this.userIdFor(player.id);
        if (userId) void savePerks(userId, this.seasonId, [...player.perks]).catch((err) => console.error("[perks]", err));
      },
    });
    this.round = new SeasonRound(this.state, this.clock, {
      seasonId: this.seasonId,
      userId: (sessionId) => this.userIdFor(sessionId),
      viewer: (sessionId) => {
        const viewer = this.viewers.get(sessionId);
        return viewer?.userId ? { userId: viewer.userId, name: viewer.name } : undefined;
      },
      taskRunning: () => !!this.tasks.running,
      log: (type, text) => this.log(type, text),
      announce: (text) => this.announce(text),
      send: (sessionId, type, message) => this.clients.getById(sessionId)?.send(type, message),
      sendAdmin: (message) => this.sendToAdmin(Msg.roundAdmin, message),
      leave: (sessionId, code) => this.clients.getById(sessionId)?.leave(code),
      standUp: (player) => {
        const sim = this.sims.get(player.id);
        if (sim && player.activity) this.standUp(player, sim);
      },
      endDiary: () => this.endDiary("they were evicted"),
      setDiaryPrivate: () => {
        this.state.diaryBroadcast = false;
      },
      persistPerks: async (sessionId) => {
        const userId = this.userIdFor(sessionId);
        const player = this.state.players.get(sessionId);
        if (!userId || !player) return;
        await savePerks(userId, this.seasonId, [...player.perks]);
      },
    });
    await this.round.load();

    this.games = new GameHall({
      state: this.state,
      send: (sessionId, type, message) => this.clients.getById(sessionId)?.send(type, message),
      isViewer: (sessionId) => this.viewers.has(sessionId),
      log: (type, text) => this.log(type, text),
    });
    this.clock.setInterval(() => this.games.tick(), 1000 / REALTIME_HZ);
    this.needs = new NeedsSystem({
      state: this.state,
      isPlaying: (sessionId) => this.games.isSeated(sessionId),
      isRunning: (sessionId) => (this.sims.get(sessionId)?.ticksSinceRun ?? Infinity) < TICK_RATE_HZ,
      notify: (sessionId, text) => {
        const message: AnnouncementMessage = { text, to: sessionId };
        this.clients.getById(sessionId)?.send(Msg.announcement, message);
      },
    });
    this.clock.setInterval(() => this.needs.tick(1), 1000);
    this.clock.setInterval(() => {
      this.state.dayMinutes = (this.state.dayMinutes + 1440 / (DAY_REAL_MINUTES * 60)) % 1440;
    }, 1000);

    this.registerHousemateMessages();
    this.registerGameMessages();
    this.registerVoiceMessages();
    this.registerViewerMessages();
    this.registerAdminMessages();

    this.unsubscribeLog = eventLog.subscribe((entry, seasonId) => {
      if (seasonId === this.seasonId) this.sendToAdmin(Msg.adminLog, [entry]);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE_HZ);
    // Clients line their countdowns up with this.
    this.clock.setInterval(() => (this.state.serverTime = Date.now()), 1000);
    // Summary for the home-page grid of live houses. Colyseus only allows setting
    // metadata directly in onCreate; later updates go through setMatchmaking().
    this.metadata = this.summary();
    this.clock.setInterval(() => {
      this.setMatchmaking({ metadata: this.summary() }).catch((err) => console.error("[house] summary update failed", err));
    }, 2000);
    this.log("room", `House opened (${season.name})`);
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}, auth?: JoinAuth): void {
    if (auth?.role === "admin") return this.joinAdmin(client);
    if (auth?.role === "viewer") return this.joinViewer(client, { ...options, name: auth.name ?? options.name }, auth.userId);

    // Same account entering again (e.g. a second tab): the newest window wins.
    const previous = auth?.userId ? this.sessionByUser.get(auth.userId) : undefined;
    if (previous) this.clients.getById(previous)?.leave(CloseCode.joinedElsewhere);
    else if (this.state.players.size >= MAX_HOUSEMATES) throw new Error("The house is full");
    if (auth?.userId) this.sessionByUser.set(auth.userId, client.sessionId);

    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(auth?.name ?? options.name);
    // The look is validated by decoding it; your name colour follows your top.
    const look = decodeLook(options.look);
    player.look = encodeLook(look);
    player.color = options.look ? LOOK_SLOTS.top[look.top]! : sanitizeColor(options.color);

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
    player.exiting = false;
    player.carrying = "";
    player.jump = 0;
    for (const perk of auth?.perks ?? []) player.perks.push(perk);

    this.state.players.set(client.sessionId, player);
    this.needs.join(player, auth?.userId);
    this.sims.set(client.sessionId, {
      queue: [],
      credit: MAX_INPUT_CREDIT,
      ticksSinceStep: WALK_GRACE_TICKS,
      emote: null,
      emoteTicksLeft: 0,
      ticksSinceRun: Infinity,
    });
    this.tasks.running?.scores.set(client.sessionId, 0);
    this.round.onHousemateJoined(client.sessionId);
    this.log("join", `${player.name} entered the house (${this.state.players.size}/${MAX_HOUSEMATES})`);
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;

    if (id === this.state.bigBrotherId) {
      this.state.bigBrotherId = "";
      this.state.bigBrotherSpeaking = false;
      if (this.state.diaryHousemate) this.endDiary("the console closed");
      this.log("admin", "Big Brother console disconnected");
      return;
    }

    this.games.onLeft(id);
    const viewer = this.viewers.get(id);
    if (viewer) {
      this.viewers.delete(id);
      this.viewerChat.forget(id);
      this.reactionLimiter.forget(id);
      this.state.viewerCount = this.viewers.size;
      void db.watchSession
        .updateMany({ where: { sessionId: id, endedAt: null }, data: { endedAt: new Date() } })
        .catch((err) => console.error("[watch]", err));
      if (viewer.audio) {
        const left: VoicePeerLeft = { id };
        this.sendToHousemates(Msg.voicePeerLeft, left);
        this.sendToAdmin(Msg.voicePeerLeft, left);
      }
      return;
    }

    const player = this.state.players.get(id);
    if (player?.carrying) this.putDown(player, true);
    this.needs.leave(id, this.userIdFor(id));
    for (const [userId, sessionId] of this.sessionByUser) if (sessionId === id) this.sessionByUser.delete(userId);
    if (id === this.state.diaryHousemate) this.state.diaryHousemate = "";
    this.state.players.delete(id);
    this.sims.delete(id);
    this.chat.forget(id);
    this.tasks.onPlayerLeft(id);
    this.round.onPlayerLeft(id);
    this.log("leave", `${player?.name ?? id} left the house`);
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

    this.onMessage(Msg.tvStation, (client, message: unknown) => {
      const station = tvStation(String(field(message, "station") ?? ""));
      const player = this.state.players.get(client.sessionId);
      if (!station || !player || player.exiting || !this.state.theaterOn) return;
      if (distanceToObject("home-theater", player.x, player.z) > 1.8) return;
      this.state.tvStation = station;
    });

    this.onMessage(Msg.tvChannel, (client, message: unknown) => {
      const requested = String(field(message, "channel") ?? "");
      const player = this.state.players.get(client.sessionId);
      if (!player || player.exiting || !this.state.tvOn) return;
      if (distanceToObject("tv", player.x, player.z) > 1.8) return;
      if (requested === MOVIE_CHANNEL) {
        const sent = field(message, "token");
        const token = typeof sent === "string" && sent ? sent : this.state.tvMovie;
        if (!movieTokenMatches(this.seasonId, token)) return;
        this.state.tvMovie = token;
        this.state.tvChannel = MOVIE_CHANNEL;
        return;
      }
      const channel = tvChannel(requested);
      if (!channel) return;
      this.state.tvChannel = channel.id;
    });

    this.onMessage(Msg.emote, (client, message: unknown) => {
      const name = field(message, "name");
      const player = this.state.players.get(client.sessionId);
      const sim = this.sims.get(client.sessionId);
      if (!player || !sim || !EMOTES.includes(name as EmoteName) || player.activity || player.exiting || player.carrying) return;
      if (this.isInDiary(player.id)) return;
      if (LOOPING_EMOTES.has(name as EmoteName) && sim.emote === name) {
        sim.emote = null; // choosing a looping emote again stops it
      } else {
        sim.emote = name as EmoteName;
        sim.emoteTicksLeft = LOOPING_EMOTES.has(name as EmoteName) ? Infinity : WAVE_TICKS;
      }
      this.updateAnim(player, sim);
    });

    this.onMessage(Msg.chat, (client, message: unknown) => {
      const player = this.state.players.get(client.sessionId);
      const text = ChatLog.sanitize(field(message, "text"));
      if (!player || !text || player.adminMuted || player.exiting || this.isInDiary(player.id)) return;
      if (!this.chat.allow(client.sessionId)) return;
      this.broadcast(Msg.chat, this.chat.add(player, text));
      this.needs.onChat(client.sessionId);
    });

    this.onMessage(Msg.jump, (client) => {
      const player = this.state.players.get(client.sessionId);
      const sim = this.sims.get(client.sessionId);
      if (!player || !sim || player.exiting || player.activity || this.isInDiary(player.id)) return;
      if (!this.jumpLimiter.allow(client.sessionId)) return;
      player.jump = (player.jump + 1) % 256;
      sim.emote = null;
      // Jumping at the pool's edge takes you in.
      const pool = INTERACTABLE_BY_ID.get("pool");
      if (pool && pool.kind === "pool" && distanceToObject("pool", player.x, player.z) <= 1.2 && !player.carrying) {
        const swimmers = [...this.state.players.values()].filter((p) => p.activity === "pool");
        const slot = chooseSlot(pool, player, swimmers);
        if (slot) this.placeInSlot(player, sim, "pool", slot);
      }
    });

    this.onMessage(Msg.partyEffect, (client, message: unknown) => {
      const kind = field(message, "kind");
      const player = this.state.players.get(client.sessionId);
      if (!player || (kind !== "confetti" && kind !== "fireworks")) return;
      if (distanceToObject("dj-booth", player.x, player.z) > 2.5 || !this.partyLimiter.allow("dj")) return;
      const effect: PartyEffectMessage = { kind };
      this.broadcast(Msg.partyEffect, effect);
    });

    this.onMessage(Msg.chatHistory, (client) => {
      client.send(Msg.chatHistory, this.chat.recent());
    });

    this.onMessage(Msg.quizAnswer, (client, message: unknown) => {
      const answer = field(message, "answer");
      if (typeof answer === "number") this.tasks.onQuizAnswer(client.sessionId, answer);
    });

    this.onMessage(Msg.nominate, (client, message: unknown) => {
      const nomineeIds = field(message, "nomineeIds");
      if (!Array.isArray(nomineeIds) || nomineeIds.length > 2) return;
      if (nomineeIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 80)) return;
      this.round.nominate(client.sessionId, nomineeIds);
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

  /** Games hall: watching, seats and moves. GameHall re-checks distance, seats and turns. */
  private registerGameMessages(): void {
    this.onMessage(Msg.gameWatch, (client, message: unknown) => this.games.watch(client.sessionId, field(message, "station")));
    this.onMessage(Msg.gameUnwatch, (client) => this.games.unwatch(client.sessionId));
    this.onMessage(Msg.gameSit, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.exiting || this.isInDiary(player.id) || player.carrying) return;
      this.games.sit(client.sessionId);
    });
    this.onMessage(Msg.gameLeave, (client) => this.games.leave(client.sessionId));
    this.onMessage(Msg.gameStart, (client) => this.games.start(client.sessionId));
    this.onMessage(Msg.gameMove, (client, message: unknown) => this.games.move(client.sessionId, field(message, "move")));
    this.onMessage(Msg.gameInput, (client, message: unknown) => this.games.input(client.sessionId, field(message, "input")));
  }

  /**
   * Press E near an object. The server re-checks everything the client's prompt
   * showed (distance, free spot) because clients can't be trusted.
   */
  private handleAction(playerId: string, objectId: string): void {
    const player = this.state.players.get(playerId);
    const sim = this.sims.get(playerId);
    if (!player || !sim || player.exiting || this.isInDiary(playerId)) return;

    // Carrying something: the only action is putting it down.
    if (player.carrying) {
      if (objectId === "prop:drop") this.putDown(player, false);
      return;
    }
    if (objectId.startsWith("prop:")) {
      this.pickUp(player, objectId.slice(5));
      return;
    }

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

    if (it.kind === "door") {
      if (this.openDoors.has(objectId)) this.openDoors.delete(objectId);
      else this.openDoors.add(objectId);
      this.state.openDoors = openDoorList(this.openDoors);
      return;
    }
    if (it.kind === "light") {
      const area = objectId.slice("light-".length);
      const off = new Set(this.state.lightsOff.split(" ").filter(Boolean));
      if (off.has(area)) off.delete(area);
      else off.add(area);
      this.state.lightsOff = [...off].sort().join(" ");
      return;
    }
    if (it.kind === "toggle") {
      if (objectId === "dj-booth") {
        this.state.partyOn = !this.state.partyOn;
        this.log("party", `${player.name} ${this.state.partyOn ? "started" : "stopped"} the party`);
        return;
      }
      if (objectId === "home-theater") {
        this.state.theaterOn = !this.state.theaterOn;
        if (this.state.theaterOn && !this.state.tvStation) this.state.tvStation = "groove";
      } else {
        this.state.tvOn = !this.state.tvOn;
        if (this.state.tvOn && !this.state.tvChannel) this.state.tvChannel = "news";
      }
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

  /** Pick up a prop: in reach, not already carried, and only with free hands. */
  private pickUp(player: Player, propId: string): void {
    const spec = PROP_BY_ID.get(propId);
    const prop = this.state.props.get(propId);
    if (!spec || !prop || player.activity || player.carrying) return;
    if (prop.heldBy) return this.refuse(player, "Someone's already carrying that");
    if (distanceToProp(spec, prop, player.x, player.z) > PROP_PICKUP_RANGE) return;
    prop.heldBy = player.id;
    player.carrying = propId;
    const sim = this.sims.get(player.id);
    if (sim) sim.emote = null;
  }

  /**
   * Put down what a player carries, in front of them (on a table if it's over one).
   * `force` (leaving, Diary Room call, eviction): if that spot isn't allowed, the
   * prop goes back to where it started instead of staying in their hands.
   */
  private putDown(player: Player, force: boolean): void {
    const spec = PROP_BY_ID.get(player.carrying);
    const prop = this.state.props.get(player.carrying);
    if (!spec || !prop) {
      player.carrying = "";
      return;
    }
    const placement = placeProp(spec, player.x, player.z, player.rotY, {
      players: [...this.state.players.values()].filter((p) => p.id !== player.id),
      props: this.state.props.entries(),
      closedDoors: DOORS.filter((d) => !this.openDoors.has(d.id)).map(doorBox),
    });
    if (!placement.ok && !force) return this.refuse(player, placement.reason);
    const at = placement.ok ? placement : { x: spec.x, z: spec.z, y: spec.y, rotY: spec.rotY };
    prop.x = at.x;
    prop.z = at.z;
    prop.y = at.y;
    prop.rotY = at.rotY;
    prop.heldBy = "";
    player.carrying = "";
  }

  private refuse(player: Player, reason: string): void {
    const message: PropRefusedMessage = { reason };
    this.clients.getById(player.id)?.send(Msg.propRefused, message);
  }

  /** What blocks walking right now: walls, fixed furniture, shut doors, and solid props on the floor. */
  private colliders() {
    return collidersFor(this.openDoors, propColliders(this.state.props.entries()));
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
    this.round.tick();
    const colliders = this.colliders();
    for (const [id, sim] of this.sims) {
      const player = this.state.players.get(id);
      if (!player) continue;

      sim.credit = Math.min(sim.credit + 1, MAX_INPUT_CREDIT);

      // Eviction walk is server-driven. Acknowledge inputs so prediction stays in step, but don't apply them.
      if (player.exiting) {
        if (player.carrying) this.putDown(player, true);
        const last = sim.queue.at(-1);
        if (last) player.lastSeq = last.seq;
        sim.queue.length = 0;
        sim.emote = null;
        continue;
      }

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
          // Swimmers move around inside the pool; otherwise moving gets you up off
          // whatever you were using, and ends any emote.
          const swimming = player.activity === "pool";
          if (player.activity && !swimming) this.standUp(player, sim);
          sim.emote = null;
          const running = !swimming && input.run === true && (player.needs?.energy ?? 100) >= MIN_ENERGY_TO_RUN;
          if (running) sim.ticksSinceRun = 0;
          const mode = swimming ? "swim" : running ? "run" : "walk";
          const pos = applyInputStep({ x: player.x, z: player.z }, input.dx, input.dz, colliders, mode);
          if (pos.x !== player.x) player.x = pos.x;
          if (pos.z !== player.z) player.z = pos.z;
          player.rotY = Math.atan2(input.dx, input.dz);
          sim.ticksSinceStep = -1;
        }
        player.lastSeq = input.seq;
      }
      sim.ticksSinceStep++;
      sim.ticksSinceRun++;

      if (sim.emote && --sim.emoteTicksLeft <= 0) sim.emote = null;
      this.updateAnim(player, sim);
      const area = areaAt(player.x, player.z)?.id ?? "";
      if (player.area !== area) player.area = area;
    }
    this.tasks.tick();
  }

  // ---------------------------------------------------------------- voice

  private registerVoiceMessages(): void {
    // The client asks once its handler is listening. Mesh unless LiveKit is configured.
    this.onMessage(Msg.voiceHello, (client) => {
      void this.voiceGrantFor(client)
        .then((grant) => client.send(Msg.voiceWelcome, grant))
        .catch((err) => console.error("[voice]", err));
    });

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

    this.onMessage(Msg.vote, (client, message: unknown) => {
      if (!this.viewers.has(client.sessionId)) return;
      const token = field(message, "token");
      if (typeof token !== "string" || token.length === 0 || token.length > 8) return;
      this.round.vote(client.sessionId, token);
    });
  }

  private joinViewer(client: Client, options: Partial<JoinOptions>, userId?: string): void {
    if (this.viewers.size >= MAX_VIEWERS) throw new Error("This house is full of viewers right now");
    const audioSlotsUsed = [...this.viewers.values()].filter((v) => v.audio).length;
    const viewer: Viewer = {
      name: sanitizeName(options.name, `Viewer ${Math.floor(1000 + Math.random() * 9000)}`),
      color: sanitizeColor(options.color),
      // LiveKit subscribers don't use a mesh slot. The mesh still caps listeners.
      audio: options.voice === true && (livekitConfigured() || audioSlotsUsed < MAX_AUDIO_VIEWERS),
      userId,
    };
    this.viewers.set(client.sessionId, viewer);
    this.state.viewerCount = this.viewers.size;
    const welcome: ViewerWelcome = { audio: viewer.audio };
    client.send(Msg.viewerWelcome, welcome);
    void db.watchSession
      .create({ data: { seasonId: this.seasonId, userId: userId ?? null, sessionId: client.sessionId } })
      .catch((err) => console.error("[watch]", err));
  }

  /** Mesh, or a LiveKit token. Viewers without an audio slot stay silent. */
  private async voiceGrantFor(client: Client): Promise<VoiceGrant> {
    const viewer = this.viewers.get(client.sessionId);
    const inHouse = !!this.state.players.get(client.sessionId) || client.sessionId === this.state.bigBrotherId || !!viewer;
    if (!inHouse) return { provider: "mesh", audio: false };
    if (viewer && !viewer.audio) return { provider: "mesh", audio: false };
    if (!livekitConfigured()) return { provider: "mesh", audio: true };
    return livekitGrant(client.sessionId, this.seasonId, !viewer);
  }

  // ---------------------------------------------------------------- Big Brother

  private joinAdmin(client: Client): void {
    // One console at a time: a new one takes over (e.g. after a page reload).
    const previous = this.state.bigBrotherId ? this.clients.getById(this.state.bigBrotherId) : undefined;
    previous?.leave(CloseCode.consoleTakenOver);
    this.state.bigBrotherId = client.sessionId;
    this.state.bigBrotherSpeaking = false;
    client.send(Msg.adminLog, eventLog.forSeason(this.seasonId));
    this.round.onAdminJoined();
    this.log("admin", "Big Brother console connected");
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
      this.log("diary", `Diary Room ${broadcast ? "is broadcast to viewers" : "is private"}`);
    });

    admin(Msg.adminStartTask, (message) => {
      const type = field(message, "type");
      const reward = field(message, "reward");
      if (!(typeof type === "string" && type in TASKS) || !REWARD_IDS.includes(reward as RewardId)) return;
      if (!this.round.allowsTasks()) {
        this.round.notice("Finish the ceremony before starting a task.");
        return;
      }
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
      this.log("moderation", `${player.name} was ${muted ? "muted" : "unmuted"} by Big Brother`);
    });

    admin(Msg.adminKick, (message) => {
      const id = field(message, "playerId");
      const player = typeof id === "string" ? this.state.players.get(id) : undefined;
      if (!player) return;
      this.log("moderation", `${player.name} was removed from the house by Big Brother`);
      this.clients.getById(player.id)?.leave(CloseCode.kicked);
    });

    admin(Msg.adminSetTime, (message) => {
      const minutes = field(message, "minutes");
      if (typeof minutes !== "number" || !Number.isFinite(minutes)) return;
      this.state.dayMinutes = ((minutes % 1440) + 1440) % 1440;
      this.log("house", `Big Brother set the clock to ${Math.floor(this.state.dayMinutes / 60)}:${String(Math.floor(this.state.dayMinutes % 60)).padStart(2, "0")}`);
    });
    admin(Msg.adminLights, (message) => {
      const on = field(message, "on");
      if (typeof on !== "boolean") return;
      this.state.lightsOff = on ? "" : LIGHT_SWITCHES.map((sw) => sw.area).sort().join(" ");
      this.announce(on ? "Lights on, housemates." : "Lights out, housemates. Time for bed.");
    });

    admin(Msg.roundSync, () => this.round.onAdminJoined());
    admin(Msg.adminStartNominations, () => this.round.startNominations());
    admin(Msg.adminCancelNominations, () => this.round.cancelNominations());
    admin(Msg.adminCloseNominations, () => this.round.closeNominations());
    admin(Msg.adminBbNominate, (message) => {
      const id = field(message, "playerId");
      if (typeof id === "string") this.round.bbNominate(id);
    });
    admin(Msg.adminOpenVoting, (message) => {
      const seconds = field(message, "seconds");
      if (typeof seconds === "number") this.round.openVoting(seconds);
    });
    admin(Msg.adminCloseVoting, () => this.round.closeVoting());
    admin(Msg.adminReveal, (message) => {
      const token = field(message, "token");
      this.round.reveal(typeof token === "string" ? token : "");
    });
    admin(Msg.adminStartFinale, () => this.round.startFinale());
  }

  /** Text banner for everyone, also kept in house chat. */
  private announce(text: string): void {
    const message: AnnouncementMessage = { text, to: "all" };
    this.broadcast(Msg.announcement, message);
    this.broadcast(Msg.chat, this.chat.add(BIG_BROTHER, text));
    this.log("announcement", text);
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
    if (player.carrying) this.putDown(player, true);

    const chair = INTERACTABLE_BY_ID.get("diary-chair") as SlotInteractable;
    this.placeInSlot(player, sim, "diary-chair", chair.slots[0]!);
    this.state.diaryHousemate = playerId;
    this.round.onEnteredDiary(playerId);

    const call: AnnouncementMessage = { text: "Big Brother would like to see you in the Diary Room.", to: playerId };
    this.clients.getById(playerId)?.send(Msg.announcement, call);
    this.log("diary", `${player.name} was called to the Diary Room`);
  }

  private endDiary(reason: string): void {
    const player = this.state.players.get(this.state.diaryHousemate);
    const sim = player && this.sims.get(player.id);
    this.state.diaryHousemate = "";
    if (player && sim && player.activity === "diary-chair") this.standUp(player, sim);
    if (player) this.log("diary", `${player.name} left the Diary Room (${reason})`);
  }

  // ---------------------------------------------------------------- helpers

  private log(type: string, text: string): void {
    eventLog.add(type, text, this.seasonId);
  }

  /** What the home-page grid shows about this house (published as Colyseus room metadata). */
  private summary(): HouseSummary {
    const task = this.state.task?.status === "running" ? this.state.task.title : "";
    return {
      seasonId: this.seasonId,
      viewerCount: this.state.viewerCount,
      housemates: [...this.state.players.values()].map((p) => ({
        name: p.name,
        color: p.color,
        x: Math.round(p.x * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        status: housemateStatus(p),
        speaking: p.speaking,
      })),
      task,
      round: this.roundLabel(),
      diary: !!this.state.diaryHousemate,
      tvOn: this.state.tvOn,
    };
  }

  private roundLabel(): string {
    const round = this.state.round;
    if (!round || round.phase === "free" || round.phase === "") return "";
    if (round.phase === "nominations") return "Nominations";
    if (round.phase === "voting") return round.kind === "finale" ? "Finale vote" : "Voting";
    if (round.phase === "eviction") return "Eviction";
    if (round.phase === "finale") return "Finale";
    return "";
  }

  private userIdFor(sessionId: string): string | undefined {
    for (const [userId, id] of this.sessionByUser) if (id === sessionId) return userId;
    return undefined;
  }

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
