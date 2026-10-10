import { TICK_RATE_HZ } from "./constants.js";
import { RUN_SPEED, SWIM_SPEED, WALK_SPEED, type Box2D } from "./house.js";
import { poolInterior } from "./interactions.js";
import { moveWithCollision, type Vec2 } from "./movement.js";
import type { Activity, EmoteName } from "./interactions.js";
import type { RewardId, TaskType } from "./tasks.js";
import type { RoundView } from "./round.js";
import type { GameId } from "./gameStations.js";
import type { GameResult } from "./games/types.js";
import type { NeedValues } from "./needs.js";

/** Max housemates in one house. P2P voice (M3) gets heavy beyond ~8. */
export const MAX_HOUSEMATES = 8;
/** Max spectators per house room for the MVP (one room holds everyone; relay rooms come later). */
export const MAX_VIEWERS = 100;
/**
 * Viewers who get live audio. In the P2P mesh every listening viewer costs each
 * housemate one more outgoing audio stream, so keep this small until LiveKit (M9).
 */
export const MAX_AUDIO_VIEWERS = 10;

export const NAME_MAX_LENGTH = 20;

/** Shirt colours offered in the lobby. */
export const AVATAR_COLORS = [
  "#e4572e",
  "#f3a712",
  "#29bf12",
  "#17bebb",
  "#3f88c5",
  "#7b2cbf",
  "#ef476f",
  "#2b2d42",
] as const;

/** Options a client passes when joining the house room. */
export interface JoinOptions {
  name: string;
  color: string;
  /** Which house (season) to join. Each live season has its own house room. */
  seasonId: string;
  /** Housemate (default), a spectator watching via /watch, or the Big Brother console. */
  role?: "housemate" | "viewer" | "admin";
  /** Platform admin secret: opens any house's console. In development it also lets bots join as test housemates. */
  adminSecret?: string;
  /** Signed-in user's session token. Required to enter as a housemate or host; optional for viewers (sets your chat name). */
  sessionToken?: string;
  /** Character look from the creator (see look.ts); housemates only. */
  look?: string;
  /** True for real browser clients that take part in voice chat (bots leave it off). For viewers: listen-only. */
  voice?: boolean;
}

/**
 * One fixed-length movement step. The client sends one per 1/TICK_RATE_HZ
 * seconds while moving. `seq` increases by one per input so the client can
 * tell which of its inputs the server has already applied.
 */
export interface InputMessage {
  seq: number;
  /** Holding Shift to run (ignored while swimming). */
  run?: boolean;
  /** World-space direction on the ground plane; length ≤ 1. */
  dx: number;
  dz: number;
}

/** Message type names. `voice:signal` goes both ways (relayed by the server). */
export const Msg = {
  input: "input",
  voiceSignal: "voice:signal",
  voiceState: "voice:state",
  /** Client → server: use (or stop using) an object. */
  action: "action",
  /** Client → server: pick the home-theater station (only while it is on, and only from beside it). */
  tvStation: "tv:station",
  /** Client → server: pick the TV channel (only while the TV is on, and only from beside it). */
  tvChannel: "tv:channel",
  emote: "emote",
  /** Client → server: send a chat line. Server → clients: a chat line to show. */
  chat: "chat",
  /** Client → server: request recent chat. Server → client: the recent chat lines. */
  chatHistory: "chat:history",
  /** Server → housemates: a listen-only voice peer (a viewer) left; close that connection. */
  voicePeerLeft: "voice:peer-left",
  /** Server → viewer, right after joining: what this viewer gets. */
  viewerWelcome: "viewer:welcome",
  /** Client → server, once its handler is listening: ask how voice is provided. */
  voiceHello: "voice:hello",
  /** Server → client: mesh (local) or a LiveKit token (when the server is configured for it). */
  voiceWelcome: "voice:welcome",
  /** Viewer chat — only ever sent to viewers, never to housemates. */
  viewerChat: "viewer:chat",
  viewerChatHistory: "viewer:chat-history",
  /** Viewer → server: an emoji reaction. Server → viewers: someone reacted. */
  viewerReact: "viewer:react",

  /** Server → everyone: Big Brother announcement banner. */
  announcement: "announcement",
  /** Diary Room text between Big Brother and the housemate in session (and viewers when broadcast). */
  diaryChat: "diary:chat",
  /** Housemate at the Diary Room door → server: ask to see Big Brother (or confess, when nobody's at the console). */
  diaryRequest: "diary:request",
  /** Housemate → server: leave a confession session (only those; Big Brother ends the others). */
  diaryLeave: "diary:leave",
  /** Server → viewers only: a live caption about what's going on that the house doesn't know. */
  caption: "caption",
  /** Viewer → server: request recent captions. Server → viewer: the recent captions. */
  captionHistory: "caption:history",
  /** Housemate → server: answer to the current quiz question. */
  quizAnswer: "quiz:answer",

  // Big Brother console → server
  adminAnnounce: "admin:announce",
  adminCallDiary: "admin:call-diary",
  adminEndDiary: "admin:end-diary",
  adminDiaryBroadcast: "admin:diary-broadcast",
  adminStartTask: "admin:start-task",
  adminEndTask: "admin:end-task",
  adminMute: "admin:mute",
  adminKick: "admin:kick",
  /** Console → server: set the house clock ({ minutes }). */
  adminSetTime: "admin:set-time",
  /** Console → server: every room's lights on or off ({ on }). */
  adminLights: "admin:lights",
  /** Server → console: event log entries (an array; the full log right after joining). */
  adminLog: "admin:log",
  /** Server → housemate: a pick-up or put-down was refused, with why (e.g. "Someone's standing there"). */
  propRefused: "prop:refused",
  /** Housemate → server: jump (Space). Near the pool edge you jump in. */
  jump: "jump",
  /** Housemate at the DJ booth → server, then server → everyone: confetti or fireworks. */
  partyEffect: "party:effect",

  // Games hall (see games/ and gameStations.ts)
  /** Client → server: open a game station's panel (housemates must be beside it; viewers can watch any). */
  gameWatch: "game:watch",
  /** Client → server: close the panel. */
  gameUnwatch: "game:unwatch",
  /** Housemate → server: take a free seat at the station you're watching. */
  gameSit: "game:sit",
  /** Housemate → server: give up your seat (forfeits a game in progress). */
  gameLeave: "game:leave",
  /** Seated housemate → server: start (or restart) the game once enough players are seated. */
  gameStart: "game:start",
  /** Seated housemate → server: a move ({ move }). */
  gameMove: "game:move",
  /** Seated housemate → server: real-time control input ({ input }). */
  gameInput: "game:input",
  /** Server → watcher: the table as that client sees it. */
  gameTable: "game:table",
  /** Server → client: why a game action was refused. */
  gameError: "game:error",

  /** Housemate → server, from the Diary Room during nominations. */
  nominate: "nominate",
  /** Viewer → server, during an open voting window. */
  vote: "vote",
  /** Server → one housemate: who they can nominate, and whether they already have. */
  nominationStatus: "round:nomination",
  /** Server → one viewer: their vote was recorded or rejected. */
  voteAck: "round:vote",
  /** Server → console only: nomination progress and ceremony step. Vote totals stay off this until the reveal. */
  roundAdmin: "round:admin",
  /** Console → server, once its handler is listening: send the ceremony status again. */
  roundSync: "round:sync",

  adminStartNominations: "admin:start-nominations",
  adminCancelNominations: "admin:cancel-nominations",
  adminCloseNominations: "admin:close-nominations",
  adminBbNominate: "admin:bb-nominate",
  adminOpenVoting: "admin:open-voting",
  adminCloseVoting: "admin:close-voting",
  adminReveal: "admin:reveal",
  adminStartFinale: "admin:start-finale",
} as const;

/**
 * WebSocket close codes the server uses when it removes someone. Colyseus reserves
 * 4000–4010 (e.g. 4001 server shutdown, 4002 error, 4010 may-reconnect), so ours live at 4500+.
 */
export const CloseCode = {
  kicked: 4501,
  /** The Big Brother console was opened somewhere else. */
  consoleTakenOver: 4502,
  /** The same account entered the house from another window. */
  joinedElsewhere: 4503,
  /** This housemate was evicted. They can watch, but they can't re-enter the house. */
  evicted: 4504,
} as const;

export interface AnnouncementMessage {
  text: string;
  /** Who it's for: "all", or a single housemate's session id (e.g. a Diary Room call). */
  to: "all" | string;
}

export interface DiaryChatMessage {
  text: string;
}

/** Viewer-only caption ("Ada nominated Tobi — they were in the kitchen together 4 minutes ago"). */
export interface CaptionMessage {
  id: number;
  icon: string;
  text: string;
  at: number;
  /** Housemates it's about (session ids), so the viewer camera can go to them. */
  focus: string[];
}

export interface QuizAnswerMessage {
  /** Option index 0–3. */
  answer: number;
}

export interface AdminAnnounceMessage {
  text: string;
}
export interface AdminTargetMessage {
  playerId: string;
}
export interface AdminMuteMessage {
  playerId: string;
  muted: boolean;
}
export interface AdminStartTaskMessage {
  type: TaskType;
  reward: RewardId;
}
export interface AdminDiaryBroadcastMessage {
  broadcast: boolean;
}

export interface EventLogEntry {
  id: number;
  /** Server time, ms since epoch. */
  at: number;
  type: string;
  text: string;
}

export interface ViewerWelcome {
  /** Whether this viewer got one of the MAX_AUDIO_VIEWERS audio slots. */
  audio: boolean;
}

/**
 * How this client should carry voice. Sent after the client says `voice:hello`,
 * so the handler is already listening. `audio: false` means stay silent
 * (a mesh viewer who didn't get one of the listen slots).
 */
export interface VoiceGrant {
  provider: "mesh" | "livekit";
  audio: boolean;
  /** Browser-reachable LiveKit websocket URL. Set when provider is livekit. */
  url?: string;
  /** Short-lived join token. Set when provider is livekit. */
  token?: string;
  /** STUN/TURN servers for the mesh. Missing means the client's public STUN default. */
  iceServers?: IceServer[];
}

/** Same shape as the browser's RTCIceServer. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ReactionMessage {
  emoji: Reaction;
}

export interface VoicePeerLeft {
  id: string;
}

/**
 * Use (or stop using) an object. Props: `prop:<id>` picks it up, `prop:drop`
 * puts down whatever you're carrying.
 */
export interface ActionMessage {
  objectId: string;
}

export type PartyEffect = "confetti" | "fireworks";

export interface PartyEffectMessage {
  kind: PartyEffect;
}

export interface PropRefusedMessage {
  reason: string;
}

/** One game station as a watcher sees it (sent on every change, and every tick for real-time games). */
export interface GameTableView {
  station: string;
  game: GameId;
  /** Seated housemates in seat order. During a game, seat i is index i here. */
  seats: Array<{ id: string; name: string; color: string }>;
  phase: "lobby" | "playing" | "over";
  /** Your seat, or -1 if you're only watching. */
  you: number;
  /** Seats whose move is awaited. */
  turn: number[];
  /** The game's view for you (see each game's `view`); null in the lobby before the first game. */
  view: unknown;
  result: GameResult | null;
  watchers: number;
}

export interface GameErrorMessage {
  text: string;
}

/** Synced state of one prop (see props.ts). */
export interface PropView {
  x: number;
  z: number;
  y: number;
  rotY: number;
  heldBy: string;
}

export interface TvStationMessage {
  station: string;
}

export interface TvChannelMessage {
  channel: string;
  /** Set when switching to a movie that was just uploaded. */
  token?: string;
}

export interface EmoteMessage {
  name: EmoteName;
}

export const CHAT_MAX_LENGTH = 280;
/** How many recent chat lines the server keeps for people who join later. */
export const CHAT_HISTORY_SIZE = 50;

export interface ChatSendMessage {
  text: string;
}

export interface ChatMessage {
  /** Increasing id, unique within the room. */
  id: number;
  fromId: string;
  name: string;
  color: string;
  text: string;
  /** Server time (ms since epoch). */
  at: number;
}

/** WebRTC session description exchanged when two housemates set up a voice link. */
export interface VoiceSignalData {
  type: "offer" | "answer";
  sdp: string;
}

/** Client → server: please forward this to player `to`. */
export interface VoiceSignalMessage {
  to: string;
  data: VoiceSignalData;
}

/** Server → client: a signal forwarded from player `from`. */
export interface VoiceSignalRelay {
  from: string;
  data: VoiceSignalData;
}

/** Client → server: my current voice status, shown to everyone as an icon. */
export interface VoiceStateMessage {
  speaking: boolean;
  muted: boolean;
}

/** Longest SDP the server will relay. Real audio-only SDPs are a few KB. */
export const MAX_SDP_LENGTH = 20_000;

/** Within this distance (m) a voice plays at full volume. */
export const VOICE_REF_DISTANCE = 1.5;
/** Beyond this distance (m) a voice is silent. */
export const VOICE_MAX_DISTANCE = 15;

/** Duration of one input step in seconds. */
export const INPUT_STEP_SEC = 1 / TICK_RATE_HZ;

/**
 * Applies one input step. Client (prediction) and server (authority) both call
 * this, so given the same start position and inputs they land on the same spot.
 */
/** How a step moves you: walking, running (Shift) or swimming in the pool. */
export type MoveMode = "walk" | "run" | "swim";

const SPEED: Record<MoveMode, number> = { walk: WALK_SPEED, run: RUN_SPEED, swim: SWIM_SPEED };

/**
 * One input step. Walking and running collide with walls and furniture;
 * swimming moves freely inside the pool (and never out of it).
 */
export function applyInputStep(pos: Vec2, dx: number, dz: number, colliders?: readonly Box2D[], mode: MoveMode = "walk"): Vec2 {
  const len = Math.hypot(dx, dz);
  if (!Number.isFinite(len) || len === 0) return pos;
  const scale = len > 1 ? 1 / len : 1;
  const dist = SPEED[mode] * INPUT_STEP_SEC * scale;
  if (mode === "swim") {
    const r = poolInterior();
    return {
      x: Math.min(r.maxX, Math.max(r.minX, pos.x + dx * dist)),
      z: Math.min(r.maxZ, Math.max(r.minZ, pos.z + dz * dist)),
    };
  }
  return moveWithCollision(pos, dx * dist, dz * dist, colliders);
}

/** Speed (m/s) for a movement mode, e.g. for drawing the partial step between inputs. */
export function moveSpeed(mode: MoveMode): number {
  return SPEED[mode];
}

/** Animation a player is in: moving, an emote, or an activity with an object. */
export type AnimState = "idle" | "walk" | EmoteName | Activity;

/**
 * Read-only view of the synced room state, as seen by clients.
 * Mirrors the server's Colyseus schema in apps/server/src/schema.
 */
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  rotY: number;
  anim: AnimState;
  area: string;
  /** Last input `seq` the server applied for this player. */
  lastSeq: number;
  /** Takes part in voice chat (browser client, not a bot). */
  voice: boolean;
  speaking: boolean;
  muted: boolean;
  /** Id of the object being used ("" when free). */
  activity: string;
  /** Muted by Big Brother: no voice, no house chat. */
  adminMuted: boolean;
  /** Rewards won from tasks (RewardId values). */
  perks: string[];
  /** Cooking challenge progress (COOK_STAGE). */
  cookStage: number;
  /** Server is walking them out of the house after an eviction. */
  exiting: boolean;
  /** Id of the prop being carried ("" = hands free). */
  carrying: string;
  /** Character look (see look.ts `decodeLook`). */
  look: string;
  /** Goes up by one on every jump, so clients can play the hop. */
  jump: number;
  /** Hunger, energy, hygiene… 0–100 each (see needs.ts). Absent until the first patch. */
  needs: NeedValues | undefined;
}

export interface GemView {
  id: string;
  x: number;
  z: number;
  found: boolean;
}

export interface QuizView {
  /** 1-based question number. */
  number: number;
  total: number;
  question: string;
  options: string[];
  /** Answering closes at this server time (ms since epoch). */
  endsAt: number;
  revealed: boolean;
  /** Correct option, -1 until revealed. */
  correct: number;
}

export interface TaskView {
  type: TaskType;
  title: string;
  description: string;
  reward: RewardId;
  status: "running" | "done";
  /** Server time (ms) the task ends; 0 for the quiz (it runs per question). */
  endsAt: number;
  scores: Map<string, number>;
  winners: string[];
  gems: GemView[];
  quiz: QuizView | undefined;
}

export interface HouseStateView {
  /** Housemates only — viewers are never in here. */
  players: Map<string, PlayerView>;
  tvOn: boolean;
  /** Which video channel is showing ("" until the TV has been switched on). */
  tvChannel: string;
  /** Token for the uploaded movie, when one is stored for this house. */
  tvMovie: string;
  /** The home theater beside the TV. Music plays from here, not from the television. */
  theaterOn: boolean;
  /** Which original station the home theater is on ("" until it has been switched on). */
  tvStation: string;
  /** Space-separated ids of doors that are open. Missing ids are shut. */
  openDoors: string;
  /** Every movable prop, by id. */
  props: Map<string, PropView>;
  /** Busy game stations: station id → "waiting" or "playing" (absent = free). */
  stations: Map<string, string>;
  /** Space-separated ids of rooms whose lights are switched off. */
  lightsOff: string;
  /** Time of day in the house, in minutes since midnight (0–1440). */
  dayMinutes: number;
  /** Party mode in the party room: music, lights and the dance floor. */
  partyOn: boolean;
  viewerCount: number;
  /** Session id of the Big Brother console ("" when nobody's at the console). */
  bigBrotherId: string;
  /** True while Big Brother is talking to the whole house (not during private Diary Room talk). */
  bigBrotherSpeaking: boolean;
  /** Housemate in the Diary Room with Big Brother ("" if none). */
  diaryHousemate: string;
  diaryBroadcast: boolean;
  /** The session is a confession the housemate asked for (no Big Brother at the console); they may leave it. */
  diaryConfession: boolean;
  /** The current (or just finished) task; undefined when none. */
  task: TaskView | undefined;
  /** Server clock (ms since epoch) at the last patch, to line up countdowns. */
  serverTime: number;
  /** The nomination / voting / eviction ceremony. Absent until the first state patch. */
  round: RoundView | undefined;
}
