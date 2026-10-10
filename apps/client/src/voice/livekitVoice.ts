import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { Msg, type VoicePeerLeft } from "@bbn/shared";
import type { HouseRoom } from "../net/connection.js";
import type { SpatialAudio } from "./spatialAudio.js";
import type { HearMode, RoutedVoice, Vec3 } from "./VoiceProvider.js";

/**
 * Voice through a LiveKit room (one per house). The server fans audio out, so
 * viewers can listen without each housemate uploading a copy per listener.
 *
 * Who may subscribe is still decided here, with the same rules as the mesh:
 * LiveKit only forwards our mic to the identities we allow. Playback volume
 * stays in SpatialAudio, so proximity and the Diary Room sound the same.
 */
export class LiveKitVoiceProvider implements RoutedVoice {
  private readonly lk = new Room();
  private localTrack: MediaStreamTrack | null = null;
  private remoteStreamCb: ((id: string, stream: MediaStream) => void) | null = null;
  private muted = true;
  private active = false;
  private readonly sendTo = new Map<string, boolean>();
  private readonly peers = new Set<string>();
  private syncQueued = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly audio: SpatialAudio,
    room: HouseRoom,
  ) {
    room.onMessage(Msg.voicePeerLeft, ({ id }: VoicePeerLeft) => this.removePeer(id));
    this.lk.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.notePeer(p.identity));
    this.lk.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => this.removePeer(p.identity));
    this.lk.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const id = participant.identity;
      this.notePeer(id);
      const stream = new MediaStream([track.mediaStreamTrack]);
      this.audio.attach(id, stream);
      this.remoteStreamCb?.(id, stream);
    });
    this.lk.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.audio.detach(participant.identity);
    });
  }

  join(localStream: MediaStream | null): void {
    this.localTrack = localStream?.getAudioTracks()[0] ?? null;
    if (this.localTrack) this.localTrack.enabled = !this.muted;
    this.active = true;
    void this.connect();
  }

  leave(): void {
    this.active = false;
    this.localTrack?.stop();
    this.localTrack = null;
    for (const id of this.peers) this.audio.detach(id);
    this.peers.clear();
    void this.lk.disconnect();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.localTrack) this.localTrack.enabled = !muted;
  }

  onRemoteStream(cb: (id: string, stream: MediaStream) => void): void {
    this.remoteStreamCb = cb;
  }

  setListenerPosition(pos: Vec3, yaw: number): void {
    this.audio.setListener(pos, yaw);
  }

  setSourcePosition(id: string, pos: Vec3): void {
    this.audio.setSourcePosition(id, pos);
  }

  addPeer(id: string): void {
    this.notePeer(id);
  }

  removePeer(id: string): void {
    this.peers.delete(id);
    this.sendTo.delete(id);
    this.audio.detach(id);
    this.queueSync();
  }

  setSendAllowed(id: string, allowed: boolean): void {
    if (this.sendTo.get(id) === allowed) return;
    this.sendTo.set(id, allowed);
    this.queueSync();
  }

  peerIds(): string[] {
    return [...this.peers];
  }

  setHearMode(id: string, mode: HearMode): void {
    this.audio.setMode(id, mode);
  }

  private notePeer(id: string): void {
    if (!id || id === this.lk.localParticipant.identity) return;
    this.peers.add(id);
  }

  private async connect(): Promise<void> {
    try {
      await this.lk.connect(this.url, this.token);
      for (const p of this.lk.remoteParticipants.values()) this.notePeer(p.identity);
      if (this.localTrack && this.active) {
        await this.lk.localParticipant.publishTrack(this.localTrack, { source: Track.Source.Microphone });
      }
      this.queueSync();
    } catch (err) {
      console.warn("[voice] LiveKit connection failed", err);
    }
  }

  /** One permission update per frame of setSendAllowed calls, not one per peer. */
  private queueSync(): void {
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      if (!this.active || !this.localTrack) return;
      const allowed = [...this.sendTo.entries()]
        .filter(([, ok]) => ok)
        .map(([id]) => ({ participantIdentity: id, allowAll: true }));
      this.lk.localParticipant.setTrackSubscriptionPermissions(false, allowed);
    });
  }
}
