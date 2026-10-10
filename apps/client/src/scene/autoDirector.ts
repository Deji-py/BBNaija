import { areaAt, type AreaId } from "@bbn/shared";
import type { CameraMode } from "./spectatorCamera.js";

/** A shot holds at least this long, so the picture never flickers between rooms. */
const MIN_SHOT_MS = 7_000;
/** After this long, cut elsewhere if anything else is happening, to keep the stream lively. */
const MAX_SHOT_MS = 30_000;
/** A rival room must beat the current one by this much to steal the shot early. */
const CUT_MARGIN = 1.5;
/** Someone who chatted this recently counts as part of the action. */
const CHAT_RECENT_MS = 8_000;
/** A housemate in a viewer caption is the story for this long. */
const CAPTION_RECENT_MS = 20_000;

export interface DirectorInput {
  players: Iterable<{ id: string; x: number; z: number; speaking: boolean; activity: string }>;
  /** Housemate in a Diary Room session that viewers may watch (broadcast), if any. */
  diaryBroadcast: string | null;
  partyOn: boolean;
  /** Last house-chat time per housemate id. */
  lastChatAt: ReadonlyMap<string, number>;
  /** Last time each housemate was in a viewer caption. */
  lastCaptionAt: ReadonlyMap<string, number>;
}

/**
 * The default viewer camera: picks shots like a TV director. Each room scores
 * points for the housemates in it, more for anyone talking, chatting or in a
 * fresh caption, less for sleepers; the best room wins, filmed by its house camera, or by following the
 * housemate when they're alone there. Shots hold for a while (no flicker) and
 * move on after half a minute when something else is going on.
 */
export class AutoDirector {
  private shot: CameraMode | null = null;
  private shotAt = 0;

  reset(): void {
    this.shot = null;
  }

  /** The shot to cut to now, or null to stay on the current one. */
  next(now: number, input: DirectorInput): CameraMode | null {
    if (input.diaryBroadcast) return this.cut(now, { kind: "house", area: "diary" });

    const scores = new Map<AreaId, number>();
    const people = new Map<AreaId, string[]>();
    const where = new Map<string, AreaId>();
    for (const p of input.players) {
      const area = areaAt(p.x, p.z)?.id;
      if (!area) continue;
      const asleep = p.activity.startsWith("bed-");
      let score = asleep ? 0.3 : 1;
      if (p.speaking) score += 3;
      if (now - (input.lastChatAt.get(p.id) ?? -Infinity) < CHAT_RECENT_MS) score += 2;
      if (now - (input.lastCaptionAt.get(p.id) ?? -Infinity) < CAPTION_RECENT_MS) score += 4;
      if (area === "party" && input.partyOn) score += 2;
      scores.set(area, (scores.get(area) ?? 0) + score);
      people.set(area, [...(people.get(area) ?? []), p.id]);
      where.set(p.id, area);
    }

    const current = this.shot;
    const currentArea = current?.kind === "house" ? current.area : current?.kind === "follow" ? where.get(current.playerId) : undefined;
    const currentScore = currentArea ? (scores.get(currentArea) ?? 0) : 0;
    const ranked = [...scores].sort((a, b) => b[1] - a[1]);
    const elapsed = now - this.shotAt;

    const shotFor = (area: AreaId): CameraMode => {
      const here = people.get(area) ?? [];
      return here.length === 1 ? { kind: "follow", playerId: here[0]! } : { kind: "house", area };
    };

    // Nothing filmed yet, the followed housemate left, or the room emptied.
    if (!current || (current.kind === "follow" && !where.has(current.playerId)) || currentScore === 0) {
      return this.cut(now, ranked[0] ? shotFor(ranked[0][0]) : { kind: "house", area: "lounge" });
    }
    if (elapsed < MIN_SHOT_MS) return null;

    const best = ranked[0]!;
    if (best[0] !== currentArea && best[1] >= currentScore + CUT_MARGIN) return this.cut(now, shotFor(best[0]));
    if (elapsed >= MAX_SHOT_MS) {
      const elsewhere = ranked.find(([area]) => area !== currentArea);
      if (elsewhere) return this.cut(now, shotFor(elsewhere[0]));
    }
    // Same room, but its cast changed (someone joined a lone housemate, or the crowd thinned to one).
    if (currentArea && !sameShot(current, shotFor(currentArea))) return this.cut(now, shotFor(currentArea));
    return null;
  }

  private cut(now: number, shot: CameraMode): CameraMode | null {
    if (this.shot && sameShot(this.shot, shot)) return null;
    this.shot = shot;
    this.shotAt = now;
    return shot;
  }
}

function sameShot(a: CameraMode, b: CameraMode): boolean {
  if (a.kind === "house" && b.kind === "house") return a.area === b.area;
  if (a.kind === "follow" && b.kind === "follow") return a.playerId === b.playerId;
  return a.kind === b.kind;
}
