/** Thumb inside this fraction of the stick's reach doesn't move you (no drift from a resting thumb). */
const DEAD_ZONE = 0.18;
/** Pushing the stick out this far (fraction of its reach) runs. */
const RUN_AT = 0.92;

/** True on phones and tablets: a touch screen is the main pointer. */
export function isTouchDevice(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

/**
 * On-screen controls for touch screens: a thumbstick (bottom left) that walks,
 * and runs when pushed to the edge, plus a jump button. The "Use" action is the
 * HUD prompt itself (tap it); the camera turns by dragging the scene.
 * Does nothing on devices with a mouse.
 */
export class TouchControls {
  readonly enabled = isTouchDevice();
  private forward = 0;
  private right = 0;
  private run = false;

  constructor(parent: HTMLElement, handlers: { onJump: () => void }) {
    if (!this.enabled) return;
    const root = document.createElement("div");
    root.className = "touch-controls";

    const stick = document.createElement("div");
    stick.className = "touch-stick";
    stick.setAttribute("aria-hidden", "true");
    const knob = document.createElement("div");
    knob.className = "touch-knob";
    stick.append(knob);

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "touch-jump";
    jump.setAttribute("aria-label", "Jump");
    jump.textContent = "⤒";
    jump.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onJump();
    });

    root.append(stick, jump);
    parent.append(root);

    let finger: number | null = null;
    const steer = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const reach = r.width / 2;
      let dx = e.clientX - (r.left + reach);
      let dy = e.clientY - (r.top + reach);
      const len = Math.hypot(dx, dy);
      if (len > reach) {
        dx *= reach / len;
        dy *= reach / len;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const amount = Math.min(len / reach, 1);
      this.run = amount >= RUN_AT;
      stick.classList.toggle("running", this.run);
      if (amount < DEAD_ZONE) {
        this.forward = this.right = 0;
        return;
      }
      this.forward = -dy / reach;
      this.right = dx / reach;
    };
    const release = () => {
      finger = null;
      this.forward = this.right = 0;
      this.run = false;
      knob.style.transform = "";
      stick.classList.remove("active", "running");
    };
    stick.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (finger !== null) return;
      finger = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stick.classList.add("active");
      steer(e);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === finger) steer(e);
    });
    stick.addEventListener("pointerup", (e) => e.pointerId === finger && release());
    stick.addEventListener("pointercancel", (e) => e.pointerId === finger && release());
    window.addEventListener("blur", release);
  }

  /** Same shape as Keyboard.moveAxes: `forward` +1 = away from the camera, `right` +1 = to its right. */
  moveAxes(): { forward: number; right: number } {
    return { forward: this.forward, right: this.right };
  }

  get running(): boolean {
    return this.run;
  }
}
