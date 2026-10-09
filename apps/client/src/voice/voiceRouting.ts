import { canHear, type HouseStateView, type VoiceContext } from "@bbn/shared";
import type { MeshVoiceProvider } from "./meshVoice.js";

export function voiceContext(state: HouseStateView): VoiceContext {
  const housemates = new Map<string, { adminMuted: boolean }>();
  state.players?.forEach((p, id) => housemates.set(id, { adminMuted: p.adminMuted }));
  return {
    housemates,
    bigBrotherId: state.bigBrotherId ?? "",
    diaryHousemate: state.diaryHousemate ?? "",
    diaryBroadcast: state.diaryBroadcast ?? false,
  };
}

/**
 * Applies the shared who-hears-whom rules (voicePolicy.ts) to our own voice links,
 * in both directions: don't send our mic to anyone who mustn't hear it, and
 * don't play anyone we mustn't hear. Call once per frame; it only changes
 * things when a decision flips.
 *
 * `sendFilter` overrides the send decision (the Big Brother console uses it for
 * its Diary Room / whole-house talk buttons).
 */
export function applyVoiceRouting(
  voice: MeshVoiceProvider,
  me: string,
  state: HouseStateView,
  sendFilter?: (peerId: string, ctx: VoiceContext) => boolean,
): void {
  const ctx = voiceContext(state);
  for (const id of voice.peerIds()) {
    voice.setSendAllowed(id, sendFilter ? sendFilter(id, ctx) : canHear(me, id, ctx));
    const hear = canHear(id, me, ctx);
    // Big Brother is heard everywhere at full volume; the console hears the Diary Room the same way.
    const direct = id === ctx.bigBrotherId || (me === ctx.bigBrotherId && id === ctx.diaryHousemate);
    voice.spatial.setMode(id, !hear ? "muted" : direct ? "direct" : "spatial");
  }
}
