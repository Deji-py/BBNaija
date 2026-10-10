import { VOTES_HIDDEN, type HouseStateView, type NominationStatusMessage, type RoundView } from "@bbn/shared";

/**
 * The ceremony everyone can see: nominees, the voting countdown, and the
 * result once Big Brother reveals it. Vote totals stay hidden until then
 * (the server sends -1), because the synced state is visible to every client.
 */
export class RoundPanel {
  private readonly el: HTMLElement;
  private lastKey = "";
  private clockOffset = 0;
  private lastServerTime = 0;
  private myVote = "";
  private voteNote = "";
  private seenRound = -1;
  private packs: { id: string; label: string; priceLabel: string }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly options: { canVote: boolean; signedIn?: boolean; onVote?: (token: string) => void },
  ) {
    this.el = document.createElement("section");
    this.el.className = "round-panel";
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Nominations and voting");
    parent.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-token]");
      if (!button || button.disabled) return;
      this.options.onVote?.(button.dataset.token!);
    });
  }

  /** Extra paid votes, shown only while a window is open and payments are configured. */
  setPacks(packs: { id: string; label: string; priceLabel: string }[], onBuy: (packId: string) => void): void {
    this.packs = packs;
    this.onBuyPack = onBuy;
    this.lastKey = "";
  }

  private onBuyPack: ((packId: string) => void) | null = null;

  /** Server's reply to this viewer's vote. */
  setVoteResult(ok: boolean, text: string, token: string): void {
    this.voteNote = text;
    if (ok) this.myVote = token;
    this.lastKey = "";
  }

  update(state: HouseStateView): void {
    if (state.serverTime && state.serverTime !== this.lastServerTime) {
      this.lastServerTime = state.serverTime;
      this.clockOffset = state.serverTime - Date.now();
    }
    const round = state.round?.phase ? state.round : undefined;
    if (round && round.round !== this.seenRound) {
      this.seenRound = round.round;
      this.myVote = "";
      this.voteNote = "";
      this.lastKey = "";
    }
    // Stay up after the walk-out so the revealed votes don't vanish the moment they leave.
    const show = !!round && !round.winnerName && (round.phase !== "free" || !!round.evictedName);
    this.el.hidden = !show;
    if (!round || !show) return;
    this.render(round, Date.now() + this.clockOffset);
  }

  private render(round: RoundView, now: number): void {
    const nominees = [...(round.nominees ?? [])];
    const remaining = round.votingOpen && round.voteEndsAt ? Math.max(0, Math.ceil((round.voteEndsAt - now) / 1000)) : null;
    // Tied to this connection. Signing in later (or in another tab) doesn't
    // count until they start watching again — the vote is on the account that joined.
    const signedIn = this.options.signedIn ?? false;
    const key = JSON.stringify([
      round.phase,
      round.kind,
      round.votingOpen,
      remaining,
      round.evictedName,
      this.myVote,
      this.voteNote,
      signedIn,
      this.packs.map((p) => p.id),
      nominees.map((n) => [n.token, n.name, n.votes, n.playerId]),
    ]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el.replaceChildren();
    const head = document.createElement("div");
    head.className = "round-head";
    const title = document.createElement("b");
    title.textContent = titleFor(round);
    head.append(title);
    if (remaining !== null) {
      const timer = document.createElement("span");
      timer.className = "round-timer";
      timer.textContent = formatClock(remaining);
      head.append(timer);
    }
    this.el.append(head);

    const blurb = document.createElement("p");
    blurb.className = "round-blurb";
    blurb.textContent = blurbFor(round, this.options.canVote, signedIn);
    this.el.append(blurb);

    if (nominees.length) {
      const list = document.createElement("ul");
      list.className = "round-nominees";
      const revealed = nominees.some((n) => n.votes >= 0);
      const finale = round.kind === "finale";
      const best = revealed ? extreme(nominees.map((n) => n.votes), finale) : null;
      for (const nominee of nominees) {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = nominee.color;
        const name = document.createElement("span");
        name.className = "round-name";
        name.textContent = nominee.name;
        li.append(dot, name);
        if (revealed && nominee.votes >= 0) {
          const count = document.createElement("span");
          count.className = "round-votes";
          count.textContent = `${nominee.votes}`;
          li.append(count);
          const highlight = finale ? nominee.votes === best : nominee.name === round.evictedName;
          li.classList.toggle(finale ? "winner" : "evicted", highlight);
        } else if (round.votingOpen && this.options.canVote && signedIn) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.token = nominee.token;
          button.disabled = !!this.myVote;
          button.textContent = this.myVote === nominee.token ? "Voted" : finale ? "Vote" : "Save";
          li.append(button);
        }
        list.append(li);
      }
      this.el.append(list);
    }

    if (this.voteNote) {
      const note = document.createElement("p");
      note.className = "round-note";
      note.textContent = this.voteNote;
      this.el.append(note);
    }
    if (round.votingOpen && this.options.canVote && signedIn && this.packs.length && this.onBuyPack) {
      const row = document.createElement("div");
      row.className = "round-packs";
      for (const pack of this.packs) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${pack.label} · ${pack.priceLabel}`;
        button.addEventListener("click", () => this.onBuyPack?.(pack.id));
        row.append(button);
      }
      this.el.append(row);
    }
    if (round.votingOpen && this.options.canVote && !signedIn) {
      const signIn = document.createElement("a");
      signIn.className = "round-signin";
      signIn.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
      signIn.textContent = "Sign in to vote";
      this.el.append(signIn);
    }
  }
}

/** Housemate-only: pick who to nominate while sitting in the Diary Room. */
export class NominationCard {
  private readonly el: HTMLElement;
  private readonly selected = new Set<string>();
  private lastKey = "";
  private status: NominationStatusMessage | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onSubmit: (nomineeIds: string[]) => void,
  ) {
    this.el = document.createElement("section");
    this.el.className = "nomination-card";
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Nominate");
    parent.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!button || !this.status?.open || this.status.submitted) return;
      const id = button.dataset.id;
      if (button.dataset.act === "pick" && id) {
        if (this.status.slots <= 1) {
          this.onSubmit([id]);
          return;
        }
        if (this.selected.has(id)) this.selected.delete(id);
        else if (this.selected.size < this.status.slots) this.selected.add(id);
        this.lastKey = "";
        this.render();
      }
      if (button.dataset.act === "confirm" && this.selected.size === this.status.slots) {
        this.onSubmit([...this.selected]);
      }
    });
  }

  setStatus(status: NominationStatusMessage): void {
    this.status = status;
    if (status.submitted) this.selected.clear();
    this.lastKey = "";
    this.render();
  }

  /** Hide unless this housemate is in the Diary Room during nominations. */
  setVisible(visible: boolean): void {
    this.el.hidden = !visible || !this.status;
    if (visible) this.render();
  }

  private render(): void {
    const status = this.status;
    if (!status || this.el.hidden) return;
    const key = JSON.stringify([status, [...this.selected]]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Nominate";
    const text = document.createElement("p");
    if (status.submitted) {
      text.textContent = `You nominated ${status.pickedNames.join(" and ")}. It stays secret until the eviction.`;
    } else if (!status.open) {
      text.textContent = "Nominations are closed.";
    } else if (status.slots <= 0) {
      text.textContent = "Everyone else has immunity, so you can't nominate.";
    } else {
      text.textContent =
        status.slots > 1
          ? `You have extra nomination power. Choose ${status.slots} housemates.`
          : "Choose who should face the public vote. This stays between you and Big Brother.";
    }
    this.el.append(title, text);
    if (!status.open || status.submitted || status.slots <= 0) return;

    const list = document.createElement("div");
    list.className = "nomination-choices";
    for (const choice of status.choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = "pick";
      button.dataset.id = choice.id;
      button.disabled = choice.immune;
      button.classList.toggle("selected", this.selected.has(choice.id));
      button.textContent = choice.immune ? `${choice.name} 🛡️` : status.slots <= 1 ? `Nominate ${choice.name}` : choice.name;
      list.append(button);
    }
    this.el.append(list);
    if (status.slots > 1) {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.dataset.act = "confirm";
      confirm.className = "nomination-confirm";
      confirm.disabled = this.selected.size !== status.slots;
      confirm.textContent = `Nominate ${this.selected.size}/${status.slots}`;
      this.el.append(confirm);
    }
  }
}

/** Full-screen card once a winner is crowned. Dismissing it only hides it on this screen. */
export class WinnerScreen {
  private readonly el: HTMLElement;
  private readonly nameEl: HTMLElement;
  private dismissedFor = "";

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "winner-screen";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="winner-card">
        <p class="winner-kicker">Winner</p>
        <h2></h2>
        <p>Last housemate standing.</p>
        <button type="button">Continue</button>
      </div>
    `;
    this.nameEl = this.el.querySelector("h2")!;
    this.el.querySelector("button")!.addEventListener("click", () => {
      this.dismissedFor = this.nameEl.textContent ?? "";
      this.el.hidden = true;
    });
    parent.appendChild(this.el);
  }

  update(state: HouseStateView): void {
    const name = state.round?.winnerName ?? "";
    if (!name || this.dismissedFor === name) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
    const card = this.el.querySelector<HTMLElement>(".winner-card")!;
    card.style.borderColor = state.round?.winnerColor || "#ffd76a";
  }
}

function titleFor(round: RoundView): string {
  if (round.phase === "nominations") return "Nominations";
  if (round.phase === "eviction") return "Eviction";
  if (round.kind === "finale") return round.votingOpen ? "Finale vote" : "Finale";
  if (round.phase === "voting" && !round.votingOpen && round.voteEndsAt === 0) return "Nominees";
  if (round.votingOpen) return "Vote to save";
  if (round.evictedName) return "Evicted";
  return "Voting closed";
}

function blurbFor(round: RoundView, canVote: boolean, signedIn: boolean): string {
  if (round.phase === "nominations") return "Housemates are nominating in private, in the Diary Room.";
  if (round.phase === "eviction") return `${round.evictedName} is leaving the house.`;
  if (round.evictedName && round.phase === "free") return `${round.evictedName} has been evicted.`;
  const names = [...(round.nominees ?? [])].map((n) => n.name);
  const list = names.length ? names.join(", ") : "the nominees";
  if (round.kind === "finale") {
    if (round.votingOpen) return canVote ? `Vote for who should win: ${list}.` : `Viewers are voting for the winner: ${list}.`;
    if (round.voteEndsAt > 0) return "The finale vote is closed. The winner stays secret until the reveal.";
    return `The finalists are ${list}.`;
  }
  if (round.votingOpen) {
    if (!canVote) return `Viewers are voting to save ${list}. Fewest votes leaves.`;
    return signedIn ? `Save the nominee you want to stay. One vote, and you can't change it.` : `Sign in to save someone. Fewest votes leaves.`;
  }
  if (round.voteEndsAt > 0) return round.evictedName ? `${round.evictedName} has been evicted.` : "Voting is closed. The result stays secret until the eviction.";
  return `Up for eviction: ${list}.`;
}

function extreme(votes: number[], highest: boolean): number {
  const visible = votes.filter((n) => n !== VOTES_HIDDEN);
  if (!visible.length) return 0;
  return highest ? Math.max(...visible) : Math.min(...visible);
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
