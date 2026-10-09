import { CHAT_HISTORY_SIZE, CHAT_MAX_LENGTH, type ChatMessage } from "@bbn/shared";

/** Token bucket: up to BURST messages at once, refilling one every REFILL_MS. */
const BURST = 3;
const REFILL_MS = 1500;

/** Recent house chat plus per-player rate limiting. */
export class ChatLog {
  private readonly history: ChatMessage[] = [];
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private nextId = 1;

  /** Cleans up raw input. Returns null if nothing sendable is left. */
  static sanitize(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const text = raw
      .replace(/[\p{Cc}\p{Cf}]/gu, " ") // control & invisible formatting characters
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    return Array.from(text).slice(0, CHAT_MAX_LENGTH).join(""); // slice by code point, not UTF-16 unit
  }

  /** True if this player may send now (consumes a token). */
  allow(playerId: string, now = Date.now()): boolean {
    const b = this.buckets.get(playerId) ?? { tokens: BURST, updatedAt: now };
    b.tokens = Math.min(BURST, b.tokens + (now - b.updatedAt) / REFILL_MS);
    b.updatedAt = now;
    this.buckets.set(playerId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  add(from: { id: string; name: string; color: string }, text: string): ChatMessage {
    const msg: ChatMessage = { id: this.nextId++, fromId: from.id, name: from.name, color: from.color, text, at: Date.now() };
    this.history.push(msg);
    if (this.history.length > CHAT_HISTORY_SIZE) this.history.shift();
    return msg;
  }

  recent(): ChatMessage[] {
    return [...this.history];
  }

  forget(playerId: string): void {
    this.buckets.delete(playerId);
  }
}
