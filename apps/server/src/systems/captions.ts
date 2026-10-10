import { AREAS, type CaptionMessage } from "@bbn/shared";
import type { HouseState, Player } from "../schema/HouseState.js";

/** Captions kept for viewers who join later. */
const KEEP = 30;
/** Two housemates alone in a room this long is worth telling viewers about. */
const ALONE_MS = 150_000;
/** Within this distance (same room, nobody else that close) counts as "together". */
const TOGETHER_RANGE = 3;
/** A nomination is pointed out as ironic if the pair were together this recently. */
const IRONY_WINDOW_MS = 10 * 60_000;
/** At most one "what they said about someone" caption this often. */
const MENTION_GAP_MS = 20_000;
const QUOTE_MAX = 90;

export interface CaptionHooks {
  /** Deliver to viewers only. Housemates must never get these. */
  send(caption: CaptionMessage): void;
}

export interface BallotReveal {
  by: { sessionId?: string; name: string };
  picks: { sessionId?: string; name: string }[];
}

/**
 * Live captions for viewers: what the house doesn't know. Ballots once
 * nominations close (with a nudge when the pair were close minutes before),
 * two housemates alone together, and Diary Room lines about another housemate.
 */
export class Captions {
  private readonly list: CaptionMessage[] = [];
  private nextId = 1;
  /** Pair key → when and where the two were last close together. */
  private readonly together = new Map<string, { at: number; area: string }>();
  /** Area id → the only two housemates in it, since when, and whether viewers were told. */
  private readonly alone = new Map<string, { pair: string; since: number; told: boolean }>();
  private lastMentionAt = 0;

  constructor(
    private readonly state: HouseState,
    private readonly hooks: CaptionHooks,
  ) {}

  recent(): CaptionMessage[] {
    return [...this.list];
  }

  add(icon: string, text: string, focus: string[] = [], now = Date.now()): void {
    const caption: CaptionMessage = { id: this.nextId++, icon, text, at: now, focus };
    this.list.push(caption);
    if (this.list.length > KEEP) this.list.shift();
    this.hooks.send(caption);
  }

  /** Called once a second. */
  tick(now = Date.now()): void {
    const players = [...this.state.players.values()].filter((p) => !p.exiting && p.area && p.area !== "diary");
    const near = (a: Player, b: Player) => a.area === b.area && Math.hypot(a.x - b.x, a.z - b.z) <= TOGETHER_RANGE;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]!;
        const b = players[j]!;
        // One-on-one only: a group hanging out together isn't a story.
        if (near(a, b) && !players.some((c) => c !== a && c !== b && (near(c, a) || near(c, b)))) {
          this.together.set(pairKey(a.id, b.id), { at: now, area: a.area });
        }
      }
    }

    const byArea = new Map<string, Player[]>();
    for (const p of players) byArea.set(p.area, [...(byArea.get(p.area) ?? []), p]);
    for (const [area, entry] of this.alone) {
      const here = byArea.get(area);
      if (here?.length !== 2 || pairKey(here[0]!.id, here[1]!.id) !== entry.pair) this.alone.delete(area);
    }
    for (const [area, here] of byArea) {
      if (here.length !== 2) continue;
      const [a, b] = here as [Player, Player];
      const entry = this.alone.get(area);
      if (!entry) {
        this.alone.set(area, { pair: pairKey(a.id, b.id), since: now, told: false });
      } else if (!entry.told && now - entry.since >= ALONE_MS) {
        entry.told = true;
        this.add("👀", `${a.name} and ${b.name} have been alone in the ${areaLabel(area)} for a while`, [a.id, b.id], now);
      }
    }
  }

  /** Nominations closed: viewers learn who nominated whom. */
  revealBallots(ballots: BallotReveal[], now = Date.now()): void {
    for (const { by, picks } of ballots) {
      let text = `${by.name} nominated ${joinNames(picks.map((p) => p.name))}`;
      for (const pick of picks) {
        const met = by.sessionId && pick.sessionId ? this.together.get(pairKey(by.sessionId, pick.sessionId)) : undefined;
        if (met && now - met.at <= IRONY_WINDOW_MS) {
          const who = picks.length === 1 ? "they were together" : `and was with ${pick.name}`;
          text += ` — ${who} in the ${areaLabel(met.area)} ${ago(now - met.at)}`;
          break;
        }
      }
      const focus = [by.sessionId, ...picks.map((p) => p.sessionId)].filter((id): id is string => !!id);
      this.add("🗳️", text, focus, now);
    }
  }

  /** A housemate's line in a broadcast Diary Room session; captioned if it names someone else in the house. */
  diaryLine(player: Player, text: string, now = Date.now()): void {
    if (now - this.lastMentionAt < MENTION_GAP_MS) return;
    const other = [...this.state.players.values()].find(
      (p) => p.id !== player.id && p.name.length >= 3 && new RegExp(`\\b${escapeRegExp(p.name)}\\b`, "i").test(text),
    );
    if (!other) return;
    this.lastMentionAt = now;
    const quote = text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text;
    this.add("💬", `${player.name} on ${other.name}: “${quote}”`, [player.id, other.id], now);
  }

  forget(sessionId: string): void {
    for (const key of this.together.keys()) if (key.split("|").includes(sessionId)) this.together.delete(key);
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function areaLabel(id: string): string {
  return (AREAS.find((a) => a.id === id)?.label ?? id).toLowerCase();
}

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "moments ago" : minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
