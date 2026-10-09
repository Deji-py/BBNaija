import {
  CHAT_MAX_LENGTH,
  REWARDS,
  REWARD_IDS,
  TASKS,
  type EventLogEntry,
  type HouseStateView,
  type RewardId,
  type TaskType,
} from "@bbn/shared";
import { ChatPanel } from "./chat.js";
import { statusOf } from "./spectatorHud.js";

export type TalkTarget = "diary" | "house";

export interface AdminHandlers {
  onAnnounce(text: string): void;
  onCallDiary(playerId: string): void;
  onEndDiary(): void;
  onDiaryBroadcast(broadcast: boolean): void;
  onDiaryChat(text: string): void;
  onStartTask(type: TaskType, reward: RewardId): void;
  onEndTask(): void;
  onMute(playerId: string, muted: boolean): void;
  onKick(playerId: string, name: string): void;
  onFollow(playerId: string): void;
  /** Hold-to-talk pressed/released. */
  onTalk(target: TalkTarget, held: boolean): void;
}

/**
 * The Big Brother control panel (right side of /bigbrother): voice, announcements,
 * housemates & moderation, Diary Room, tasks and the event log.
 */
export class AdminPanel {
  readonly diaryChat: ChatPanel;
  private readonly el: HTMLElement;
  private readonly housemateList: HTMLElement;
  private readonly diaryStatus: HTMLElement;
  private readonly endDiaryBtn: HTMLButtonElement;
  private readonly broadcastBox: HTMLInputElement;
  private readonly taskStatus: HTMLElement;
  private readonly startTaskBtn: HTMLButtonElement;
  private readonly endTaskBtn: HTMLButtonElement;
  private readonly log: HTMLElement;
  private readonly talkButtons: Record<TalkTarget, HTMLButtonElement>;
  private readonly micNote: HTMLElement;
  private lastListKey = "";
  private lastDiaryKey = "";
  private lastTaskKey = "";

  constructor(parent: HTMLElement, private readonly handlers: AdminHandlers, hasMic: boolean, noMicReason?: string) {
    this.el = document.createElement("aside");
    this.el.className = "admin-panel";
    this.el.setAttribute("aria-label", "Big Brother controls");
    this.el.innerHTML = `
      <header class="admin-head">
        <h1>Big Brother</h1>
        <div class="talk">
          <button type="button" class="talk-btn" data-target="diary">🎙️ Hold to talk: Diary Room <kbd>T</kbd></button>
          <button type="button" class="talk-btn" data-target="house">📣 Hold to talk: whole house <kbd>B</kbd></button>
          <p class="admin-note mic-note"></p>
        </div>
      </header>

      <section>
        <h2>Announcement</h2>
        <form class="announce-form">
          <input name="text" maxlength="${CHAT_MAX_LENGTH}" placeholder="Housemates, please…" autocomplete="off" />
          <button type="submit">Announce</button>
        </form>
      </section>

      <section>
        <h2>Housemates</h2>
        <ul class="admin-housemates"></ul>
      </section>

      <section>
        <h2>Diary Room</h2>
        <p class="diary-status admin-note"></p>
        <label class="check"><input type="checkbox" class="broadcast" /> Broadcast to viewers</label>
        <div class="diary-chat-slot"></div>
        <button type="button" class="end-diary">End session</button>
      </section>

      <section>
        <h2>Tasks</h2>
        <div class="task-form">
          <select class="task-type" aria-label="Task">
            ${(Object.keys(TASKS) as TaskType[]).map((t) => `<option value="${t}">${TASKS[t].title}</option>`).join("")}
          </select>
          <select class="task-reward" aria-label="Reward">
            ${REWARD_IDS.map((r) => `<option value="${r}">${REWARDS[r].icon} ${REWARDS[r].label}</option>`).join("")}
          </select>
          <button type="button" class="start-task">Start</button>
        </div>
        <p class="task-status admin-note"></p>
        <button type="button" class="end-task">End task now</button>
      </section>

      <section class="log-section">
        <h2>Event log</h2>
        <ol class="event-log"></ol>
      </section>
    `;
    parent.appendChild(this.el);

    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.housemateList = $(".admin-housemates");
    this.diaryStatus = $(".diary-status");
    this.endDiaryBtn = $(".end-diary");
    this.broadcastBox = $(".broadcast");
    this.taskStatus = $(".task-status");
    this.startTaskBtn = $(".start-task");
    this.endTaskBtn = $(".end-task");
    this.log = $(".event-log");
    this.micNote = $(".mic-note");
    this.talkButtons = { diary: $('[data-target="diary"]'), house: $('[data-target="house"]') };

    this.diaryChat = new ChatPanel($(".diary-chat-slot"), (text) => handlers.onDiaryChat(text), {
      className: "admin-diary-chat",
      label: "Diary Room chat",
      placeholder: "Type to the Diary Room…",
    });

    // Announcements
    const form = $<HTMLFormElement>(".announce-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.elements.namedItem("text") as HTMLInputElement;
      const text = input.value.trim();
      if (text) handlers.onAnnounce(text);
      input.value = "";
    });

    // Hold-to-talk buttons (mouse/touch) — keys T / B are handled by the mode.
    for (const target of ["diary", "house"] as const) {
      const b = this.talkButtons[target];
      b.disabled = !hasMic;
      const down = (e: Event) => {
        e.preventDefault();
        handlers.onTalk(target, true);
      };
      const up = () => handlers.onTalk(target, false);
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointerleave", up);
      b.addEventListener("pointercancel", up);
    }
    this.micNote.textContent = hasMic ? "" : (noMicReason ?? "No microphone — text only.");

    // Housemate row buttons
    this.housemateList.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      const row = (e.target as HTMLElement).closest<HTMLElement>("li[data-id]");
      if (!row) return;
      const id = row.dataset.id!;
      if (!btn) return handlers.onFollow(id);
      if (btn.dataset.act === "diary") handlers.onCallDiary(id);
      if (btn.dataset.act === "mute") handlers.onMute(id, btn.dataset.muted !== "true");
      if (btn.dataset.act === "kick") handlers.onKick(id, row.dataset.name ?? "this housemate");
    });

    this.endDiaryBtn.addEventListener("click", () => handlers.onEndDiary());
    this.broadcastBox.addEventListener("change", () => handlers.onDiaryBroadcast(this.broadcastBox.checked));
    this.startTaskBtn.addEventListener("click", () =>
      handlers.onStartTask($<HTMLSelectElement>(".task-type").value as TaskType, $<HTMLSelectElement>(".task-reward").value as RewardId),
    );
    this.endTaskBtn.addEventListener("click", () => handlers.onEndTask());
  }

  setTalking(target: TalkTarget | null): void {
    for (const t of ["diary", "house"] as const) this.talkButtons[t].classList.toggle("active", t === target);
  }

  addLog(entries: EventLogEntry[]): void {
    for (const e of entries) {
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.textContent = new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const type = document.createElement("span");
      type.className = `log-type log-${e.type}`;
      type.textContent = e.type;
      li.append(time, type, document.createTextNode(` ${e.text}`));
      this.log.prepend(li); // newest first
    }
    while (this.log.children.length > 300) this.log.lastElementChild!.remove();
  }

  /** Call every frame; only touches the DOM when something changed. */
  update(state: HouseStateView): void {
    this.renderHousemates(state);
    this.renderDiary(state);
    this.renderTask(state);
  }

  private renderHousemates(state: HouseStateView): void {
    const rows = [...(state.players?.entries() ?? [])].map(([id, p]) => ({
      id,
      name: p.name,
      color: p.color,
      status: statusOf(p),
      muted: p.adminMuted,
      speaking: p.speaking,
      inDiary: id === state.diaryHousemate,
      perks: [...(p.perks ?? [])].map((r) => REWARDS[r as RewardId]?.icon ?? "").join(""),
    }));
    const key = JSON.stringify(rows);
    if (key === this.lastListKey) return;
    this.lastListKey = key;
    this.housemateList.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.dataset.id = r.id;
        li.dataset.name = r.name;
        li.title = `Click to follow ${r.name}`;
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = r.color;
        const who = document.createElement("span");
        who.className = "who";
        const name = document.createElement("b");
        name.textContent = `${r.name} ${r.perks}${r.speaking ? " 🎙️" : ""}`;
        const st = document.createElement("small");
        st.textContent = r.muted ? `${r.status} · muted` : r.status;
        who.append(name, st);
        const actions = document.createElement("span");
        actions.className = "row-actions";
        actions.append(
          button("diary", r.inDiary ? "In diary" : "Diary", r.inDiary),
          Object.assign(button("mute", r.muted ? "Unmute" : "Mute"), { title: r.muted ? "Allow voice & chat" : "Block voice & house chat" }),
          button("kick", "Kick"),
        );
        actions.querySelector<HTMLButtonElement>('[data-act="mute"]')!.dataset.muted = String(r.muted);
        li.append(dot, who, actions);
        return li;
      }),
    );
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nobody's in the house.";
      this.housemateList.append(li);
    }
  }

  private renderDiary(state: HouseStateView): void {
    const who = state.diaryHousemate ? state.players?.get(state.diaryHousemate)?.name : undefined;
    const key = `${who}|${state.diaryBroadcast}`;
    if (key === this.lastDiaryKey) return;
    if (who !== this.lastDiaryKey.split("|")[0]) this.diaryChat.clear();
    this.lastDiaryKey = key;
    this.diaryStatus.textContent = who
      ? `In session with ${who}. Hold T to talk; they hear only you.`
      : "No session. Use “Diary” next to a housemate to call them in.";
    this.endDiaryBtn.disabled = !who;
    this.broadcastBox.checked = state.diaryBroadcast;
    this.diaryChat.setEnabled(!!who, "Call a housemate in to chat");
  }

  private renderTask(state: HouseStateView): void {
    const task = state.task?.type ? state.task : undefined; // empty object = no task
    const key = `${task?.title}|${task?.status}`;
    if (key === this.lastTaskKey) return;
    this.lastTaskKey = key;
    const running = task?.status === "running";
    this.taskStatus.textContent = !task
      ? "No task running."
      : running
        ? `Running: ${task.title}. Scores are shown on screen.`
        : `${task.title} finished.`;
    this.endTaskBtn.disabled = !running;
    this.startTaskBtn.textContent = running ? "Replace" : "Start";
  }
}

function button(act: string, label: string, disabled = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.act = act;
  b.textContent = label;
  b.disabled = disabled;
  return b;
}
