import {
  INPUT_STEP_SEC,
  WALK_SPEED,
  applyInputStep,
  moveWithCollision,
  type InputMessage,
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

  constructor(
    start: Vec2,
    private readonly send: (input: InputMessage) => void,
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
    const partial = WALK_SPEED * this.accumulator;
    return moveWithCollision(this.predicted, dx * partial, dz * partial);
  }

  /** Called whenever the server sends a new authoritative state for us. */
  reconcile(serverX: number, serverZ: number, lastSeq: number): void {
    this.pending = this.pending.filter((input) => input.seq > lastSeq);
    let pos: Vec2 = { x: serverX, z: serverZ };
    for (const input of this.pending) pos = applyInputStep(pos, input.dx, input.dz);
    this.predicted = pos;
  }

  private step(): void {
    const { dx, dz } = this.dir;
    if (dx === 0 && dz === 0) return; // standing still: nothing to send
    const input: InputMessage = { seq: ++this.seq, dx, dz };
    this.pending.push(input);
    this.predicted = applyInputStep(this.predicted, dx, dz);
    this.send(input);
  }
}
