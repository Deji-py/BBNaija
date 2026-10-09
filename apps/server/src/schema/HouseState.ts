import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Synced state. Colyseus tracks every assignment to these objects and sends
 * only the changed fields (a "delta patch") to clients each patch interval.
 * Keep it in step with `PlayerView` / `HouseStateView` in @bbn/shared.
 */
export const Player = schema(
  {
    id: t.string(),
    name: t.string(),
    color: t.string(),
    x: t.float32(),
    z: t.float32(),
    rotY: t.float32(),
    anim: t.string(),
    area: t.string(),
    lastSeq: t.uint32(),
    voice: t.boolean(),
    speaking: t.boolean(),
    muted: t.boolean(),
    activity: t.string(),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const HouseState = schema(
  {
    players: t.map(Player),
    tvOn: t.boolean(),
    viewerCount: t.uint16(),
  },
  "HouseState",
);
export type HouseState = SchemaType<typeof HouseState>;
