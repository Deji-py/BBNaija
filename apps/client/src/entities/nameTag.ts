import * as THREE from "three";

/** A camera-facing text label drawn to a small canvas texture. */
export function createNameTag(text: string): THREE.Sprite {
  const font = "600 36px system-ui, -apple-system, sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const padX = 18;
  canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.height = 56;

  // Resizing the canvas resets its context state, so set the font again.
  ctx.font = font;
  ctx.fillStyle = "rgba(15, 15, 25, 0.6)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  const height = 0.28;
  sprite.scale.set((canvas.width / canvas.height) * height, height, 1);
  return sprite;
}
