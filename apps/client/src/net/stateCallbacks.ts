import { Callbacks } from "@colyseus/sdk";
import type { PlayerView } from "@bbn/shared";
import type { HouseRoom } from "./connection.js";

/**
 * The slice of the Colyseus callbacks API we use, typed against our shared
 * view types (the client decodes state by reflection and has no schema classes).
 */
export interface StateCallbacks {
  onAdd(collection: "players", cb: (player: PlayerView, id: string) => void): () => void;
  onRemove(collection: "players", cb: (player: PlayerView, id: string) => void): () => void;
  onChange(instance: PlayerView, cb: () => void): () => void;
  listen(property: "tvOn", cb: (value: boolean) => void): () => void;
  listen(property: "tvChannel", cb: (value: string) => void): () => void;
  listen(property: "tvMovie", cb: (value: string) => void): () => void;
  listen(property: "theaterOn", cb: (value: boolean) => void): () => void;
  listen(property: "tvStation", cb: (value: string) => void): () => void;
  listen(property: "openDoors", cb: (value: string) => void): () => void;
  listen(property: "viewerCount", cb: (value: number) => void): () => void;
}

export function getStateCallbacks(room: HouseRoom): StateCallbacks {
  return Callbacks.get(room as never) as unknown as StateCallbacks;
}
