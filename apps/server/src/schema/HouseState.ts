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
    adminMuted: t.boolean(),
    perks: t.array("string"),
    cookStage: t.uint8(),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Gem = schema(
  {
    id: t.string(),
    x: t.float32(),
    z: t.float32(),
    found: t.boolean(),
  },
  "Gem",
);
export type Gem = SchemaType<typeof Gem>;

export const Quiz = schema(
  {
    number: t.uint8(),
    total: t.uint8(),
    question: t.string(),
    options: t.array("string"),
    endsAt: t.float64(),
    revealed: t.boolean(),
    correct: t.int8(),
  },
  "Quiz",
);
export type Quiz = SchemaType<typeof Quiz>;

export const Task = schema(
  {
    type: t.string(),
    title: t.string(),
    description: t.string(),
    reward: t.string(),
    status: t.string(),
    endsAt: t.float64(),
    scores: t.map("number"),
    winners: t.array("string"),
    gems: t.array(Gem),
    quiz: Quiz,
  },
  "Task",
);
export type Task = SchemaType<typeof Task>;

export const HouseState = schema(
  {
    players: t.map(Player),
    tvOn: t.boolean(),
    viewerCount: t.uint16(),
    bigBrotherId: t.string(),
    bigBrotherSpeaking: t.boolean(),
    diaryHousemate: t.string(),
    diaryBroadcast: t.boolean(),
    task: Task,
    serverTime: t.float64(),
  },
  "HouseState",
);
export type HouseState = SchemaType<typeof HouseState>;
