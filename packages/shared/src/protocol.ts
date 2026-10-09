import { TICK_RATE_HZ } from "./constants.js";
import { WALK_SPEED } from "./house.js";
import { moveWithCollision, type Vec2 } from "./movement.js";
import type { Activity, EmoteName } from "./interactions.js";
import type { RewardId, TaskType } from "./tasks.js";

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
  /** Housemate (default), a spectator watching via /watch, or the Big Brother console. */
  role?: "housemate" | "viewer" | "admin";
  /** Required for role "admin". In development it also lets bots join as test housemates without an account. */
  adminSecret?: string;
  /** Signed-in user's session token. Required to enter as a housemate; optional for viewers (sets your chat name). */
  sessionToken?: string;
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
  emote: "emote",
  /** Client → server: send a chat line. Server → clients: a chat line to show. */
  chat: "chat",
  /** Client → server: request recent chat. Server → client: the recent chat lines. */
  chatHistory: "chat:history",
  /** Server → housemates: a listen-only voice peer (a viewer) left; close that connection. */
  voicePeerLeft: "voice:peer-left",
  /** Server → viewer, right after joining: what this viewer gets. */
  viewerWelcome: "viewer:welcome",
  /** Viewer chat — only ever sent to viewers, never to housemates. */
  viewerChat: "viewer:chat",
  viewerChatHistory: "viewer:chat-history",
  /** Viewer → server: an emoji reaction. Server → viewers: someone reacted. */
  viewerReact: "viewer:react",

  /** Server → everyone: Big Brother announcement banner. */
  announcement: "announcement",
  /** Diary Room text between Big Brother and the housemate in session (and viewers when broadcast). */
  diaryChat: "diary:chat",
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
  /** Server → console: event log entries (an array; the full log right after joining). */
  adminLog: "admin:log",
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
} as const;

export interface AnnouncementMessage {
  text: string;
  /** Who it's for: "all", or a single housemate's session id (e.g. a Diary Room call). */
  to: "all" | string;
}

export interface DiaryChatMessage {
  text: string;
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

export const REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ReactionMessage {
  emoji: Reaction;
}

export interface VoicePeerLeft {
  id: string;
}

export interface ActionMessage {
  objectId: string;
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
export function applyInputStep(pos: Vec2, dx: number, dz: number): Vec2 {
  const len = Math.hypot(dx, dz);
  if (!Number.isFinite(len) || len === 0) return pos;
  const scale = len > 1 ? 1 / len : 1;
  const dist = WALK_SPEED * INPUT_STEP_SEC * scale;
  return moveWithCollision(pos, dx * dist, dz * dist);
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
  viewerCount: number;
  /** Session id of the Big Brother console ("" when nobody's at the console). */
  bigBrotherId: string;
  /** True while Big Brother is talking to the whole house (not during private Diary Room talk). */
  bigBrotherSpeaking: boolean;
  /** Housemate in the Diary Room with Big Brother ("" if none). */
  diaryHousemate: string;
  diaryBroadcast: boolean;
  /** The current (or just finished) task; undefined when none. */
  task: TaskView | undefined;
  /** Server clock (ms since epoch) at the last patch, to line up countdowns. */
  serverTime: number;
}
