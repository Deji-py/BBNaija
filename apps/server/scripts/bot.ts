/**
 * Dev helper: joins the house with N bots that wander around, so you can test
 * multiplayer from a single browser window.
 *
 *   pnpm bots              # 2 bots into the first live house
 *   pnpm bots 5            # 5 bots
 *   pnpm bots 3 <seasonId> # into a specific house
 */
import { readFileSync } from "node:fs";
import { Client } from "@colyseus/sdk";
import {
  encodeLook,
  randomLook,
  AVATAR_COLORS,
  HOUSE_ROOM,
  INPUT_STEP_SEC,
  MAX_HOUSEMATES,
  SERVER_PORT,
  Msg,
  type HousesResponse,
  type InputMessage,
} from "@bbn/shared";

// The game server reads ADMIN_SECRET from apps/server/.env. Load the same file
// so `pnpm bots` is admitted with that secret (development only).
try {
  const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]!]) continue;
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]!] = value;
  }
} catch {
  // No .env: the development default secret is used below.
}

const count = Math.min(Number(process.argv[2] ?? 2) || 2, MAX_HOUSEMATES);
const url = process.env.SERVER_URL ?? `http://localhost:${SERVER_PORT}`;

// Which house: the one given on the command line, or the first live one.
let seasonId = process.argv[3];
if (!seasonId) {
  const houses = (await (await fetch(`${url}/api/houses`)).json()) as HousesResponse;
  seasonId = houses.live[0]?.seasonId;
  if (!seasonId) {
    console.error("No live house to join. Set a season to Live in the console (/bigbrother) first.");
    process.exit(1);
  }
  console.log(`Joining ${houses.live[0]!.season.name}`);
}

for (let i = 0; i < count; i++) {
  const client = new Client(url);
  const room = await client.joinOrCreate(HOUSE_ROOM, {
    // Bots are test housemates: in development the admin secret admits them without an account.
    adminSecret: process.env.ADMIN_SECRET ?? "bigbrother",
    seasonId,
    name: `Bot ${i + 1}`,
    color: AVATAR_COLORS[(i + 3) % AVATAR_COLORS.length],
    look: encodeLook(randomLook()),
  });
  console.log(`Bot ${i + 1} joined as ${room.sessionId}`);

  let seq = 0;
  let dx = 0;
  let dz = 0;
  let stepsLeft = 0;
  let checkpoint = { x: NaN, z: NaN };
  let tick = 0;
  setInterval(() => {
    // Every 0.5 s, compare our authoritative position with the last checkpoint.
    // If a wall stopped us, pick a new heading.
    let stuck = false;
    if (++tick % 10 === 0) {
      const me = room.state.players?.get(room.sessionId) as { x: number; z: number } | undefined;
      if (me) {
        stuck = dx !== 0 && Math.hypot(me.x - checkpoint.x, me.z - checkpoint.z) < 0.5;
        checkpoint = { x: me.x, z: me.z };
      }
    }
    if (stepsLeft-- <= 0 || stuck) {
      // Pick a new random heading (or stand still for a bit) every 1–3 s.
      const idle = Math.random() < 0.25;
      const angle = Math.random() * Math.PI * 2;
      dx = idle ? 0 : Math.sin(angle);
      dz = idle ? 0 : Math.cos(angle);
      stepsLeft = Math.round((1 + Math.random() * 2) / INPUT_STEP_SEC);
    }
    if (dx === 0 && dz === 0) return;
    const input: InputMessage = { seq: ++seq, dx, dz };
    room.send(Msg.input, input);
  }, INPUT_STEP_SEC * 1000);

  room.onLeave((code) => {
    console.log(`Bot ${i + 1} left (code ${code})`);
    process.exit(0);
  });
}

console.log(`${count} bot(s) wandering. Ctrl+C to stop.`);
