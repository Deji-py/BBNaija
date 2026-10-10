import type { GameId } from "../gameStations.js";
import { airhockey, darts, pong, tron } from "./arcade.js";
import { blackjack, whot } from "./cards.js";
import { checkers, go, morris } from "./classic.js";
import { chess } from "./chess.js";
import { pool, snooker } from "./cue.js";
import { ayo, ludo, pig, snakes, yacht } from "./family.js";
import { connect4, dots, gomoku, hex, reversi, tictactoe, ultimate } from "./grid.js";
import { battleship, codebreaker, hangman, memory, rps, trivia } from "./party.js";
import type { GameDef } from "./types.js";

export * from "./types.js";
export * from "./arcade.js";
export * from "./cards.js";
export * from "./classic.js";
export * from "./chess.js";
export * from "./cue.js";
export * from "./family.js";
export * from "./grid.js";
export * from "./party.js";

/** Every game in the hall, by id. */
export const GAMES: Readonly<Record<GameId, GameDef>> = {
  chess,
  checkers,
  ayo,
  whot,
  ludo,
  snakes,
  connect4,
  reversi,
  tictactoe,
  ultimate,
  gomoku,
  dots,
  battleship,
  morris,
  hex,
  go,
  yacht,
  pig,
  blackjack,
  pong,
  tron,
  trivia,
  hangman,
  memory,
  rps,
  codebreaker,
  pool,
  snooker,
  airhockey,
  darts,
};

/** Server steps real-time games this many times a second. */
export const REALTIME_HZ = 30;
