/** Tracks which keys are currently held down, by `KeyboardEvent.code`. */
export class Keyboard {
  private readonly down = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    // Releasing keys while the window is unfocused never fires keyup; clear to avoid "stuck" keys.
    window.addEventListener("blur", () => this.down.clear());
    // Same when focus moves into a text field (e.g. chat): stop walking.
    document.addEventListener("focusin", (e) => {
      if (isTypingTarget(e.target)) this.down.clear();
    });
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /**
   * Movement intent from WASD / arrow keys, in "screen" terms:
   * `forward` +1 = away from the camera, `right` +1 = to the camera's right.
   */
  moveAxes(): { forward: number; right: number } {
    const forward = (this.isDown("KeyW", "ArrowUp") ? 1 : 0) - (this.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const right = (this.isDown("KeyD", "ArrowRight") ? 1 : 0) - (this.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    return { forward, right };
  }
}

/** True when a key event comes from a text field, where keys type text instead of controlling the game. */
export function isTyping(e: KeyboardEvent): boolean {
  return isTypingTarget(e.target);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
