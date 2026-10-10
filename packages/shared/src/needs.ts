import type { Activity } from "./interactions.js";

/**
 * Housemate needs, like real life in the house: everyone gets hungry, tired,
 * smelly, needs the loo, gets bored or lonely, and runs out of clean clothes.
 * Each need runs 0–100 (100 = fully satisfied), drains over time, and is
 * refilled by doing the right thing in the house. The server owns the numbers;
 * everyone (viewers too) sees them and the mood they add up to.
 */

export const NEEDS = ["hunger", "energy", "hygiene", "bladder", "fun", "social", "laundry"] as const;
export type Need = (typeof NEEDS)[number];
export type NeedValues = Record<Need, number>;

export const NEED_INFO: Readonly<Record<Need, { label: string; icon: string; low: string; lowIcon: string; fix: string }>> = {
  hunger: { label: "Hunger", icon: "🍲", low: "Hungry", lowIcon: "😫", fix: "Cook at the stove, or sit down and eat at the dining table" },
  energy: { label: "Energy", icon: "⚡", low: "Exhausted", lowIcon: "😴", fix: "Sleep in a bed (or rest on the sofa)" },
  hygiene: { label: "Hygiene", icon: "🧼", low: "Smelly", lowIcon: "🤢", fix: "Shower or have a bath in the bathroom" },
  bladder: { label: "Bladder", icon: "🚽", low: "Needs the loo", lowIcon: "😬", fix: "Use the toilet in the bathroom" },
  fun: { label: "Fun", icon: "🎉", low: "Bored", lowIcon: "😑", fix: "Play in the games hall, swim, dance or watch TV" },
  social: { label: "Social", icon: "💬", low: "Lonely", lowIcon: "😔", fix: "Chat, play a game together, or hang out near people" },
  laundry: { label: "Clean clothes", icon: "👕", low: "Dirty clothes", lowIcon: "🧺", fix: "Do your laundry at the washing machines in the bathroom" },
};

/** How much each need drops per minute of real time. */
export const NEED_DECAY_PER_MINUTE: Readonly<NeedValues> = {
  hunger: 1.5,
  energy: 1,
  hygiene: 1.2,
  bladder: 2,
  fun: 1.8,
  social: 1.5,
  laundry: 0.7,
};

export const NEED_START = 80;

type Effects = Partial<NeedValues>;

/** Per-second change while doing an activity (on top of the usual drain). Negative = makes it worse. */
export const ACTIVITY_EFFECTS: Readonly<Partial<Record<Activity, Effects>>> = {
  sleep: { energy: 2.5 },
  sit: { energy: 0.5 },
  eat: { hunger: 3, bladder: -0.4, social: 0.2 },
  cook: { hunger: 1.2, fun: 0.3 },
  drink: { hunger: 0.8, fun: 0.4, bladder: -1.2 },
  toilet: { bladder: 6 },
  shower: { hygiene: 4 },
  bath: { hygiene: 2.5, fun: 0.6, energy: 0.6 },
  wash: { hygiene: 1.2 },
  laundry: { laundry: 4 },
  swim: { fun: 1.2, hygiene: 0.4, energy: -0.4 },
  workout: { fun: 0.6, energy: -0.6, hygiene: -0.8 },
};

/** Other things that change needs, per second unless noted. */
export const OTHER_EFFECTS = {
  dance: { fun: 1, energy: -0.2 } as Effects,
  /** Seated at a game in the games hall. */
  playing: { fun: 1, social: 0.4 } as Effects,
  /** Another housemate within NEAR_DISTANCE. */
  company: { social: 0.4 } as Effects,
  /** In the lounge while the TV is on. */
  tv: { fun: 0.3 } as Effects,
  /** Running (Shift). */
  running: { energy: -0.8, hygiene: -0.2 } as Effects,
  /** In the party room while the party's on. */
  party: { fun: 0.8, social: 0.4, energy: -0.2 } as Effects,
  /** Once per chat message sent. */
  chat: { social: 5 } as Effects,
};
export const NEAR_DISTANCE = 3;

export interface Mood {
  label: string;
  icon: string;
  /** The need behind it, when one is low. */
  need?: Need;
}

/** One-line mood from the needs: the most urgent low need, "Stressed" when several are low, or how well things are going. */
export function moodOf(needs: NeedValues): Mood {
  const sorted = [...NEEDS].sort((a, b) => needs[a] - needs[b]);
  const worst = sorted[0]!;
  const low = NEEDS.filter((n) => needs[n] < 25);
  if (low.length >= 3) return { label: "Stressed", icon: "😣", need: worst };
  if (needs[worst] < 25) return { label: NEED_INFO[worst].low, icon: NEED_INFO[worst].lowIcon, need: worst };
  const average = NEEDS.reduce((sum, n) => sum + needs[n], 0) / NEEDS.length;
  if (average >= 75) return { label: "Happy", icon: "😄" };
  if (needs[worst] < 45) return { label: `A bit ${NEED_INFO[worst].low.toLowerCase()}`, icon: "🙂", need: worst };
  return { label: "Fine", icon: "🙂" };
}

export function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}
