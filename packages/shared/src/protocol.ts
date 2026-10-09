import { TICK_RATE_HZ } from "./constants.js";
import { WALK_SPEED } from "./house.js";
import { moveWithCollision, type Vec2 } from "./movement.js";

/** Max housemates in one house. P2P voice (M3) gets heavy beyond ~8. */
export const MAX_HOUSEMATES = 8;

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
  /** True for real browser clients that take part in voice chat (bots leave it off). */
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
} as const;

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

/** Animation a player is in. Only idle/walk exist until M4 adds interactions and emotes. */
export type AnimState = "idle" | "walk";

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
}

export interface HouseStateView {
  players: Map<string, PlayerView>;
}
