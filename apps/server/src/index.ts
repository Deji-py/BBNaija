import { createEndpoint, createRouter, defineRoom, defineServer } from "colyseus";
import { HOUSE_ROOM, SERVER_PORT, type HealthResponse } from "@bbn/shared";
import { HouseRoom } from "./rooms/HouseRoom.js";

const port = Number(process.env.GAME_SERVER_PORT ?? SERVER_PORT);
const startedAt = Date.now();

// Small HTTP endpoints. Colyseus serves these on the same port as the
// WebSocket game connection.
const routes = createRouter({
  health: createEndpoint("/health", { method: "GET" }, async (ctx) => {
    const body: HealthResponse = {
      ok: true,
      name: "big-brother-ninja",
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
    return ctx.json(body);
  }),
});

const gameServer = defineServer({
  rooms: {
    [HOUSE_ROOM]: defineRoom(HouseRoom),
  },
  routes,
});

await gameServer.listen(port);
console.log(`[server] listening on ${port}`);
