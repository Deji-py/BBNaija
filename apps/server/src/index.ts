import { createEndpoint, createRouter, defineServer } from "colyseus";
import { SERVER_PORT, type HealthResponse } from "@bbn/shared";

const port = Number(process.env.PORT ?? SERVER_PORT);
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
  // Rooms are registered here from M2 onwards (e.g. { [HOUSE_ROOM]: defineRoom(HouseRoom) }).
  rooms: {},
  routes,
});

await gameServer.listen(port);
console.log(`[server] listening on ${port}`);
