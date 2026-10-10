import type { Delayed } from "colyseus";
import {
  CloseCode,
  MIN_HOUSEMATES_FOR_FINALE,
  MIN_HOUSEMATES_TO_NOMINATE,
  Msg,
  NOMINATION_SLATE_SIZE,
  TICK_RATE_HZ,
  VOTES_HIDDEN,
  WALK_SPEED,
  areaAt,
  isVoteLength,
  slateFromCounts,
  type NominationStatusMessage,
  type RoundAdminView,
  type RoundChoice,
  type RoundStep,
  type VoteAckMessage,
} from "@bbn/shared";
import { db } from "../db/client.js";
import { extraVotes } from "./payments.js";
import type { BallotReveal } from "./captions.js";
import { RateLimiter } from "./rateLimit.js";
import { Nominee, type HouseState, type Player } from "../schema/HouseState.js";

/**
 * One season's nominations, public vote and eviction.
 *
 * The server is the referee: clients only say "I nominate these people" or
 * "I vote for token 2". Totals stay in memory (and the database, for the
 * audit trail) and are copied into the synced state only when Big Brother
 * reveals them. Synced state is sent to every browser, so a hidden number
 * can't live there.
 *
 * Viewers vote to *save*. The nominee with the fewest votes leaves. In the
 * finale they vote for a winner instead, and the most votes wins.
 */

/** Just inside the garden, south of the lounge door (x 3.5–6.5, z = 10). */
const EXIT_FROM = { x: 5, z: 11.2 };
/** Far end of the garden, clear of the pool and the trees. */
const EXIT_TO = { x: 5, z: 24.2 };
const EXIT_MAX_TICKS = 8 * TICK_RATE_HZ;

interface Clock {
  setTimeout(cb: () => void, ms: number): Delayed;
}

interface Person {
  sessionId: string;
  key: string;
  name: string;
  color: string;
  perks: string[];
}

interface SlateMember {
  key: string;
  name: string;
  color: string;
  token: string;
}

interface Pick {
  key: string;
  name: string;
}

export interface RoundHooks {
  seasonId: string;
  userId(sessionId: string): string | undefined;
  viewer(sessionId: string): { userId: string; name: string } | undefined;
  taskRunning(): boolean;
  log(type: string, text: string): void;
  announce(text: string): void;
  send(sessionId: string, type: string, message: unknown): void;
  sendAdmin(message: RoundAdminView): void;
  leave(sessionId: string, code: number): void;
  standUp(player: Player): void;
  endDiary(): void;
  setDiaryPrivate(): void;
  /** Viewer-only caption. */
  caption(icon: string, text: string, focus: string[]): void;
  /** Nominations closed: tell viewers (never the house) who nominated whom. */
  revealBallots(ballots: BallotReveal[]): void;
  persistPerks(sessionId: string): Promise<void>;
}

export class SeasonRound {
  private roundNumber = 0;
  /** Nominator key → the people they named. Secret from other housemates. */
  private ballots = new Map<string, Pick[]>();
  /** Nominator key → their name, for the viewers' reveal. */
  private readonly ballotNames = new Map<string, string>();
  private slate: SlateMember[] = [];
  /** Housemates may still submit a nomination. */
  private collecting = false;
  /** Closed, but fewer than two nominees — Big Brother names the rest. */
  private bbFill = false;
  private windowId: string | null = null;
  /** Voter user id → nominee key. */
  private votes = new Map<string, string>();
  private pendingTie: SlateMember[] = [];
  private voteTimer: Delayed | null = null;
  private exiting: { sessionId: string; ticks: number } | null = null;
  private evictionSettled = true;
  private queue: Promise<void> = Promise.resolve();
  private readonly nominateLimit = new RateLimiter(4, 2000);
  private readonly voteLimit = new RateLimiter(3, 1000);

  constructor(
    private readonly state: HouseState,
    private readonly clock: Clock,
    private readonly hooks: RoundHooks,
  ) {}

  /** Next round number continues after anything already saved, so a restart can't reuse a round. */
  async load(): Promise<void> {
    const seasonId = this.hooks.seasonId;
    const [nomination, window] = await Promise.all([
      db.nomination.findFirst({ where: { seasonId }, orderBy: { round: "desc" } }),
      db.voteWindow.findFirst({ where: { seasonId }, orderBy: { round: "desc" } }),
    ]);
    this.roundNumber = Math.max(nomination?.round ?? 0, window?.round ?? 0);
    this.state.round.round = this.roundNumber;
  }

  allowsTasks(): boolean {
    return this.step() === "idle" && !this.exiting;
  }

  onAdminJoined(): void {
    this.pushAdmin();
  }

  /** Replace the console status line without changing the ceremony. */
  notice(text: string): void {
    this.pushAdmin(text);
  }

  onHousemateJoined(sessionId: string): void {
    this.refreshPresence();
    if (this.state.round.phase === "nominations") this.sendStatus(sessionId);
    this.pushAdmin();
  }

  onEnteredDiary(sessionId: string): void {
    if (this.state.round.phase === "nominations") this.sendStatus(sessionId);
  }

  onPlayerLeft(sessionId: string): void {
    this.refreshPresence();
    if (this.exiting?.sessionId === sessionId) {
      this.exiting = null;
      this.enqueue(() => this.afterEviction());
      return;
    }
    if (this.collecting || this.bbFill) this.pushAdmin();
  }

  /** Called every server tick. Walks an evicted housemate out along the garden. */
  tick(): void {
    if (!this.exiting) return;
    const player = this.state.players.get(this.exiting.sessionId);
    if (!player) {
      this.exiting = null;
      this.enqueue(() => this.afterEviction());
      return;
    }
    this.exiting.ticks++;
    const dx = EXIT_TO.x - player.x;
    const dz = EXIT_TO.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35 || this.exiting.ticks > EXIT_MAX_TICKS) {
      // Clear this before leave(), so onLeave doesn't settle the eviction twice.
      this.exiting = null;
      player.exiting = false;
      this.hooks.leave(player.id, CloseCode.evicted);
      this.enqueue(() => this.afterEviction());
      return;
    }
    const step = Math.min(WALK_SPEED / TICK_RATE_HZ, dist);
    player.x += (dx / dist) * step;
    player.z += (dz / dist) * step;
    player.rotY = Math.atan2(dx, dz);
    player.anim = "walk";
    const area = areaAt(player.x, player.z)?.id ?? "";
    if (player.area !== area) player.area = area;
  }

  startNominations(): void {
    this.enqueue(() => this.doStartNominations());
  }
  cancelNominations(): void {
    this.enqueue(() => this.doCancelNominations());
  }
  closeNominations(): void {
    this.enqueue(() => this.doCloseNominations());
  }
  bbNominate(playerId: string): void {
    this.enqueue(() => this.doBbNominate(playerId));
  }
  openVoting(seconds: number): void {
    this.enqueue(() => this.doOpenVoting(seconds));
  }
  closeVoting(): void {
    this.enqueue(() => this.lockVoting("admin"));
  }
  reveal(token: string): void {
    this.enqueue(() => this.doReveal(token));
  }
  startFinale(): void {
    this.enqueue(() => this.doStartFinale());
  }
  nominate(sessionId: string, nomineeIds: string[]): void {
    if (!this.nominateLimit.allow(sessionId)) return;
    this.enqueue(() => this.doNominate(sessionId, nomineeIds));
  }
  vote(sessionId: string, token: string): void {
    if (!this.voteLimit.allow(sessionId)) return;
    this.enqueue(() => this.doVote(sessionId, token));
  }

  // ---------------------------------------------------------------- ceremony

  private async doStartNominations(): Promise<void> {
    if (this.step() !== "idle") return this.tell("Finish the current ceremony first.");
    if (this.hooks.taskRunning()) return this.tell("End the task before starting nominations.");
    const people = this.people();
    if (people.length < MIN_HOUSEMATES_TO_NOMINATE) {
      return this.tell(`Need at least ${MIN_HOUSEMATES_TO_NOMINATE} housemates in the house. With the final two, start the finale.`);
    }
    if (people.filter((p) => !p.perks.includes("immunity")).length < NOMINATION_SLATE_SIZE) {
      return this.tell("At least two housemates need to be without immunity.");
    }

    this.roundNumber++;
    this.ballots.clear();
    this.ballotNames.clear();
    this.slate = [];
    this.collecting = true;
    this.bbFill = false;
    this.votes.clear();
    this.pendingTie = [];
    this.windowId = null;
    this.clearTimer();
    this.clearNominees();

    const round = this.state.round;
    round.phase = "nominations";
    round.round = this.roundNumber;
    round.kind = "";
    round.votingOpen = false;
    round.voteEndsAt = 0;
    round.evictedName = "";
    round.winnerName = "";
    round.winnerColor = "";

    // Nominations are spoken in the Diary Room. Default that conversation to private
    // so a broadcast doesn't leak them; Big Brother can turn the broadcast back on.
    this.hooks.setDiaryPrivate();
    this.hooks.announce("Nominations are open. Big Brother will call you to the Diary Room. Your nomination stays secret.");
    this.hooks.log("nomination", `Round ${this.roundNumber}: nominations opened`);
    for (const p of people) this.sendStatus(p.sessionId);
    this.pushAdmin();
  }

  private async doCancelNominations(): Promise<void> {
    if (this.state.round.phase !== "nominations") return this.tell("Nominations aren't open.");
    await db.nomination.deleteMany({ where: { seasonId: this.hooks.seasonId, round: this.roundNumber } });
    this.ballots.clear();
    this.ballotNames.clear();
    this.slate = [];
    this.collecting = false;
    this.bbFill = false;
    this.state.round.phase = "free";
    this.clearNominees();
    this.hooks.announce("Nominations were cancelled.");
    this.hooks.log("nomination", "Nominations cancelled");
    for (const p of this.people()) this.sendStatus(p.sessionId);
    this.pushAdmin();
  }

  private async doNominate(sessionId: string, nomineeIds: string[]): Promise<void> {
    if (!this.collecting) return;
    const player = this.state.players.get(sessionId);
    // Only from the Diary Room chair, so the rest of the house doesn't hear it by proximity.
    if (!player || this.state.diaryHousemate !== sessionId) return;
    const key = this.keyFor(sessionId);
    if (this.ballots.has(key)) return;

    const slots = this.slotsFor(sessionId);
    if (slots < 1 || nomineeIds.length !== slots || new Set(nomineeIds).size !== nomineeIds.length) return;
    const eligible = this.eligibleTargets(sessionId);
    const picks: Pick[] = [];
    for (const id of nomineeIds) {
      const target = eligible.find((p) => p.sessionId === id);
      if (!target) return;
      picks.push({ key: target.key, name: target.name });
    }

    await db.nomination.createMany({
      data: picks.map((p) => ({
        seasonId: this.hooks.seasonId,
        round: this.roundNumber,
        nominatorId: key,
        nomineeId: p.key,
      })),
    });
    this.ballots.set(key, picks);
    this.ballotNames.set(key, player.name);
    // The extra slot is spent by using it. A single nomination leaves the perk for later.
    if (picks.length >= 2) await this.dropPerk(sessionId, "nominationPower");
    this.hooks.log("nomination", `${player.name} nominated ${picks.map((p) => p.name).join(" and ")}`);
    this.hooks.caption("🗳️", `${player.name} has nominated. Who? Revealed when nominations close.`, [sessionId]);
    this.sendStatus(sessionId);
    this.pushAdmin();
  }

  private async doCloseNominations(): Promise<void> {
    if (!this.collecting) return this.tell("Nominations are already closed.");
    this.collecting = false;
    this.hooks.revealBallots(
      [...this.ballots].map(([key, picks]) => ({
        by: { sessionId: this.sessionForKey(key), name: this.ballotNames.get(key) ?? "A housemate" },
        picks: picks.map((p) => ({ sessionId: this.sessionForKey(p.key), name: p.name })),
      })),
    );
    this.slate = this.rankedSlate();
    if (this.slate.length >= NOMINATION_SLATE_SIZE) {
      await this.lockSlate("save");
      return;
    }
    this.bbFill = true;
    this.hooks.log("nomination", `Nominations closed with ${this.slate.length} nominee(s) — Big Brother completes the slate`);
    for (const p of this.people()) this.sendStatus(p.sessionId);
    this.pushAdmin();
  }

  private async doBbNominate(playerId: string): Promise<void> {
    if (!this.bbFill) return this.tell("The slate doesn't need another nominee.");
    const person = this.people().find((p) => p.sessionId === playerId);
    if (!person) return this.tell("That housemate isn't in the house.");
    if (person.perks.includes("immunity")) return this.tell(`${person.name} has immunity.`);
    if (this.slate.some((m) => m.key === person.key)) return this.tell(`${person.name} is already nominated.`);
    this.slate.push({ key: person.key, name: person.name, color: person.color, token: "" });
    this.hooks.log("nomination", `Big Brother nominated ${person.name}`);
    if (this.slate.length >= NOMINATION_SLATE_SIZE) await this.lockSlate("save");
    else this.pushAdmin();
  }

  /** Immunity protects for this round only, and it's used up once the slate is locked. */
  private async lockSlate(kind: "save" | "finale"): Promise<void> {
    if (kind === "save") {
      for (const p of this.people()) {
        if (p.perks.includes("immunity")) await this.dropPerk(p.sessionId, "immunity");
      }
    }
    this.collecting = false;
    this.bbFill = false;
    this.votes.clear();
    this.pendingTie = [];
    this.windowId = null;
    this.clearTimer();
    this.assignTokens();

    const round = this.state.round;
    round.phase = "voting";
    round.kind = kind;
    round.votingOpen = false;
    round.voteEndsAt = 0;
    round.evictedName = "";
    round.winnerName = "";
    round.winnerColor = "";
    round.round = this.roundNumber;
    this.publish(false);

    const names = this.slate.map((m) => m.name);
    if (kind === "finale") {
      this.hooks.announce(`This is the finale. The finalists are ${joinNames(names)}.`);
      this.hooks.log("finale", `Finale slate: ${names.join(", ")}`);
    } else {
      this.hooks.announce(`Nominations are closed. Up for eviction: ${joinNames(names)}.`);
      this.hooks.log("nomination", `Nominees: ${names.join(", ")}`);
    }
    for (const p of this.people()) this.sendStatus(p.sessionId);
    this.pushAdmin();
  }

  private async doStartFinale(): Promise<void> {
    if (this.step() !== "idle") return this.tell("Finish the current ceremony first.");
    if (this.hooks.taskRunning()) return this.tell("End the task before the finale.");
    const people = this.people();
    if (people.length < MIN_HOUSEMATES_FOR_FINALE) return this.tell("Need at least two housemates in the house for a finale.");
    this.roundNumber++;
    this.ballots.clear();
    this.slate = people.map((p) => ({ key: p.key, name: p.name, color: p.color, token: "" }));
    this.state.round.round = this.roundNumber;
    await this.lockSlate("finale");
  }

  private async doOpenVoting(seconds: number): Promise<void> {
    if (this.step() !== "ready-to-vote") return this.tell("The nominees have to be set before voting opens.");
    if (!isVoteLength(seconds)) return this.tell("Voting can run for 1, 3 or 5 minutes.");
    const closesAt = new Date(Date.now() + seconds * 1000);
    const window = await db.voteWindow.create({
      data: {
        seasonId: this.hooks.seasonId,
        round: this.roundNumber,
        kind: this.state.round.kind === "finale" ? "finale" : "save",
        opensAt: new Date(),
        closesAt,
        nomineeIds: JSON.stringify(this.slate.map((m) => m.key)),
      },
    });
    this.windowId = window.id;
    this.votes.clear();
    this.state.round.votingOpen = true;
    this.state.round.voteEndsAt = closesAt.getTime();
    this.clearTimer();
    this.voteTimer = this.clock.setTimeout(() => {
      this.enqueue(() => this.lockVoting("time"));
    }, seconds * 1000);

    const finale = this.state.round.kind === "finale";
    const length = seconds === 60 ? "1 minute" : `${seconds / 60} minutes`;
    this.hooks.announce(
      finale
        ? `The finale vote is open for ${length}. Vote for who you want to win.`
        : `Voting is open for ${length}. Vote to save the nominee you want to stay.`,
    );
    this.hooks.log("vote", `Voting opened (${finale ? "finale" : "save"}, ${length}): ${this.slate.map((m) => m.name).join(", ")}`);
    this.pushAdmin();
  }

  private async lockVoting(reason: "time" | "admin"): Promise<void> {
    if (!this.state.round.votingOpen) {
      if (reason === "admin") this.tell("Voting isn't open.");
      return;
    }
    this.state.round.votingOpen = false;
    this.state.round.voteEndsAt = Date.now();
    this.clearTimer();
    if (this.windowId) await db.voteWindow.update({ where: { id: this.windowId }, data: { closesAt: new Date() } });
    const finale = this.state.round.kind === "finale";
    this.hooks.announce(
      finale
        ? "The finale vote is closed. The winner stays secret until the reveal."
        : "Voting is closed. The result stays secret until the eviction.",
    );
    this.hooks.log("vote", `Voting closed (${reason}). ${this.votes.size} vote(s) cast.`);
    this.pushAdmin();
  }

  private async doVote(sessionId: string, token: string): Promise<void> {
    const viewer = this.hooks.viewer(sessionId);
    if (!viewer) {
      this.ack(sessionId, false, "Sign in to vote, then start watching again. Each account gets one vote.");
      return;
    }
    if (!this.state.round.votingOpen || !this.windowId) {
      this.ack(sessionId, false, "Voting isn't open.");
      return;
    }
    const member = this.slate.find((m) => m.token === token);
    if (!member) {
      this.ack(sessionId, false, "That isn't someone you can vote for.");
      return;
    }
    if (this.votes.has(viewer.userId)) {
      this.ack(sessionId, false, "You've already voted.");
      return;
    }
    const housemate = await db.housemate.findUnique({
      where: { userId_seasonId: { userId: viewer.userId, seasonId: this.hooks.seasonId } },
    });
    if (housemate && (housemate.status === "active" || housemate.status === "winner")) {
      this.ack(sessionId, false, "Housemates don't vote — the viewers decide.");
      return;
    }
    const extra = await extraVotes(viewer.userId, this.windowId);
    try {
      await db.vote.create({
        data: {
          voteWindowId: this.windowId,
          userId: viewer.userId,
          nomineeId: member.key,
          weight: 1 + extra,
          paid: extra > 0,
        },
      });
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
      this.votes.set(viewer.userId, member.key);
      this.ack(sessionId, false, "You've already voted.");
      return;
    }
    this.votes.set(viewer.userId, member.key);
    const finale = this.state.round.kind === "finale";
    this.ack(sessionId, true, finale ? `You voted for ${member.name} to win.` : `You voted to save ${member.name}.`, member.token);
    // The log records that they voted, not who for — the result stays secret until the reveal.
    this.hooks.log("vote", `${viewer.name} voted (${this.votes.size} so far)`);
    this.pushAdmin();
  }

  private async doReveal(token: string): Promise<void> {
    if (this.step() !== "ready-to-reveal") return this.tell("Close voting before revealing the result.");
    const finale = this.state.round.kind === "finale";
    const totals = this.slate.map((member) => ({ member, n: this.count(member.key) }));
    if (totals.length === 0) return this.tell("There's nobody on the slate.");
    const extreme = finale ? Math.max(...totals.map((t) => t.n)) : Math.min(...totals.map((t) => t.n));
    const tied = totals.filter((t) => t.n === extreme);
    let chosen = tied.length === 1 ? tied[0] : tied.find((t) => t.member.token === token);
    if (!chosen) {
      this.pendingTie = tied.map((t) => t.member);
      this.pushAdmin(finale ? "It's a tie. Choose the winner." : "It's a tie. Choose who is evicted.");
      return;
    }
    this.pendingTie = [];
    this.publish(true);
    if (this.windowId) await db.voteWindow.update({ where: { id: this.windowId }, data: { revealedAt: new Date() } });
    const summary = totals.map((t) => `${t.member.name} ${t.n}`).join(", ");
    if (finale) {
      this.hooks.log("finale", `Finale result: ${summary}. Winner: ${chosen.member.name}`);
      await this.crown(chosen.member);
    } else {
      this.hooks.log("eviction", `Vote result: ${summary}. Evicted: ${chosen.member.name}`);
      await this.evict(chosen.member);
    }
  }

  private async evict(member: SlateMember): Promise<void> {
    this.evictionSettled = false;
    this.state.round.evictedName = member.name;
    this.state.round.phase = "eviction";
    this.state.round.votingOpen = false;
    await this.setStatus(member.key, "evicted");
    this.hooks.announce(`${member.name} has been evicted.`);
    const sessionId = this.sessionForKey(member.key);
    if (sessionId && this.state.players.has(sessionId)) this.beginExit(sessionId);
    else await this.afterEviction();
    this.pushAdmin();
  }

  /**
   * Jump them to the garden door, then walk south. A path through every room
   * would get stuck on furniture; this one is a straight clear line.
   */
  private beginExit(sessionId: string): void {
    if (this.state.diaryHousemate === sessionId) this.hooks.endDiary();
    const player = this.state.players.get(sessionId);
    if (!player) {
      this.enqueue(() => this.afterEviction());
      return;
    }
    this.hooks.standUp(player);
    player.x = EXIT_FROM.x;
    player.z = EXIT_FROM.z;
    player.rotY = 0;
    player.anim = "walk";
    player.exiting = true;
    player.area = areaAt(player.x, player.z)?.id ?? "garden";
    this.exiting = { sessionId, ticks: 0 };
  }

  private async afterEviction(): Promise<void> {
    if (this.evictionSettled) return;
    this.evictionSettled = true;
    this.state.round.phase = "free";
    const crowned = await this.crownIfAlone();
    if (!crowned) this.pushAdmin();
  }

  /** When one housemate is left, they win without another vote. */
  private async crownIfAlone(): Promise<boolean> {
    const guests = this.people().filter((p) => p.key.startsWith("guest:"));
    const rows = await db.housemate.findMany({ where: { seasonId: this.hooks.seasonId, status: "active" } });
    if (guests.length + rows.length !== 1) return false;
    if (guests.length === 1) {
      const guest = guests[0];
      if (!guest) return false;
      await this.crown({ key: guest.key, name: guest.name, color: guest.color, token: "" });
      return true;
    }
    const row = rows[0];
    if (!row) return false;
    const person = this.people().find((p) => p.key === row.userId);
    const app = await db.application.findUnique({
      where: { userId_seasonId: { userId: row.userId, seasonId: this.hooks.seasonId } },
    });
    await this.crown({
      key: row.userId,
      name: person?.name ?? app?.displayName ?? "Housemate",
      color: person?.color ?? "#ffd76a",
      token: "",
    });
    return true;
  }

  private async crown(member: SlateMember): Promise<void> {
    this.state.round.phase = "finale";
    this.state.round.winnerName = member.name;
    this.state.round.winnerColor = member.color;
    this.state.round.votingOpen = false;
    await this.setStatus(member.key, "winner");
    this.hooks.announce(`${member.name} wins the season!`);
    this.hooks.log("finale", `${member.name} won the season`);
    this.pushAdmin();
  }

  // ---------------------------------------------------------------- helpers

  private people(): Person[] {
    return [...this.state.players.values()].map((p) => ({
      sessionId: p.id,
      key: this.keyFor(p.id),
      name: p.name,
      color: p.color,
      perks: [...p.perks],
    }));
  }

  /** Account id for a real housemate; `guest:<session>` for a development bot with no account. */
  private keyFor(sessionId: string): string {
    return this.hooks.userId(sessionId) ?? `guest:${sessionId}`;
  }

  private sessionForKey(key: string): string | undefined {
    for (const p of this.state.players.values()) {
      if (this.keyFor(p.id) === key) return p.id;
    }
    return undefined;
  }

  private eligibleTargets(sessionId: string): Person[] {
    return this.people().filter((p) => p.sessionId !== sessionId && !p.perks.includes("immunity"));
  }

  /** 2 with Extra nomination power, otherwise 1, and never more people than can actually be nominated. */
  private slotsFor(sessionId: string): number {
    const me = this.people().find((p) => p.sessionId === sessionId);
    if (!me) return 0;
    const power = me.perks.includes("nominationPower") ? 2 : 1;
    return Math.min(power, this.eligibleTargets(sessionId).length);
  }

  private rankedSlate(): SlateMember[] {
    const counts = new Map<string, { n: number; name: string; color: string }>();
    for (const picks of this.ballots.values()) {
      for (const pick of picks) {
        const person = this.people().find((p) => p.key === pick.key);
        if (!person || person.perks.includes("immunity")) continue;
        const prev = counts.get(pick.key);
        counts.set(pick.key, { n: (prev?.n ?? 0) + 1, name: person.name, color: person.color });
      }
    }
    const ids = slateFromCounts(
      [...counts.entries()].map(([id, c]) => ({ id, n: c.n })),
      NOMINATION_SLATE_SIZE,
    );
    return ids.flatMap((id) => {
      const row = counts.get(id);
      return row ? [{ key: id, name: row.name, color: row.color, token: "" }] : [];
    });
  }

  private assignTokens(): void {
    this.slate.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    this.slate.forEach((m, i) => (m.token = String(i + 1)));
  }

  private publish(reveal: boolean): void {
    this.clearNominees();
    for (const m of this.slate) {
      const nominee = new Nominee();
      nominee.token = m.token;
      nominee.playerId = this.sessionForKey(m.key) ?? "";
      nominee.name = m.name;
      nominee.color = m.color;
      nominee.votes = reveal ? this.count(m.key) : VOTES_HIDDEN;
      this.state.round.nominees.push(nominee);
    }
  }

  private refreshPresence(): void {
    for (const nominee of this.state.round.nominees) {
      const member = this.slate.find((m) => m.token === nominee.token);
      if (!member) continue;
      const sessionId = this.sessionForKey(member.key) ?? "";
      if (nominee.playerId !== sessionId) nominee.playerId = sessionId;
    }
  }

  private count(key: string): number {
    let n = 0;
    for (const nomineeKey of this.votes.values()) if (nomineeKey === key) n++;
    return n;
  }

  private clearNominees(): void {
    while (this.state.round.nominees.length > 0) this.state.round.nominees.pop();
  }

  private async dropPerk(sessionId: string, perk: "immunity" | "nominationPower"): Promise<void> {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const index = player.perks.indexOf(perk);
    if (index < 0) return;
    player.perks.splice(index, 1);
    await this.hooks.persistPerks(sessionId);
  }

  private async setStatus(key: string, status: "evicted" | "winner"): Promise<void> {
    if (key.startsWith("guest:")) return;
    try {
      await db.housemate.update({
        where: { userId_seasonId: { userId: key, seasonId: this.hooks.seasonId } },
        data: status === "evicted" ? { status, evictedAt: new Date() } : { status },
      });
    } catch (err) {
      console.error("[round] couldn't update housemate status", err);
    }
  }

  private sendStatus(sessionId: string): void {
    if (!this.state.players.has(sessionId)) return;
    const ballot = this.ballots.get(this.keyFor(sessionId));
    const message: NominationStatusMessage = {
      open: this.collecting,
      slots: this.slotsFor(sessionId),
      submitted: !!ballot,
      pickedNames: ballot?.map((p) => p.name) ?? [],
      choices: this.people()
        .filter((p) => p.sessionId !== sessionId)
        .map((p) => ({ id: p.sessionId, name: p.name, immune: p.perks.includes("immunity") })),
    };
    this.hooks.send(sessionId, Msg.nominationStatus, message);
  }

  private ack(sessionId: string, ok: boolean, text: string, token = ""): void {
    const message: VoteAckMessage = { ok, text, token };
    this.hooks.send(sessionId, Msg.voteAck, message);
  }

  private step(): RoundStep {
    if (this.state.round.winnerName) return "crowned";
    if (this.state.round.phase === "eviction" || this.exiting) return "evicting";
    if (this.state.round.phase === "nominations") return this.bbFill ? "needs-nominee" : "nominating";
    if (this.state.round.phase === "voting") {
      if (this.state.round.votingOpen) return "voting";
      if (this.state.round.voteEndsAt > 0) return "ready-to-reveal";
      return "ready-to-vote";
    }
    return "idle";
  }

  private describe(override?: string): string {
    if (override) return override;
    const names = this.slate.map((m) => m.name);
    switch (this.step()) {
      case "nominating":
        return `Nominations are private. ${this.ballots.size} of ${this.people().length} in the house have nominated. Call each one to the Diary Room.`;
      case "needs-nominee":
        return names.length
          ? `${joinNames(names)} ${names.length === 1 ? "was" : "were"} nominated. Add one more to face the vote.`
          : "Nobody was nominated. Choose two housemates to face the vote.";
      case "ready-to-vote":
        return this.state.round.kind === "finale"
          ? `Finale: ${joinNames(names)}. Open the vote when you're ready.`
          : `Up for eviction: ${joinNames(names)}. Open the vote when you're ready.`;
      case "voting":
        return `Voting is open. ${this.votes.size} vote(s) so far — who they voted for stays hidden.`;
      case "ready-to-reveal":
        return `Voting is closed. ${this.votes.size} vote(s). Reveal the result when you're ready.`;
      case "evicting":
        return `${this.state.round.evictedName} is leaving the house.`;
      case "crowned":
        return `${this.state.round.winnerName} wins the season.`;
      default:
        return "No ceremony running. Nominations need 3 or more housemates in the house; the final two go to a finale vote.";
    }
  }

  private tell(text: string): void {
    this.pushAdmin(text);
  }

  private pushAdmin(override?: string): void {
    const step = this.step();
    const canAdd: RoundChoice[] =
      step === "needs-nominee"
        ? this.people()
            .filter((p) => !p.perks.includes("immunity") && !this.slate.some((m) => m.key === p.key))
            .map((p) => ({ id: p.sessionId, name: p.name }))
        : [];
    const view: RoundAdminView = {
      step,
      text: this.describe(override),
      kind: this.state.round.kind,
      votesCast: this.votes.size,
      ballots:
        step === "nominating" || step === "needs-nominee"
          ? this.people().map((p) => ({
              name: p.name,
              picks: (this.ballots.get(p.key) ?? []).map((pick) => pick.name),
            }))
          : [],
      canAdd,
      tie: step === "ready-to-reveal" ? this.pendingTie.map((m) => ({ id: m.token, name: m.name })) : [],
    };
    this.hooks.sendAdmin(view);
  }

  private clearTimer(): void {
    this.voteTimer?.clear();
    this.voteTimer = null;
  }

  /** One ceremony action at a time, so two clicks can't open two voting windows. */
  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue.then(fn).catch((err) => {
      console.error("[round]", err);
      this.tell("Something went wrong running that. Check the server log.");
    });
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "nobody";
  const last = names[names.length - 1] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${last}`;
}

function isUniqueConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}
