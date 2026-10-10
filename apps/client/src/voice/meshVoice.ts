import {
  Msg,
  type VoicePeerLeft,
  type VoiceSignalData,
  type VoiceSignalMessage,
  type VoiceSignalRelay,
} from "@bbn/shared";
import type { HouseRoom } from "../net/connection.js";
import type { SpatialAudio } from "./spatialAudio.js";
import type { HearMode, RoutedVoice, Vec3 } from "./VoiceProvider.js";

/** Public STUN server: lets peers discover their public address when not on the same network. */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
/** Longest we wait for ICE candidate gathering before sending what we have. Long enough for TURN relay addresses. */
const ICE_GATHER_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

interface Peer {
  pc: RTCPeerConnection;
  retries: number;
}

/**
 * Peer-to-peer voice: every housemate holds one direct WebRTC connection to
 * every other housemate (a "mesh"). Fine for up to ~8 people; beyond that each
 * browser uploads too many copies of its voice, which is why M9 moves to LiveKit.
 *
 * Setting up a connection ("signalling") needs a go-between to swap an offer
 * and an answer describing each side's audio and network addresses; that's the
 * Colyseus room. To avoid both sides offering at once, exactly one side offers:
 * `shouldOffer` decides (between housemates, the smaller session id; a
 * listen-only viewer always offers, since housemates don't know who's watching).
 *
 * ICE candidates (network addresses) are gathered first and sent inside the
 * offer/answer ("non-trickle"), so each link needs just two messages.
 */
export class MeshVoiceProvider implements RoutedVoice {
  private readonly peers = new Map<string, Peer>();
  private localTrack: MediaStreamTrack | null = null;
  private remoteStreamCb: ((id: string, stream: MediaStream) => void) | null = null;
  private muted = true;
  private active = false;
  /** Which peers currently get our mic (see setSendAllowed). Unknown = not yet allowed. */
  private readonly sendTo = new Map<string, boolean>();

  constructor(
    private readonly room: HouseRoom,
    private readonly audio: SpatialAudio,
    /** Whether we make the offer to peer `id` (the other side then only answers). */
    private readonly shouldOffer: (id: string) => boolean,
    /** From the server: STUN plus a TURN relay for networks where direct links fail. */
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {
    room.onMessage(Msg.voiceSignal, (relay: VoiceSignalRelay) => void this.handleSignal(relay));
    // A viewer who was listening to us has gone.
    room.onMessage(Msg.voicePeerLeft, ({ id }: VoicePeerLeft) => this.removePeer(id));
  }

  join(localStream: MediaStream | null): void {
    this.localTrack = localStream?.getAudioTracks()[0] ?? null;
    if (this.localTrack) this.localTrack.enabled = !this.muted;
    this.active = true;
  }

  leave(): void {
    this.active = false;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.localTrack?.stop();
    this.localTrack = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Disabling the track sends silence immediately, without renegotiating any connection.
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

  /** A voice-capable player is in the room (called for everyone already there, and newcomers). */
  addPeer(id: string): void {
    if (!this.active || id === this.room.sessionId || this.peers.has(id)) return;
    if (this.shouldOffer(id)) void this.connect(id);
    // Otherwise we wait for their offer.
  }

  removePeer(id: string): void {
    this.peers.get(id)?.pc.close();
    this.peers.delete(id);
    this.sendTo.delete(id);
    this.audio.detach(id);
  }

  /**
   * Whether peer `id` should receive our mic at all (e.g. not while one of us is
   * in the Diary Room). New links send nothing until this says yes. Swaps the track on that one connection — instant, no
   * renegotiation. Cheap to call every frame: only acts when the answer changes.
   */
  setSendAllowed(id: string, allowed: boolean): void {
    if (this.sendTo.get(id) === allowed) return;
    this.sendTo.set(id, allowed);
    void this.applySendTrack(id);
  }

  /** Ids of everyone we have a connection with. */
  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  setHearMode(id: string, mode: HearMode): void {
    this.audio.setMode(id, mode);
  }

  get spatial(): SpatialAudio {
    return this.audio;
  }

  private async applySendTrack(id: string): Promise<void> {
    const sender = this.peers.get(id)?.pc.getTransceivers()[0]?.sender;
    if (!sender) return;
    const track = this.sendTo.get(id) === true ? this.localTrack : null;
    if (sender.track !== track) await sender.replaceTrack(track).catch(() => {});
  }

  /** Dev tooling: connection state per peer. */
  debugStates(): Record<string, RTCPeerConnectionState> {
    return Object.fromEntries([...this.peers].map(([id, p]) => [id, p.pc.connectionState]));
  }

  private createPeer(id: string, retries = 0): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, retries };
    this.peers.set(id, peer);

    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.audio.attach(id, stream);
      this.remoteStreamCb?.(id, stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed" || this.peers.get(id) !== peer) return;
      // Retry from the offering side only, so both ends don't race.
      this.removePeer(id);
      if (this.shouldOffer(id) && peer.retries < MAX_RETRIES) {
        setTimeout(() => {
          if (this.active && !this.peers.has(id)) void this.connect(id, peer.retries + 1);
        }, RETRY_DELAY_MS);
      }
    };
    return peer;
  }

  /** Offering side. */
  private async connect(id: string, retries = 0): Promise<void> {
    const { pc } = this.createPeer(id, retries);
    // One audio channel in each direction; without a mic (or as a viewer) receive only.
    const transceiver = pc.addTransceiver("audio", { direction: this.localTrack ? "sendrecv" : "recvonly" });
    await transceiver.sender.replaceTrack(this.sendTo.get(id) === true ? this.localTrack : null);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    this.sendSignal(id, pc.localDescription);
  }

  private async handleSignal({ from, data }: VoiceSignalRelay): Promise<void> {
    if (!this.active) return;
    try {
      if (data.type === "offer") {
        // A fresh offer replaces any previous connection with this player (e.g. a retry).
        if (this.peers.has(from)) this.removePeer(from);
        const { pc } = this.createPeer(from);
        await pc.setRemoteDescription(data);
        const transceiver = pc.getTransceivers()[0];
        if (transceiver) {
          transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(this.sendTo.get(from) === true ? this.localTrack : null);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        await waitForIceGathering(pc);
        this.sendSignal(from, pc.localDescription);
      } else {
        const pc = this.peers.get(from)?.pc;
        if (pc?.signalingState === "have-local-offer") await pc.setRemoteDescription(data);
      }
    } catch (err) {
      console.warn(`[voice] signalling with ${from} failed`, err);
    }
  }

  private sendSignal(to: string, desc: RTCSessionDescription | null): void {
    if (!desc || (desc.type !== "offer" && desc.type !== "answer")) return;
    const data: VoiceSignalData = { type: desc.type, sdp: desc.sdp };
    const message: VoiceSignalMessage = { to, data };
    this.room.send(Msg.voiceSignal, message);
  }
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}
