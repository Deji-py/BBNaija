import { COOK_STAGE, REWARDS, type HouseStateView, type RewardId, type TaskView } from "@bbn/shared";

const COOK_HINTS: Record<number, string> = {
  [COOK_STAGE.start]: "Next: grab ingredients from the fridge",
  [COOK_STAGE.hasIngredients]: "Next: prep them at the counter",
  [COOK_STAGE.prepped]: "Next: cook at the stove (stay for 4 s)",
};

/**
 * The current task: title, countdown, scoreboard and reward, plus the quiz
 * question card. Housemates can answer; viewers and Big Brother just watch.
 */
export class TaskPanel {
  private readonly el: HTMLElement;
  private readonly quizEl: HTMLElement;
  private lastKey = "";
  private lastQuizKey = "";
  /** Server clock minus ours, so countdowns match what the server enforces. */
  private clockOffset = 0;
  private lastServerTime = 0;
  /** Our own answer to the current quiz question (kept locally — the server doesn't reveal answers). */
  private myAnswer: { question: string; index: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly options: { myId?: string; onAnswer?: (index: number) => void },
  ) {
    this.el = document.createElement("div");
    this.el.className = "task-panel";
    this.el.hidden = true;
    this.quizEl = document.createElement("div");
    this.quizEl.className = "quiz-card";
    this.quizEl.hidden = true;
    parent.append(this.el, this.quizEl);

    this.quizEl.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
      const question = this.quizEl.dataset.question;
      if (!button || !question || !this.options.onAnswer || this.myAnswer?.question === question) return;
      const index = Number(button.dataset.index);
      this.myAnswer = { question, index };
      this.options.onAnswer(index);
      this.lastQuizKey = ""; // re-render to show the pick
    });
  }

  /** Call every frame. Rebuilds DOM only when something visible changed. */
  update(state: HouseStateView): void {
    if (state.serverTime && state.serverTime !== this.lastServerTime) {
      this.lastServerTime = state.serverTime;
      this.clockOffset = state.serverTime - Date.now();
    }
    // An empty task object (no type) means "no task" — the schema creates one by default.
    const task = state.task?.type ? state.task : undefined;
    this.el.hidden = !task;
    if (!task) {
      this.quizEl.hidden = true;
      return;
    }
    const now = Date.now() + this.clockOffset;
    this.renderPanel(task, state, now);
    this.renderQuiz(task, now);
  }

  private renderPanel(task: TaskView, state: HouseStateView, now: number): void {
    const names = (id: string) => state.players?.get(id)?.name ?? "—";
    const scores = [...(task.scores?.entries() ?? [])]
      .filter(([id]) => state.players?.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const me = this.options.myId ? state.players?.get(this.options.myId) : undefined;
    const remaining = task.endsAt ? Math.max(0, Math.ceil((task.endsAt - now) / 1000)) : null;
    const reward = REWARDS[task.reward as RewardId];
    const hint = task.status === "running" && task.type === "cooking" && me ? COOK_HINTS[me.cookStage] : "";
    const gemsLeft = task.type === "treasure" ? [...task.gems].filter((g) => !g.found).length : null;

    const key = JSON.stringify([task.title, task.status, remaining, scores, hint, gemsLeft, [...task.winners]]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el.replaceChildren();
    const head = div("task-head");
    head.append(span("task-title", task.title), span("task-timer", task.status === "done" ? "Finished" : remaining !== null ? fmt(remaining) : ""));
    this.el.append(head);
    if (task.status === "running") this.el.append(div("task-desc", task.description));
    if (gemsLeft !== null && task.status === "running") this.el.append(div("task-hint", `💎 ${gemsLeft} gem${gemsLeft === 1 ? "" : "s"} still hidden`));
    if (hint) this.el.append(div("task-hint", hint));

    const list = document.createElement("ol");
    list.className = "task-scores";
    for (const [id, score] of scores) {
      const li = document.createElement("li");
      li.classList.toggle("me", id === this.options.myId);
      li.classList.toggle("winner", [...task.winners].includes(id));
      li.append(span("", names(id)), span("score", String(score)));
      list.append(li);
    }
    if (scores.length) this.el.append(list);

    const winners = [...task.winners].map(names);
    this.el.append(
      div(
        "task-reward",
        task.status === "done"
          ? winners.length
            ? `${reward?.icon ?? ""} ${winners.join(" & ")} won ${reward?.label ?? task.reward}`
            : "Nobody scored — no winner"
          : `Prize: ${reward?.icon ?? ""} ${reward?.label ?? task.reward}`,
      ),
    );
  }

  private renderQuiz(task: TaskView, now: number): void {
    const quiz = task.type === "quiz" && task.status === "running" ? task.quiz : undefined;
    this.quizEl.hidden = !quiz;
    if (!quiz) return;
    const remaining = Math.max(0, Math.ceil((quiz.endsAt - now) / 1000));
    const mine = this.myAnswer?.question === quiz.question ? this.myAnswer.index : -1;
    const key = JSON.stringify([quiz.question, quiz.revealed, quiz.correct, remaining, mine]);
    if (key === this.lastQuizKey) return;
    this.lastQuizKey = key;

    this.quizEl.dataset.question = quiz.question;
    this.quizEl.replaceChildren();
    const head = div("quiz-head");
    head.append(span("", `Question ${quiz.number} of ${quiz.total}`), span("task-timer", quiz.revealed ? "" : `${remaining}s`));
    this.quizEl.append(head, div("quiz-question", quiz.question));
    const grid = div("quiz-options", "");
    [...quiz.options].forEach((text, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.index = String(i);
      b.textContent = text;
      const canAnswer = !!this.options.onAnswer && !quiz.revealed && mine === -1;
      b.disabled = !canAnswer;
      b.classList.toggle("picked", i === mine);
      b.classList.toggle("correct", quiz.revealed && i === quiz.correct);
      b.classList.toggle("wrong", quiz.revealed && i === mine && i !== quiz.correct);
      grid.append(b);
    });
    this.quizEl.append(grid);
    if (this.options.onAnswer) {
      this.quizEl.append(
        div(
          "quiz-foot",
          quiz.revealed
            ? mine === quiz.correct
              ? "✅ Correct!"
              : mine === -1
                ? "⏱️ No answer"
                : "❌ Not this time"
            : mine === -1
              ? "Pick an answer — your first choice is final"
              : "Answer locked in",
        ),
      );
    }
  }
}

function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
