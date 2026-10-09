import * as THREE from "three";

export type VoiceIconState = "speaking" | "muted" | "none";

let textures: Record<"speaking" | "muted", THREE.CanvasTexture> | null = null;

/** Small round badge drawn once to a canvas and shared by every avatar. */
function getTextures() {
  textures ??= { speaking: drawIcon("speaking"), muted: drawIcon("muted") };
  return textures;
}

function drawIcon(kind: "speaking" | "muted"): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = kind === "speaking" ? "#2fbf71" : "#d64545";
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();

  // Microphone glyph.
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.roundRect(25, 14, 14, 24, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(32, 30, 13, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(32, 43);
  ctx.lineTo(32, 50);
  ctx.stroke();

  if (kind === "muted") {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(16, 16);
    ctx.lineTo(48, 48);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Badge shown above a housemate's name tag: green while speaking, red when muted. */
export class VoiceIcon {
  readonly sprite: THREE.Sprite;
  private state: VoiceIconState = "none";
  private time = 0;

  constructor() {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
    this.sprite.scale.setScalar(0.3);
    this.sprite.visible = false;
  }

  set(state: VoiceIconState): void {
    if (state === this.state) return;
    this.state = state;
    this.sprite.visible = state !== "none";
    if (state !== "none") {
      this.sprite.material.map = getTextures()[state];
      this.sprite.material.needsUpdate = true;
    }
    this.sprite.scale.setScalar(0.3);
  }

  /** Gentle pulse while speaking. */
  update(dt: number): void {
    if (this.state !== "speaking") return;
    this.time += dt;
    this.sprite.scale.setScalar(0.3 + Math.abs(Math.sin(this.time * 8)) * 0.05);
  }

  dispose(): void {
    // Textures are shared between all icons; only the per-icon material is freed.
    this.sprite.material.dispose();
  }
}
