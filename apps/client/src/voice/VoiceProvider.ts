export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Voice chat abstraction. The MVP implementation is a WebRTC peer-to-peer mesh
 * (MeshVoiceProvider); M9 swaps in LiveKit behind this same interface so the
 * rest of the game doesn't change.
 */
export interface VoiceProvider {
  /** Start voice for the local player. `localStream` is null when listening only (no mic). */
  join(localStream: MediaStream | null): void;
  leave(): void;
  /** Whether our mic audio is sent. Takes effect instantly (no renegotiation). */
  setMuted(muted: boolean): void;
  /** Called when a remote player's audio arrives. */
  onRemoteStream(cb: (playerId: string, stream: MediaStream) => void): void;
  /** Where we hear from: position, and facing as a yaw angle (follow-camera convention, see SpatialAudio.setListener). */
  setListenerPosition(pos: Vec3, yaw: number): void;
  /** Where a remote player's voice comes from. */
  setSourcePosition(playerId: string, pos: Vec3): void;
}
