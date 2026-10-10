import type * as THREE from "three";
import { moodOf, type PlayerView } from "@bbn/shared";
import { Avatar } from "../entities/avatar.js";
import type { VoiceIconState } from "../entities/voiceIcon.js";
import type { HouseRoom } from "../net/connection.js";
import { SnapshotBuffer } from "../net/interpolation.js";
import type { StateCallbacks } from "../net/stateCallbacks.js";
import type { RoutedVoice } from "../voice/VoiceProvider.js";

/** Height of a housemate's mouth/ears, for positioning voices. */
export const HEAD_HEIGHT = 1.65;

export interface RemotePlayer {
  avatar: Avatar;
  buffer: SnapshotBuffer;
  state: PlayerView;
  /** Jump counter last seen, to play their hop once per jump. */
  lastJump: number;
}

/**
 * Draws every housemate from server state: creates/removes avatars as players
 * come and go, interpolates their movement, and keeps their animation, voice
 * badge and voice position up to date. Used by both housemate mode (for
 * everyone except you) and spectator mode (for everyone).
 */
export class PlayersView {
  readonly remotes = new Map<string, RemotePlayer>();
  private readonly countListeners: Array<(n: number) => void> = [];

  constructor(
    scene: THREE.Scene,
    private readonly room: HouseRoom,
    $: StateCallbacks,
    private voice: RoutedVoice | null,
    /** Called instead of the normal handling for our own player (housemate mode only). */
    onLocal?: (player: PlayerView, avatar: Avatar) => void,
  ) {
    $.onAdd("players", (player, id) => {
      const avatar = new Avatar(player.name, player.color, player.look);
      avatar.root.position.set(player.x, 0, player.z);
      avatar.root.rotation.y = player.rotY;
      scene.add(avatar.root);

      if (id === room.sessionId && onLocal) {
        onLocal(player, avatar);
      } else {
        const remote: RemotePlayer = { avatar, buffer: new SnapshotBuffer(player), state: player, lastJump: player.jump ?? 0 };
        this.remotes.set(id, remote);
        $.onChange(player, () => remote.buffer.push(player));
        if (player.voice) voice?.addPeer(id);
      }
      this.emitCount();
    });

    $.onRemove("players", (_player, id) => {
      voice?.removePeer(id);
      this.remotes.get(id)?.avatar.dispose();
      this.remotes.delete(id);
      this.emitCount();
    });
  }

  /** Attach voice later (spectators learn whether they got an audio slot after joining). */
  setVoice(voice: RoutedVoice): void {
    this.voice = voice;
    for (const [id, { state }] of this.remotes) if (state.voice) voice.addPeer(id);
  }

  /** Called with the number of housemates whenever someone joins or leaves. */
  onCountChange(cb: (n: number) => void): void {
    this.countListeners.push(cb);
    cb(this.count());
  }

  avatarOf(id: string): Avatar | undefined {
    return this.remotes.get(id)?.avatar;
  }

  update(dt: number, now = performance.now()): void {
    for (const [id, remote] of this.remotes) {
      const { avatar, buffer, state } = remote;
      const pose = buffer.sample(now);
      if ((state.jump ?? 0) !== remote.lastJump) {
        remote.lastJump = state.jump ?? 0;
        avatar.hop();
      }
      this.voice?.setSourcePosition(id, { x: pose.x, y: HEAD_HEIGHT, z: pose.z });
      avatar.setVoiceState(state.voice ? voiceIconFor(state) : "none");
      avatar.setPerks(state.perks ? [...state.perks] : []);
      avatar.setCarrying(!!state.carrying);
      avatar.setMood(moodIcon(state.needs));
      const pos = avatar.root.position;
      const speed = dt > 0 ? Math.hypot(pose.x - pos.x, pose.z - pos.z) / dt : 0;
      pos.set(pose.x, 0, pose.z);
      avatar.root.rotation.y = pose.rotY;
      avatar.update(dt, speed, state.anim === "walk" || state.anim === "idle" ? undefined : state.anim);
    }
  }

  dispose(): void {
    for (const { avatar } of this.remotes.values()) avatar.dispose();
    this.remotes.clear();
  }

  /** The first state snapshot can arrive a moment after joining, so `players` may not exist yet. */
  private count(): number {
    return this.room.state.players?.size ?? 0;
  }

  private emitCount(): void {
    for (const cb of this.countListeners) cb(this.count());
  }
}

export function voiceIconFor(s: { speaking: boolean; muted: boolean; adminMuted?: boolean }): VoiceIconState {
  return s.muted || s.adminMuted ? "muted" : s.speaking ? "speaking" : "none";
}

/** Face shown after a housemate's name while one of their needs is low. */
export function moodIcon(needs: PlayerView["needs"]): string {
  if (!needs) return "";
  const mood = moodOf(needs);
  return mood.need && needs[mood.need] < 25 ? mood.icon : "";
}
