import { CHAT_HISTORY_SIZE, CHAT_MAX_LENGTH, type ChatMessage } from "@bbn/shared";
import { RateLimiter } from "./rateLimit.js";

/** Up to 3 messages at once, then one every 1.5 s. */
const BURST = 3;
const REFILL_MS = 1500;

/** Recent chat plus per-sender rate limiting. Used for house chat and (separately) viewer chat. */
export class ChatLog {
  private readonly history: ChatMessage[] = [];
  private readonly limiter = new RateLimiter(BURST, REFILL_MS);
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

  /** True if this sender may send now (consumes a token). */
  allow(senderId: string): boolean {
    return this.limiter.allow(senderId);
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

  forget(senderId: string): void {
    this.limiter.forget(senderId);
  }
}
