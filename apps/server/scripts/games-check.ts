/**
 * Plays random games of every game in the hall to the end — run after changing game rules:
 *   pnpm games:check
 * Every move a game lists as legal must be accepted, nothing may throw, games must finish,
 * and every view must survive JSON (it's sent to clients).
 */
import { GAMES, type GameDef, type Rng } from "@bbn/shared";

function seeded(seed: number): Rng {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log("FAIL", msg);
};

function playOne(game: GameDef, players: number, seed: number): { finished: boolean; moves: number } {
  const rng = seeded(seed);
  const s = game.setup(players, rng);
  let moves = 0;
  for (let step = 0; step < 4000; step++) {
    if (game.result(s)) return { finished: true, moves };
    for (const seat of [null, ...Array.from({ length: players }, (_, i) => i)]) JSON.stringify(game.view ? game.view(s, seat) : s);
    if (game.realtime) {
      for (let seat = 0; seat < players; seat++) {
        const r = rng();
        game.input?.(s, seat, r < 0.3 ? { dir: Math.floor(rng() * 4) } : r < 0.6 ? { dir: Math.floor(rng() * 3) - 1 } : { x: rng() * 60, y: rng() * 100 });
      }
      game.tick!(s, 1 / 30, rng);
      continue;
    }
    const turn = game.turn(s);
    if (!turn.length) return fail(`${game.id}: no one to move but no result`), { finished: false, moves };
    const seat = turn[Math.floor(rng() * turn.length)]!;
    const legal = game.moves?.(s, seat) ?? [];
    if (!legal.length) return fail(`${game.id}: seat ${seat} to move with no legal moves`), { finished: false, moves };
    const move = legal[Math.floor(rng() * legal.length)];
    const err = game.move(s, seat, move, rng);
    // Cue sports and a few others list sample moves that may be refused (e.g. a cue spot that's taken).
    if (err && !["pool", "snooker", "codebreaker", "darts"].includes(game.id)) return fail(`${game.id}: legal move refused: ${JSON.stringify(move)} → ${err}`), { finished: false, moves };
    moves++;
    // Junk input must be refused, never throw.
    for (const junk of [null, 5, "x", { cell: -1 }, { from: 99, to: "a" }, { play: 999 }]) game.move(s, seat, junk, rng);
  }
  return { finished: !!game.result(s), moves };
}

for (const game of Object.values(GAMES)) {
  const sizes = [...new Set([game.minPlayers, Math.max(2, game.minPlayers), game.maxPlayers])].filter((n) => n >= game.minPlayers && n <= game.maxPlayers);
  let finished = 0;
  let total = 0;
  let moveCount = 0;
  for (const n of sizes) {
    for (let seed = 1; seed <= 25; seed++) {
      try {
        const r = playOne(game, n, seed * 7919 + n);
        total++;
        moveCount += r.moves;
        if (r.finished) finished++;
      } catch (err) {
        fail(`${game.id} (${n} players, seed ${seed}) threw: ${(err as Error).stack}`);
      }
    }
  }
  const note = `${finished}/${total} random games finished, ~${Math.round(moveCount / Math.max(1, total))} moves each`;
  console.log(finished === total ? "PASS" : finished > 0 ? "WARN" : "FAIL", game.id.padEnd(12), note);
  if (finished === 0) failures++;
}
if (failures) {
  console.log(`\n${failures} problem(s)`);
  process.exit(1);
}
