import { Client, type Room } from "@colyseus/sdk";
import { HOUSE_ROOM, type HouseStateView, type JoinOptions } from "@bbn/shared";
import { SERVER_HTTP_URL } from "../config.js";

export type HouseRoom = Room<any, HouseStateView>;

export async function joinHouse(options: JoinOptions): Promise<HouseRoom> {
  const client = new Client(SERVER_HTTP_URL);
  return client.joinOrCreate<HouseStateView>(HOUSE_ROOM, options);
}
