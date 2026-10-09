import type { Delayed } from "colyseus";
import {
  COOK_SECONDS,
  COOK_STAGE,
  GEM_COUNT,
  GEM_PICKUP_RANGE,
  GEM_SPOTS,
  QUIZ_ANSWER_SECONDS,
  QUIZ_QUESTIONS,
  QUIZ_QUESTIONS_PER_ROUND,
  QUIZ_REVEAL_SECONDS,
  REWARDS,
  TASKS,
  TICK_RATE_HZ,
  type QuizQuestion,
  type RewardId,
  type TaskType,
} from "@bbn/shared";
import { Gem, Quiz, Task, type HouseState, type Player } from "../schema/HouseState.js";

/** How long a finished task's results stay on screen. */
const RESULTS_SECONDS = 20;
const COOK_TICKS = COOK_SECONDS * TICK_RATE_HZ;

interface Clock {
  setTimeout(cb: () => void, ms: number): Delayed;
}

interface TaskHooks {
  log(type: string, text: string): void;
  announce(text: string): void;
  /** Get a player up off whatever they're using (e.g. after finishing a dish). */
  standUp(player: Player): void;
}

/**
 * Runs Big Brother's built-in tasks. One task at a time; its state lives in
 * `state.task` so every housemate, viewer and the console see the same thing.
 */
export class TaskRunner {
  private timers: Delayed[] = [];
  /** Cooking: ticks each player has spent cooking a prepped dish. */
  private readonly cookTicks = new Map<string, number>();
  /** Quiz: this round's questions, and each player's answer to the current one (not synced — no peeking). */
  private questions: QuizQuestion[] = [];
  private answers = new Map<string, number>();

  constructor(
    private readonly state: HouseState,
    private readonly clock: Clock,
    private readonly hooks: TaskHooks,
  ) {}

  get running(): Task | undefined {
    return this.state.task?.status === "running" ? this.state.task : undefined;
  }

  start(type: TaskType, reward: RewardId): void {
    if (this.running) this.end("replaced");
    this.clearTimers();
    for (const p of this.state.players.values()) p.cookStage = COOK_STAGE.start;
    this.cookTicks.clear();

    const def = TASKS[type];
    const task = new Task();
    task.type = type;
    task.title = def.title;
    task.description = def.description;
    task.reward = reward;
    task.status = "running";
    task.endsAt = def.durationSec ? Date.now() + def.durationSec * 1000 : 0;
    for (const id of this.state.players.keys()) task.scores.set(id, 0);

    if (type === "treasure") {
      for (const [i, spot] of shuffle([...GEM_SPOTS]).slice(0, GEM_COUNT).entries()) {
        const gem = new Gem();
        gem.id = String(i + 1);
        gem.x = spot.x;
        gem.z = spot.z;
        gem.found = false;
        task.gems.push(gem);
      }
    }
    this.state.task = task;

    if (type === "quiz") {
      this.questions = shuffle([...QUIZ_QUESTIONS]).slice(0, QUIZ_QUESTIONS_PER_ROUND);
      this.askQuestion(0);
    }
    this.hooks.log("task", `Task started: ${def.title} (reward: ${REWARDS[reward].label})`);
    this.hooks.announce(`Task time! ${def.title}. The winner earns ${REWARDS[reward].label}.`);
  }

  /** Ends the running task, awards the reward to the top scorer(s), and shows results for a while. */
  end(reason: "time" | "admin" | "complete" | "replaced"): void {
    const task = this.running;
    if (!task) return;
    this.clearTimers();
    task.status = "done";
    if (task.quiz) task.quiz.endsAt = 0;

    const scores = [...task.scores.entries()].filter(([id]) => this.state.players.has(id));
    const best = Math.max(0, ...scores.map(([, s]) => s));
    const winners = best > 0 ? scores.filter(([, s]) => s === best).map(([id]) => id) : [];
    for (const id of winners) {
      task.winners.push(id);
      const player = this.state.players.get(id)!;
      if (!player.perks.includes(task.reward)) player.perks.push(task.reward);
    }
    for (const p of this.state.players.values()) p.cookStage = COOK_STAGE.start;

    const names = winners.map((id) => this.state.players.get(id)!.name);
    const reward = REWARDS[task.reward as RewardId]?.label ?? task.reward;
    const summary =
      reason === "replaced"
        ? `${task.title} was cancelled.`
        : names.length
          ? `${joinNames(names)} won the ${task.title.toLowerCase()} and ${names.length > 1 ? "earn" : "earns"} ${reward}!`
          : `The ${task.title.toLowerCase()} is over. Nobody scored, so nobody wins ${reward}.`;
    this.hooks.log("task", `Task ended (${reason}): ${summary} Scores: ${scores.map(([id, s]) => `${this.state.players.get(id)?.name}=${s}`).join(", ") || "none"}`);
    if (reason !== "replaced") this.hooks.announce(summary);

    // Leave the results up briefly, then clear (unless another task started meanwhile).
    this.timers.push(
      this.clock.setTimeout(() => {
        if (this.state.task === task) this.state.task = undefined as never;
      }, RESULTS_SECONDS * 1000),
    );
  }

  /** Called every server tick. */
  tick(now = Date.now()): void {
    const task = this.running;
    if (!task) return;
    if (task.endsAt && now >= task.endsAt) return this.end("time");

    if (task.type === "cooking") {
      for (const p of this.state.players.values()) {
        if (p.activity !== "stove" || p.cookStage !== COOK_STAGE.prepped) {
          this.cookTicks.delete(p.id);
          continue;
        }
        const ticks = (this.cookTicks.get(p.id) ?? 0) + 1;
        this.cookTicks.set(p.id, ticks);
        if (ticks >= COOK_TICKS) {
          this.cookTicks.delete(p.id);
          p.cookStage = COOK_STAGE.start;
          this.addScore(p.id);
          this.hooks.log("task", `${p.name} cooked a dish (${task.scores.get(p.id)} so far)`);
          this.hooks.standUp(p); // free the stove for the next chef
        }
      }
    }
  }

  /** E on the fridge or counter. Returns true if it counted as a task step. */
  onTaskObject(player: Player, objectId: string): boolean {
    if (this.running?.type !== "cooking") return false;
    if (objectId === "fridge" && player.cookStage === COOK_STAGE.start) {
      player.cookStage = COOK_STAGE.hasIngredients;
      return true;
    }
    if (objectId === "counter" && player.cookStage === COOK_STAGE.hasIngredients) {
      player.cookStage = COOK_STAGE.prepped;
      return true;
    }
    return false;
  }

  /** E near a hidden gem. */
  pickGem(player: Player, gemId: string): boolean {
    const task = this.running;
    if (task?.type !== "treasure") return false;
    const gem = task.gems.find((g) => g.id === gemId);
    if (!gem || gem.found || Math.hypot(gem.x - player.x, gem.z - player.z) > GEM_PICKUP_RANGE) return false;
    gem.found = true;
    this.addScore(player.id);
    this.hooks.log("task", `${player.name} found gem ${gem.id}`);
    if (task.gems.every((g) => g.found)) this.end("complete");
    return true;
  }

  onQuizAnswer(playerId: string, answer: number): void {
    const quiz = this.running?.quiz;
    if (!quiz || quiz.revealed || !this.state.players.has(playerId)) return;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return;
    if (this.answers.has(playerId)) return; // first answer is final
    this.answers.set(playerId, answer);
  }

  onPlayerLeft(id: string): void {
    this.cookTicks.delete(id);
    this.answers.delete(id);
  }

  private askQuestion(index: number): void {
    const task = this.running;
    const q = this.questions[index];
    if (!task || !q) return this.end("complete");
    this.answers.clear();
    const quiz = new Quiz();
    quiz.number = index + 1;
    quiz.total = this.questions.length;
    quiz.question = q.question;
    for (const o of q.options) quiz.options.push(o);
    quiz.endsAt = Date.now() + QUIZ_ANSWER_SECONDS * 1000;
    quiz.revealed = false;
    quiz.correct = -1;
    task.quiz = quiz;

    this.timers.push(
      this.clock.setTimeout(() => {
        quiz.revealed = true;
        quiz.correct = q.correct;
        let right = 0;
        for (const [id, a] of this.answers) {
          if (a === q.correct) {
            this.addScore(id);
            right++;
          }
        }
        this.hooks.log("task", `Quiz Q${index + 1}: ${right}/${this.answers.size} answered correctly`);
        this.timers.push(this.clock.setTimeout(() => this.askQuestion(index + 1), QUIZ_REVEAL_SECONDS * 1000));
      }, QUIZ_ANSWER_SECONDS * 1000),
    );
  }

  private addScore(id: string): void {
    const task = this.running;
    if (task) task.scores.set(id, (task.scores.get(id) ?? 0) + 1);
  }

  private clearTimers(): void {
    for (const t of this.timers) t.clear();
    this.timers = [];
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
