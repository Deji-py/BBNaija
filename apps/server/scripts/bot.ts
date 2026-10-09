/**
 * Dev helper: joins the house with N bots that wander around, so you can test
 * multiplayer from a single browser window.
 *
 *   pnpm bots        # 2 bots
 *   pnpm bots 5      # 5 bots
 */
import { Client } from "@colyseus/sdk";
import { AVATAR_COLORS, HOUSE_ROOM, INPUT_STEP_SEC, MAX_HOUSEMATES, SERVER_PORT, Msg, type InputMessage } from "@bbn/shared";

const count = Math.min(Number(process.argv[2] ?? 2) || 2, MAX_HOUSEMATES);
const url = process.env.SERVER_URL ?? `http://localhost:${SERVER_PORT}`;

for (let i = 0; i < count; i++) {
  const client = new Client(url);
  const room = await client.joinOrCreate(HOUSE_ROOM, {
    name: `Bot ${i + 1}`,
    color: AVATAR_COLORS[(i + 3) % AVATAR_COLORS.length],
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
