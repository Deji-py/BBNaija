import * as THREE from "three";

/**
 * Original pictures for the house, painted here so nothing is copied from a
 * photo. Green and white follow the Nigerian flag. The portrait is a made-up
 * figure, not a real person. The crest is house art, not the national coat of arms.
 */
const painters: Record<string, (g: CanvasRenderingContext2D) => void> = {
  "frame-flag": (g) => {
    g.fillStyle = "#008751";
    g.fillRect(0, 0, 86, 256);
    g.fillStyle = "#ffffff";
    g.fillRect(86, 0, 84, 256);
    g.fillStyle = "#008751";
    g.fillRect(170, 0, 86, 256);
  },
  "frame-state-house": (g) => {
    g.fillStyle = "#008751";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#ffffff";
    g.fillRect(78, 0, 100, 256);
    g.fillStyle = "#008751";
    g.fillRect(98, 28, 60, 22);
    g.beginPath();
    g.arc(128, 92, 28, 0, Math.PI * 2);
    g.fillStyle = "#8d5524";
    g.fill();
    g.fillStyle = "#f4efe4";
    g.beginPath();
    g.moveTo(70, 250);
    g.lineTo(108, 150);
    g.lineTo(148, 150);
    g.lineTo(186, 250);
    g.fill();
    g.fillStyle = "#008751";
    g.fillRect(118, 168, 20, 82);
  },
  "frame-crest": (g) => {
    g.fillStyle = "#f4efe4";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#008751";
    g.beginPath();
    g.moveTo(128, 36);
    g.lineTo(200, 78);
    g.lineTo(184, 190);
    g.lineTo(128, 224);
    g.lineTo(72, 190);
    g.lineTo(56, 78);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(128, 78);
    g.lineTo(146, 124);
    g.lineTo(196, 124);
    g.lineTo(156, 152);
    g.lineTo(172, 200);
    g.lineTo(128, 172);
    g.lineTo(84, 200);
    g.lineTo(100, 152);
    g.lineTo(60, 124);
    g.lineTo(110, 124);
    g.closePath();
    g.fill();
  },
  "frame-market": (g) => {
    g.fillStyle = "#f6e7c1";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#c23b22";
    for (const [x, y] of [[70, 150], [120, 170], [160, 140], [100, 110]] as const) blob(g, x, y, 28);
    g.fillStyle = "#e85d04";
    for (const [x, y] of [[180, 180], [90, 190], [150, 100]] as const) blob(g, x, y, 16);
    g.fillStyle = "#2d6a4f";
    g.fillRect(40, 70, 170, 14);
    g.fillRect(70, 48, 14, 40);
    g.fillRect(160, 40, 14, 48);
  },
  "frame-pattern": (g) => {
    g.fillStyle = "#1b4332";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? "#f4efe4" : "#e9c46a";
        g.beginPath();
        g.moveTo(x * 32 + 16, y * 32 + 4);
        g.lineTo(x * 32 + 28, y * 32 + 28);
        g.lineTo(x * 32 + 4, y * 32 + 28);
        g.fill();
      }
    }
  },
};

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

const cache = new Map<string, THREE.CanvasTexture>();

export function artTexture(id: string): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  if (g) (painters[id] ?? painters["frame-pattern"]!)(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  cache.set(id, texture);
  return texture;
}
