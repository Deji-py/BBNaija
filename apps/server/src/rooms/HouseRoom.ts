import { Room, type Client } from "colyseus";
import {
  AVATAR_COLORS,
  MAX_HOUSEMATES,
  Msg,
  NAME_MAX_LENGTH,
  SPAWN_POINT,
  TICK_RATE_HZ,
  applyInputStep,
  areaAt,
  type InputMessage,
  type JoinOptions,
} from "@bbn/shared";
import { HouseState, Player } from "../schema/HouseState.js";

/** Inputs a client may have waiting before we start dropping them. */
const MAX_QUEUED_INPUTS = 10;
/**
 * Movement budget: each tick grants one input step, and unused steps bank up
 * to this many. Makes it impossible to move faster than walking speed on
 * average, however fast a (modified) client sends inputs.
 */
const MAX_INPUT_CREDIT = 4;
/**
 * Jitter buffer: inputs arrive unevenly (network timing, client frame timing),
 * but we want each player to move exactly one step per tick. So we normally
 * apply one queued input per tick, and only apply a second when more than this
 * many are waiting (catch-up after a delay). A late packet is then absorbed by
 * the input already waiting, instead of causing a pause followed by a double step.
 */
const JITTER_BUFFER_TARGET = 2;
/** Ticks a player keeps the "walk" animation after their last step, so it doesn't flicker. */
const WALK_GRACE_TICKS = 2;

interface PlayerSim {
  queue: InputMessage[];
  credit: number;
  ticksSinceStep: number;
}

/**
 * One live house. The server is authoritative: clients only send *inputs*
 * ("I want to move this way"), the server applies them with the shared
 * collision code and broadcasts the resulting positions.
 */
export class HouseRoom extends Room<{ state: HouseState }> {
  override maxClients = MAX_HOUSEMATES;
  override state = new HouseState();
  override patchRate = 1000 / TICK_RATE_HZ;
  override maxMessagesPerSecond = 60;

  private readonly sims = new Map<string, PlayerSim>();

  override onCreate(): void {
    this.onMessage(Msg.input, (client, message: unknown) => {
      const input = parseInput(message);
      const sim = this.sims.get(client.sessionId);
      if (!input || !sim) return;
      if (sim.queue.length >= MAX_QUEUED_INPUTS) return;
      sim.queue.push(input);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE_HZ);
    console.log(`[house ${this.roomId}] created`);
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(options.name);
    player.color = sanitizeColor(options.color);

    // Spread spawns in a small circle so new arrivals don't stack on top of each other.
    const angle = (this.state.players.size / MAX_HOUSEMATES) * Math.PI * 2;
    player.x = SPAWN_POINT.x + Math.sin(angle) * 1.2;
    player.z = SPAWN_POINT.z + Math.cos(angle) * 1.2;
    player.rotY = Math.PI;
    player.anim = "idle";
    player.area = areaAt(player.x, player.z)?.id ?? "";
    player.lastSeq = 0;

    this.state.players.set(client.sessionId, player);
    this.sims.set(client.sessionId, { queue: [], credit: MAX_INPUT_CREDIT, ticksSinceStep: WALK_GRACE_TICKS });
    console.log(`[house ${this.roomId}] ${player.name} joined (${this.state.players.size}/${this.maxClients})`);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sims.delete(client.sessionId);
    console.log(`[house ${this.roomId}] ${player?.name ?? client.sessionId} left`);
  }

  override onDispose(): void {
    console.log(`[house ${this.roomId}] disposed`);
  }

  /** One server tick: apply queued inputs to each player within their movement budget. */
  private tick(): void {
    for (const [id, sim] of this.sims) {
      const player = this.state.players.get(id);
      if (!player) continue;

      sim.credit = Math.min(sim.credit + 1, MAX_INPUT_CREDIT);
      let pos = { x: player.x, z: player.z };

      const steps = sim.queue.length > JITTER_BUFFER_TARGET ? 2 : 1;
      for (let i = 0; i < steps && sim.credit >= 1 && sim.queue.length > 0; i++) {
        const input = sim.queue.shift()!;
        sim.credit -= 1;
        pos = applyInputStep(pos, input.dx, input.dz);
        if (input.dx !== 0 || input.dz !== 0) {
          player.rotY = Math.atan2(input.dx, input.dz);
          sim.ticksSinceStep = -1;
        }
        player.lastSeq = input.seq;
      }
      sim.ticksSinceStep++;

      if (pos.x !== player.x) player.x = pos.x;
      if (pos.z !== player.z) player.z = pos.z;
      const anim = sim.ticksSinceStep < WALK_GRACE_TICKS ? "walk" : "idle";
      if (player.anim !== anim) player.anim = anim;
      const area = areaAt(pos.x, pos.z)?.id ?? "";
      if (player.area !== area) player.area = area;
    }
  }
}

function parseInput(message: unknown): InputMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { seq, dx, dz } = message as Record<string, unknown>;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof dx !== "number" || typeof dz !== "number") return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  return { seq, dx, dz };
}

function sanitizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/[\p{C}]/gu, "").trim().slice(0, NAME_MAX_LENGTH) : "";
  return name || "Housemate";
}

function sanitizeColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : AVATAR_COLORS[0];
}
