import { areaAt } from "@bbn/shared";

export const DJ = { id: "dj", name: "DJ Ninja", color: "#ff2fd6" } as const;

/** Between shout-outs while the party's on. */
const SHOUT_MIN_MS = 50_000;
const SHOUT_MAX_MS = 80_000;

const HYPE = [
  "Make some noise for {name}! 🔥",
  "{name}, show us your moves! 💃",
  "Na {name} dey run this dance floor o! 🕺",
  "Everybody hands up for {name}! 🙌",
  "{name} don catch the vibe! 🎶",
  "Who taught {name} to dance like that? 😮‍💨",
];
const EMPTY_FLOOR = ["Party room dey wait for una o! Come dance 🎧", "Dance floor is lonely… who's coming? 👀"];

/** The party room's resident DJ: talks in house chat while the party's on. The music itself is client-side. */
export class PartyDj {
  private nextShoutAt = 0;
  private lastLine = "";

  constructor(private readonly say: (text: string) => void) {}

  start(starter: string, now = Date.now()): void {
    this.say(`DJ Ninja in the building! ${starter} started the party, let's gooo 🎧🔥`);
    this.nextShoutAt = now + SHOUT_MIN_MS;
  }

  stop(): void {
    this.say("DJ Ninja signing off. Una too much! ✌️");
  }

  /** Call about once a second while the party's on. */
  tick(players: Iterable<{ name: string; x: number; z: number }>, now = Date.now()): void {
    if (now < this.nextShoutAt) return;
    this.nextShoutAt = now + SHOUT_MIN_MS + Math.random() * (SHOUT_MAX_MS - SHOUT_MIN_MS);
    const dancers = [...players].filter((p) => areaAt(p.x, p.z)?.id === "party");
    const template = pick((dancers.length > 0 ? HYPE : EMPTY_FLOOR).filter((l) => l !== this.lastLine));
    this.lastLine = template;
    this.say(dancers.length > 0 ? template.replace("{name}", pick(dancers).name) : template);
  }
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}
