import { Msg, type VoiceGrant } from "@bbn/shared";
import type { HouseRoom } from "../net/connection.js";
import type { SpatialAudio } from "./spatialAudio.js";
import { LiveKitVoiceProvider } from "./livekitVoice.js";
import { MeshVoiceProvider } from "./meshVoice.js";
import type { RoutedVoice } from "./VoiceProvider.js";

/**
 * Asks the server how voice works, then opens it. The ask happens after the
 * handler is registered, so the reply isn't dropped.
 *
 * No LiveKit config on the server means the peer-to-peer mesh (free, local).
 * With LiveKit configured, everyone in the house shares one relay room and
 * viewers only subscribe.
 */
export function connectVoice(
  room: HouseRoom,
  audio: SpatialAudio,
  shouldOffer: (id: string) => boolean,
  localStream: MediaStream | null,
): Promise<{ voice: RoutedVoice | null; grant: VoiceGrant }> {
  return new Promise((resolve) => {
    room.onMessage(Msg.voiceWelcome, (grant: VoiceGrant) => {
      if (!grant.audio) {
        resolve({ voice: null, grant });
        return;
      }
      const voice: RoutedVoice =
        grant.provider === "livekit" && grant.url && grant.token
          ? new LiveKitVoiceProvider(grant.url, grant.token, audio, room)
          : new MeshVoiceProvider(room, audio, shouldOffer, grant.iceServers);
      voice.join(localStream);
      resolve({ voice, grant });
    });
    room.send(Msg.voiceHello);
  });
}
