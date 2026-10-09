import {
  AVATAR_COLORS,
  MAX_SDP_LENGTH,
  NAME_MAX_LENGTH,
  type InputMessage,
  type VoiceSignalMessage,
  type VoiceStateMessage,
} from "@bbn/shared";

/** Validation for untrusted client messages. Each returns null for anything malformed. */

export function parseInput(message: unknown): InputMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { seq, dx, dz } = message as Record<string, unknown>;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof dx !== "number" || typeof dz !== "number") return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  return { seq, dx, dz };
}

export function parseVoiceSignal(message: unknown): VoiceSignalMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { to, data } = message as Record<string, unknown>;
  if (typeof to !== "string" || typeof data !== "object" || data === null) return null;
  const { type, sdp } = data as Record<string, unknown>;
  if (type !== "offer" && type !== "answer") return null;
  if (typeof sdp !== "string" || sdp.length > MAX_SDP_LENGTH) return null;
  return { to, data: { type, sdp } };
}

export function parseVoiceState(message: unknown): VoiceStateMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { speaking, muted } = message as Record<string, unknown>;
  if (typeof speaking !== "boolean" || typeof muted !== "boolean") return null;
  return { speaking, muted };
}

/** Reads one field from an untrusted message object. */
export function field(message: unknown, key: string): unknown {
  return typeof message === "object" && message !== null ? (message as Record<string, unknown>)[key] : undefined;
}

export function sanitizeName(raw: unknown, fallback = "Housemate"): string {
  const name = typeof raw === "string" ? raw.replace(/[\p{C}]/gu, "").trim().slice(0, NAME_MAX_LENGTH) : "";
  return name || fallback;
}

export function sanitizeColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : AVATAR_COLORS[0];
}
