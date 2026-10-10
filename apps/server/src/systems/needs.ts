import {
  ACTIVITY_EFFECTS,
  INTERACTABLE_BY_ID,
  NEAR_DISTANCE,
  NEEDS,
  NEED_DECAY_PER_MINUTE,
  NEED_START,
  OTHER_EFFECTS,
  clampNeed,
  type NeedValues,
} from "@bbn/shared";
import { Needs, type HouseState, type Player } from "../schema/HouseState.js";

export interface NeedsDeps {
  state: HouseState;
  /** Seated at a game in the games hall. */
  isPlaying: (sessionId: string) => boolean;
  /** Ran (Shift) in the last second. */
  isRunning: (sessionId: string) => boolean;
  /** Private message to one housemate (e.g. when they couldn't hold it any longer). */
  notify: (sessionId: string, text: string) => void;
}

/**
 * Drains every housemate's needs over time and refills them from what they're
 * doing (eating, sleeping, showering, playing…). Exact values are kept here as
 * floats; the synced state gets whole numbers so it only changes once a point is gained or lost.
 * Needs survive a reconnect (per account) for as long as the house is open.
 */
export class NeedsSystem {
  private readonly values = new Map<string, NeedValues>();
  private readonly byUser = new Map<string, NeedValues>();

  constructor(private readonly deps: NeedsDeps) {}

  join(player: Player, userId?: string): void {
    const start = (userId && this.byUser.get(userId)) || (Object.fromEntries(NEEDS.map((n) => [n, NEED_START])) as NeedValues);
    this.values.set(player.id, { ...start });
    player.needs = new Needs();
    this.write(player);
  }

  leave(sessionId: string, userId?: string): void {
    const v = this.values.get(sessionId);
    if (v && userId) this.byUser.set(userId, v);
    this.values.delete(sessionId);
  }

  /** A housemate sent a chat message. */
  onChat(sessionId: string): void {
    this.apply(sessionId, OTHER_EFFECTS.chat, 1);
  }

  /** Called once a second. */
  tick(dt = 1): void {
    const players = [...this.deps.state.players.values()];
    for (const player of players) {
      const v = this.values.get(player.id);
      if (!v) continue;
      for (const need of NEEDS) v[need] -= (NEED_DECAY_PER_MINUTE[need] / 60) * dt;

      const it = player.activity ? INTERACTABLE_BY_ID.get(player.activity) : undefined;
      const activity = it && (it.kind === "slots" || it.kind === "pool") ? it.activity : undefined;
      if (activity) this.apply(player.id, ACTIVITY_EFFECTS[activity] ?? {}, dt);
      if (player.anim === "dance") this.apply(player.id, OTHER_EFFECTS.dance, dt);
      if (this.deps.isPlaying(player.id)) this.apply(player.id, OTHER_EFFECTS.playing, dt);
      if (players.some((o) => o !== player && Math.hypot(o.x - player.x, o.z - player.z) <= NEAR_DISTANCE)) this.apply(player.id, OTHER_EFFECTS.company, dt);
      if (this.deps.state.tvOn && player.area === "lounge") this.apply(player.id, OTHER_EFFECTS.tv, dt);
      if (this.deps.isRunning(player.id)) this.apply(player.id, OTHER_EFFECTS.running, dt);
      if (this.deps.state.partyOn && player.area === "party") this.apply(player.id, OTHER_EFFECTS.party, dt);

      for (const need of NEEDS) v[need] = clampNeed(v[need]);
      // Leave the loo too long and there's an accident: straight to the shower.
      if (v.bladder <= 0 && activity !== "toilet") {
        v.bladder = 60;
        v.hygiene = clampNeed(v.hygiene - 50);
        this.deps.notify(player.id, "Oops… you couldn't hold it any longer. You'll want a shower!");
      }
      this.write(player);
    }
  }

  private apply(sessionId: string, effects: Partial<NeedValues>, dt: number): void {
    const v = this.values.get(sessionId);
    if (!v) return;
    for (const [need, perSecond] of Object.entries(effects) as Array<[keyof NeedValues, number]>) v[need] = clampNeed(v[need] + perSecond * dt);
  }

  private write(player: Player): void {
    const v = this.values.get(player.id);
    const synced = player.needs;
    if (!v || !synced) return;
    for (const need of NEEDS) {
      const whole = Math.round(v[need]);
      if (synced[need] !== whole) synced[need] = whole;
    }
  }
}
