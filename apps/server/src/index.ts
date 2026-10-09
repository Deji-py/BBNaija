import { defineRoom, defineServer } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HOUSE_ROOM, SERVER_PORT } from "@bbn/shared";
import { HouseRoom } from "./rooms/HouseRoom.js";
import { routes } from "./http/routes.js";
import { eventLog } from "./systems/eventLog.js";

const port = Number(process.env.GAME_SERVER_PORT ?? SERVER_PORT);

await eventLog.load();

const gameServer = defineServer({
  // Passed explicitly: Prisma's generated client sets a global `__dirname`, which makes
  // Colyseus think it's running as CommonJS and fail to auto-load its default transport.
  transport: new WebSocketTransport(),
  rooms: {
    [HOUSE_ROOM]: defineRoom(HouseRoom),
  },
  routes,
});

await gameServer.listen(port);
console.log(`[server] listening on ${port}`);
