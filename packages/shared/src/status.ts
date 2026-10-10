import { AREAS } from "./house.js";
import { moodOf, type NeedValues } from "./needs.js";

const ACTIVITY_STATUS: Record<string, string> = {
  sleep: "Sleeping",
  sit: "Sitting down",
  cook: "Cooking",
  workout: "Working out",
  swim: "Swimming",
  dance: "Dancing",
  wave: "Waving",
  eat: "Eating",
  drink: "Having a drink",
  toilet: "In the bathroom",
  shower: "Showering",
  bath: "Having a bath",
  wash: "Freshening up",
  laundry: "Doing laundry",
  sitFloor: "Sitting on the floor",
  lieDown: "Lying down",
};

/**
 * One-line status for a housemate, e.g. "Sleeping", "In the Diary Room" or
 * "Awake · Kitchen" — with their mood when a need is running low ("· 😫 Hungry").
 */
export function housemateStatus(p: { anim: string; area: string; exiting?: boolean; needs?: NeedValues }): string {
  if (p.exiting) return "Leaving the house";
  if (p.area === "diary") return "In the Diary Room";
  const doing = ACTIVITY_STATUS[p.anim] ?? `Awake · ${AREAS.find((a) => a.id === p.area)?.label ?? "Outside"}`;
  if (!p.needs) return doing;
  const mood = moodOf(p.needs);
  return mood.need || mood.label === "Happy" ? `${doing} · ${mood.icon} ${mood.label}` : doing;
}
