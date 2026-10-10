import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Synced state. Colyseus tracks every assignment to these objects and sends
 * only the changed fields (a "delta patch") to clients each patch interval.
 * Keep it in step with `PlayerView` / `HouseStateView` in @bbn/shared.
 */
/** A housemate's needs, 0–100 each (see @bbn/shared needs.ts). Whole numbers, so patches only go out when one ticks over. */
export const Needs = schema(
  {
    hunger: t.uint8(),
    energy: t.uint8(),
    hygiene: t.uint8(),
    bladder: t.uint8(),
    fun: t.uint8(),
    social: t.uint8(),
    laundry: t.uint8(),
  },
  "Needs",
);
export type Needs = SchemaType<typeof Needs>;

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
    exiting: t.boolean(),
    /** Id of the prop this housemate is carrying ("" = hands free). */
    carrying: t.string(),
    /** Character look from the creator (see @bbn/shared look.ts). */
    look: t.string(),
    needs: Needs,
    /** Counts up on every jump so clients can play the hop. */
    jump: t.uint8(),
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

export const Nominee = schema(
  {
    token: t.string(),
    playerId: t.string(),
    name: t.string(),
    color: t.string(),
    /** -1 until Big Brother reveals the result. */
    votes: t.float32(),
  },
  "Nominee",
);
export type Nominee = SchemaType<typeof Nominee>;

export const Round = schema(
  {
    phase: t.string(),
    round: t.uint16(),
    kind: t.string(),
    voteEndsAt: t.float64(),
    votingOpen: t.boolean(),
    nominees: t.array(Nominee),
    evictedName: t.string(),
    winnerName: t.string(),
    winnerColor: t.string(),
  },
  "Round",
);
export type Round = SchemaType<typeof Round>;

/** A light object anyone can pick up and put down (see packages/shared/src/props.ts). */
export const Prop = schema(
  {
    x: t.float32(),
    z: t.float32(),
    /** Height of what it stands on: 0 = floor, otherwise a table/counter top. */
    y: t.float32(),
    rotY: t.float32(),
    /** Session id of whoever is carrying it ("" = nobody). */
    heldBy: t.string(),
  },
  "Prop",
);
export type Prop = SchemaType<typeof Prop>;

export const HouseState = schema(
  {
    players: t.map(Player),
    tvOn: t.boolean(),
    tvChannel: t.string(),
    tvMovie: t.string(),
    theaterOn: t.boolean(),
    tvStation: t.string(),
    /** Space-separated ids of doors that are open. Empty means every door is shut. */
    openDoors: t.string(),
    /** Every movable prop, by id. */
    props: t.map(Prop),
    /** Busy game stations: station id → "waiting" or "playing" (absent = free). */
    stations: t.map("string"),
    /** Space-separated ids of rooms whose lights are off. */
    lightsOff: t.string(),
    /** House clock, minutes since midnight. */
    dayMinutes: t.float32(),
    /** Party mode in the party room. */
    partyOn: t.boolean(),
    viewerCount: t.uint16(),
    bigBrotherId: t.string(),
    bigBrotherSpeaking: t.boolean(),
    diaryHousemate: t.string(),
    diaryBroadcast: t.boolean(),
    task: Task,
    serverTime: t.float64(),
    round: Round,
  },
  "HouseState",
);
export type HouseState = SchemaType<typeof HouseState>;
