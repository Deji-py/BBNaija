import { defineRoom, defineServer } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HOUSE_ROOM, SERVER_PORT } from "@bbn/shared";
import { HouseRoom } from "./rooms/HouseRoom.js";
import { mountClientRoutes } from "./http/client.js";
import { mountMovieRoutes } from "./http/movies.js";
import { mountRadioRoutes } from "./http/radio.js";
import { routes } from "./http/routes.js";
import { isProduction } from "./config.js";
import { eventLog } from "./systems/eventLog.js";
import { livekitConfigured } from "./voice/livekit.js";
import { turnConfigured } from "./voice/turn.js";

const port = Number(process.env.GAME_SERVER_PORT ?? process.env.PORT ?? SERVER_PORT);

await eventLog.load();

const gameServer = defineServer({
  // Passed explicitly: Prisma's generated client sets a global `__dirname`, which makes
  // Colyseus think it's running as CommonJS and fail to auto-load its default transport.
  transport: new WebSocketTransport(),
  // Video uploads are too large for the JSON matchmaking routes, so they land on Express.
  express: (app) => {
    mountMovieRoutes(app);
    mountRadioRoutes(app);
    if (isProduction) mountClientRoutes(app);
  },
  rooms: {
    // One house room per season: joins with the same seasonId share a room.
    [HOUSE_ROOM]: defineRoom(HouseRoom).filterBy(["seasonId"]),
  },
  routes,
});

await gameServer.listen(port);
console.log(`[server] listening on ${port}`);
console.log(
  `[voice] ${livekitConfigured() ? "LiveKit" : turnConfigured() ? "peer-to-peer mesh with Cloudflare TURN relay" : "peer-to-peer mesh, STUN only (no relay: strict networks can't connect)"}`,
);
