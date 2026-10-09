/**
 * Who may hear whom. WebRTC audio flows directly between browsers, so the
 * server can't filter it; instead every client applies this same rule twice:
 * it only *sends* its mic to peers allowed to hear it, and only *plays* audio
 * from peers it's allowed to hear.
 */

export interface VoiceContext {
  /** Housemates (by session id) and whether Big Brother muted them. */
  housemates: ReadonlyMap<string, { adminMuted: boolean }>;
  /** Session id of the Big Brother console ("" if none). */
  bigBrotherId: string;
  /** Housemate currently in a Diary Room session ("" if none). */
  diaryHousemate: string;
  /** Whether viewers may hear the Diary Room housemate. */
  diaryBroadcast: boolean;
}

export type VoiceRole = "housemate" | "admin" | "viewer";

export function roleOf(id: string, ctx: VoiceContext): VoiceRole {
  if (ctx.housemates.has(id)) return "housemate";
  if (id && id === ctx.bigBrotherId) return "admin";
  return "viewer";
}

/**
 * May `from`'s voice reach `to`? For Big Brother as the sender this only says
 * who *could* hear; the console decides who actually does with its two
 * hold-to-talk buttons (Diary Room / whole house).
 */
export function canHear(from: string, to: string, ctx: VoiceContext): boolean {
  const fromRole = roleOf(from, ctx);
  const toRole = roleOf(to, ctx);

  if (fromRole === "viewer") return false; // viewers never send audio
  if (fromRole === "admin") return toRole === "housemate";

  // From a housemate:
  if (ctx.housemates.get(from)?.adminMuted) return false;
  if (from === ctx.diaryHousemate) {
    // In the Diary Room: only Big Brother, plus viewers when it's broadcast.
    return toRole === "admin" || (toRole === "viewer" && ctx.diaryBroadcast);
  }
  if (to === ctx.diaryHousemate) return false; // the Diary Room can't hear the house
  return true;
}
