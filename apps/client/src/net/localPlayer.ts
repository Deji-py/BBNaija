import {
  COLLIDERS,
  INPUT_STEP_SEC,
  applyInputStep,
  type Box2D,
  type InputMessage,
  type MoveMode,
  type Vec2,
} from "@bbn/shared";

/**
 * Client-side prediction for the local player.
 *
 * The server is the authority on where everyone is, but waiting a round trip
 * before your own avatar moves feels sluggish. So we:
 *   1. turn input into fixed 50 ms steps, apply each one locally right away,
 *      and send it to the server with an increasing `seq` number;
 *   2. when the server reports our position plus the last `seq` it applied,
 *      start from that authoritative position and re-apply the steps it hasn't
 *      processed yet ("reconciliation").
 * Both sides run the same `applyInputStep`, so normally the result is exactly
 * where we already were and the correction is invisible.
 */
export class LocalPlayerController {
  private seq = 0;
  private pending: InputMessage[] = [];
  private predicted: Vec2;
  private accumulator = 0;
  private dir = { dx: 0, dz: 0 };
  /**
   * While we're using an object (sitting, in bed…), where we'll stand when we
   * next move. The server does the same "stand up, then step" on our first
   * movement input, so predicting it keeps getting up instant and correction-free.
   */
  private exit: Vec2 | null = null;

  constructor(
    start: Vec2,
    private readonly send: (input: InputMessage) => void,
    private readonly colliders: () => readonly Box2D[] = () => COLLIDERS,
    /** Walking, running (Shift) or swimming, decided by the caller each step. */
    private readonly mode: () => MoveMode = () => "walk",
  ) {
    this.predicted = { ...start };
  }

  /**
   * Advance by one rendered frame. Returns the position to draw this frame:
   * the latest predicted step plus the partial step since then, so movement is
   * smooth at any frame rate even though steps happen at 20 Hz.
   */
  update(dt: number, dx: number, dz: number): Vec2 {
    this.dir = { dx, dz };
    this.accumulator += dt;
    while (this.accumulator >= INPUT_STEP_SEC) {
      this.accumulator -= INPUT_STEP_SEC;
      this.step();
    }
    if (dx === 0 && dz === 0) return { ...this.predicted };
    // Draw the partial step since the last input, at this mode's speed.
    const fraction = this.accumulator / INPUT_STEP_SEC;
    const base = this.exit ?? this.predicted; // about to stand up: draw from where we'll stand
    const mode = this.mode();
    return applyInputStep(base, dx * fraction, dz * fraction, this.colliders(), mode);
  }

  /**
   * Called whenever the server sends a new authoritative state for us.
   * `exit` is where we'd stand up to if the server has us using an object.
   */
  reconcile(serverX: number, serverZ: number, lastSeq: number, exit: Vec2 | null): void {
    this.pending = this.pending.filter((input) => input.seq > lastSeq);
    let pos: Vec2 = { x: serverX, z: serverZ };
    let pendingExit = exit;
    for (const input of this.pending) {
      if (pendingExit) {
        pos = pendingExit;
        pendingExit = null;
      }
      pos = applyInputStep(pos, input.dx, input.dz, this.colliders(), this.modeFor(input));
    }
    this.predicted = pos;
    this.exit = pendingExit;
  }

  private step(): void {
    const { dx, dz } = this.dir;
    if (dx === 0 && dz === 0) return; // standing still: nothing to send
    const mode = this.mode();
    const input: InputMessage = mode === "run" ? { seq: ++this.seq, dx, dz, run: true } : { seq: ++this.seq, dx, dz };
    this.pending.push(input);
    if (this.exit) {
      this.predicted = this.exit;
      this.exit = null;
    }
    this.predicted = applyInputStep(this.predicted, dx, dz, this.colliders(), mode);
    this.send(input);
  }

  /** Mode to replay a pending input with: swimming is a state we're in, running was chosen per input. */
  private modeFor(input: InputMessage): MoveMode {
    const now = this.mode();
    if (now === "swim") return "swim";
    return input.run ? "run" : "walk";
  }
}
