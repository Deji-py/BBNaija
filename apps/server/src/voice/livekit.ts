import { AccessToken } from "livekit-server-sdk";
import type { VoiceGrant } from "@bbn/shared";

/** True when the server should hand out LiveKit tokens instead of the mesh. */
export function livekitConfigured(): boolean {
  return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

/**
 * A join token for one house. Viewers get subscribe-only (`publish` false),
 * so they can hear the house without sending audio. Identity is the Colyseus
 * session id, which is also how the clients decide who may hear whom.
 */
export async function livekitGrant(identity: string, seasonId: string, publish: boolean): Promise<VoiceGrant> {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return { provider: "mesh", audio: true };
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: "6h" });
  token.addGrant({
    roomJoin: true,
    room: `house-${seasonId}`,
    canPublish: publish,
    canSubscribe: true,
    canPublishData: false,
  });
  return { provider: "livekit", audio: true, url, token: await token.toJwt() };
}
