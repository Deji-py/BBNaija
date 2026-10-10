import * as THREE from "three";
import { GAMES, GAME_STATIONS, STATION_BY_ID, type GameId, type HouseStateView } from "@bbn/shared";
import { box, mat } from "./materials.js";

/**
 * 3D look of the games hall: a model per station kind (game tables show their
 * board on top, cabinets glow with their game's title), and a floating sign over
 * each station that says what it is and whether a game is on.
 */

const STATION_KINDS = new Set(["gameTable", "arcade", "poolTable", "snookerTable", "airHockey", "dartboard"]);

export function isStationKind(kind: string): boolean {
  return STATION_KINDS.has(kind);
}

/** Cabinet colours, one per arcade game. */
const CABINET: Partial<Record<GameId, number>> = {
  pong: 0x1d3557,
  tron: 0x0b132b,
  trivia: 0x7b2cbf,
  hangman: 0x264653,
  memory: 0xe76f51,
  rps: 0xd62828,
  codebreaker: 0x2a9d8f,
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A picture of the game's board, printed on its table top. */
function tableTop(game: GameId): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const S = 256;
    const grid = (n: number, light: string, dark: string | null, line?: string) => {
      const c = S / n;
      for (let r = 0; r < n; r++)
        for (let k = 0; k < n; k++) {
          ctx.fillStyle = dark && (r + k) % 2 ? dark : light;
          ctx.fillRect(k * c, r * c, c, c);
        }
      if (line) {
        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        for (let i = 0; i <= n; i++) {
          ctx.beginPath();
          ctx.moveTo(i * c, 0);
          ctx.lineTo(i * c, S);
          ctx.moveTo(0, i * c);
          ctx.lineTo(S, i * c);
          ctx.stroke();
        }
      }
    };
    const stones = (cells: Array<[number, number, string]>, n: number) => {
      const c = S / n;
      for (const [r, k, color] of cells) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc((k + 0.5) * c, (r + 0.5) * c, c * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    switch (game) {
      case "chess":
        grid(8, "#f0d9b5", "#b58863");
        break;
      case "checkers":
        grid(8, "#f4e1c1", "#8b2a2a");
        stones([[0, 1, "#222"], [0, 3, "#222"], [1, 2, "#222"], [6, 1, "#e63946"], [7, 2, "#e63946"], [6, 5, "#e63946"]], 8);
        break;
      case "go":
      case "gomoku":
        ctx.fillStyle = "#dcb35c";
        ctx.fillRect(0, 0, S, S);
        grid(game === "go" ? 9 : 15, "#dcb35c", null, "#3b2a12");
        stones([[3, 3, "#111"], [4, 5, "#fff"], [5, 4, "#111"]], game === "go" ? 9 : 15);
        break;
      case "reversi":
        grid(8, "#1e7a46", null, "#0c3d22");
        stones([[3, 3, "#fff"], [4, 4, "#fff"], [3, 4, "#111"], [4, 3, "#111"]], 8);
        break;
      case "connect4":
        ctx.fillStyle = "#1d4ed8";
        ctx.fillRect(0, 0, S, S);
        stones([[5, 3, "#e63946"], [4, 3, "#f1c40f"], [5, 2, "#f1c40f"], [5, 4, "#e63946"]], 7);
        break;
      case "ludo": {
        const colors = ["#e63946", "#2a9d8f", "#f1c40f", "#1d4ed8"];
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, S, S);
        const q = S * 0.4;
        [[0, 0], [S - q, 0], [S - q, S - q], [0, S - q]].forEach(([x, y], i) => {
          ctx.fillStyle = colors[i]!;
          ctx.fillRect(x!, y!, q, q);
        });
        break;
      }
      case "snakes":
        grid(10, "#fde68a", "#86efac");
        ctx.strokeStyle = "#16a34a";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(60, 40);
        ctx.bezierCurveTo(140, 100, 40, 160, 120, 220);
        ctx.stroke();
        break;
      case "ayo":
        ctx.fillStyle = "#7c4a1e";
        ctx.fillRect(0, 0, S, S);
        stones(Array.from({ length: 12 }, (_, i): [number, number, string] => [i < 6 ? 2 : 3, i % 6, "#3b220c"]), 6);
        break;
      case "whot":
      case "blackjack":
        ctx.fillStyle = game === "whot" ? "#7a1f2b" : "#14532d";
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.translate(90 + i * 36, 120);
          ctx.rotate((i - 1) * 0.25);
          ctx.fillStyle = "#fff";
          ctx.fillRect(-24, -34, 48, 68);
          ctx.restore();
        }
        break;
      case "yacht":
      case "pig":
        ctx.fillStyle = "#14532d";
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < (game === "yacht" ? 5 : 1); i++) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(40 + i * 38, 110, 30, 30);
        }
        break;
      case "battleship":
        grid(10, "#1e3a8a", null, "#60a5fa");
        break;
      case "hex":
        ctx.fillStyle = "#f5f5f4";
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = "#e63946";
        ctx.fillRect(0, 0, S, 10);
        ctx.fillRect(0, S - 10, S, 10);
        ctx.fillStyle = "#1d4ed8";
        ctx.fillRect(0, 0, 10, S);
        ctx.fillRect(S - 10, 0, 10, S);
        break;
      case "morris":
        ctx.fillStyle = "#e9d5a1";
        ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = "#3b2a12";
        ctx.lineWidth = 4;
        for (const m of [24, 72, 120]) ctx.strokeRect(m, m, S - 2 * m, S - 2 * m);
        break;
      case "dots":
        ctx.fillStyle = "#fffbeb";
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = "#111";
        for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) ctx.fillRect(28 + k * 40, 28 + r * 40, 6, 6);
        break;
      default:
        grid(3, "#fef3c7", null, "#111");
    }
  });
}

function arcadeScreen(game: GameId): THREE.CanvasTexture {
  const def = GAMES[game];
  return canvasTexture(256, 192, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 192);
    g.addColorStop(0, "#111827");
    g.addColorStop(1, "#312e81");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 192);
    ctx.textAlign = "center";
    ctx.font = "64px system-ui, sans-serif";
    ctx.fillText(def.icon, 128, 90);
    ctx.fillStyle = "#67e8f9";
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.fillText(def.name.toUpperCase(), 128, 150, 236);
  });
}

function dartboardTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const c = 128;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(c, c, 128, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 20; i++) {
      const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
      const a1 = a0 + (18 * Math.PI) / 180;
      for (const [r0, r1, colors] of [
        [8, 96, ["#f5e6c8", "#1b1b1b"]],
        [96, 104, ["#e63946", "#2a9d8f"]],
      ] as const) {
        ctx.fillStyle = colors[i % 2]!;
        ctx.beginPath();
        ctx.arc(c, c, r1, a0, a1);
        ctx.arc(c, c, r0, a1, a0, true);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#2a9d8f";
    ctx.beginPath();
    ctx.arc(c, c, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(c, c, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Cue-sports table (pool or snooker): legs, rails, cloth, pockets and a few balls. */
function cueTable(g: THREE.Group, w: number, d: number, h: number, cloth: number, balls: number[]): void {
  const wood = 0x4a2c17;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.16, h - 0.14, 0.16, wood, sx * (w / 2 - 0.22), 0, sz * (d / 2 - 0.22)));
  g.add(box(w, 0.14, d, wood, 0, h - 0.14));
  g.add(box(w - 0.24, 0.02, d - 0.24, cloth, 0, h));
  for (const sz of [-1, 1]) g.add(box(w, 0.07, 0.12, wood, 0, h, sz * (d / 2 - 0.06)));
  for (const sx of [-1, 1]) g.add(box(0.12, 0.07, d, wood, sx * (w / 2 - 0.06), h));
  for (const sx of [-1, 0, 1])
    for (const sz of [-1, 1]) {
      const pocket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10), mat(0x0b0b0b));
      pocket.position.set(sx * (w / 2 - 0.13), h + 0.025, sz * (d / 2 - 0.13));
      g.add(pocket);
    }
  balls.forEach((color, i) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(color));
    const row = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2);
    const k = i - (row * (row + 1)) / 2;
    ball.position.set(w * 0.22 + row * 0.055, h + 0.05, (k - row / 2) * 0.062);
    g.add(ball);
  });
  const cueBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(0xffffff));
  cueBall.position.set(-w * 0.25, h + 0.05, 0);
  g.add(cueBall);
  // A cue and its rack on the rail.
  const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.017, 1.45, 6), mat(0xd9b38c));
  cue.rotation.z = Math.PI / 2;
  cue.position.set(0, h + 0.09, d / 2 - 0.06);
  g.add(cue);
}

/** Builds a station model in local space (front = +Z), or returns false if `kind` isn't a station. */
export function buildStationModel(g: THREE.Group, kind: string, w: number, d: number, h: number, id: string): boolean {
  const game = STATION_BY_ID.get(id)?.game;
  switch (kind) {
    case "gameTable": {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.62, w * 0.62, 0.06, 24), mat(0x3b2a1a));
      top.position.y = h - 0.03;
      top.castShadow = true;
      g.add(top);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, h - 0.06, 8), mat(0x1f1f1f));
      stem.position.y = (h - 0.06) / 2;
      g.add(stem);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.05, 16), mat(0x1f1f1f));
      foot.position.y = 0.025;
      g.add(foot);
      if (game) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.72, w * 0.72), new THREE.MeshStandardMaterial({ map: tableTop(game), roughness: 0.7 }));
        board.rotation.x = -Math.PI / 2;
        board.position.y = h + 0.002;
        g.add(board);
      }
      return true;
    }
    case "arcade": {
      const body = game ? (CABINET[game] ?? 0x222222) : 0x222222;
      g.add(box(w, 0.9, d, body));
      // Control panel sloping towards the player, then the screen box and marquee.
      const panel = box(w, 0.08, 0.38, 0x111111, 0, 0.9, d / 2 - 0.19);
      panel.rotation.x = 0.2;
      g.add(panel);
      for (const [x, color] of [
        [-0.25, 0xe63946],
        [0.12, 0x2a9d8f],
        [0.26, 0xf1c40f],
      ] as const) {
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), mat(color, { emissive: color }));
        btn.position.set(x, 1.0, d / 2 - 0.16);
        g.add(btn);
      }
      g.add(box(w, h - 0.9, d * 0.7, body, 0, 0.9, -d * 0.15));
      if (game) {
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.6), new THREE.MeshBasicMaterial({ map: arcadeScreen(game) }));
        screen.position.set(0, 1.38, d * 0.2 + 0.005);
        screen.rotation.x = -0.12;
        g.add(screen);
      }
      const marquee = box(w, 0.22, d * 0.75, 0x67e8f9, 0, h - 0.22, -d * 0.12);
      marquee.material = mat(0x67e8f9, { emissive: 0x0e7490 });
      g.add(marquee);
      return true;
    }
    case "poolTable":
      cueTable(g, w, d, h, 0x1d4e89, [0xf1c40f, 0x1d4ed8, 0xe63946, 0x7b2cbf, 0x111111, 0xf97316]);
      return true;
    case "snookerTable":
      cueTable(g, w, d, h, 0x1f7a4a, [0xc1121f, 0xc1121f, 0xc1121f, 0xc1121f, 0xc1121f, 0xc1121f]);
      return true;
    case "airHockey": {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.12, h - 0.15, 0.12, 0x222222, sx * (w / 2 - 0.12), 0, sz * (d / 2 - 0.12)));
      g.add(box(w, 0.15, d, 0x1f2937, 0, h - 0.15));
      g.add(box(w - 0.1, 0.02, d - 0.1, 0xf8fafc, 0, h));
      g.add(box(w - 0.1, 0.022, 0.02, 0xe63946, 0, h));
      for (const sz of [-1, 1]) g.add(box(0.4, 0.03, 0.04, 0x111111, 0, h, sz * (d / 2 - 0.06)));
      for (const [z, color] of [
        [-d / 3, 0x1d4ed8],
        [d / 3, 0xe63946],
      ] as const) {
        const mallet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), mat(color));
        mallet.position.set(0, h + 0.04, z);
        g.add(mallet);
      }
      return true;
    }
    case "dartboard": {
      // Back board on the wall, the dartboard, and the throwing line on the floor.
      g.add(box(1.0, 1.0, 0.04, 0x3b2a1a, 0, h - 0.5, -0.02));
      const board = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshStandardMaterial({ map: dartboardTexture(), roughness: 0.8 }));
      board.position.set(0, h, 0.02);
      g.add(board);
      const oche = box(0.9, 0.012, 0.05, 0xe63946, 0, 0, 2.37);
      oche.castShadow = false;
      g.add(oche);
      return true;
    }
  }
  return false;
}

/** Sign text: icon + name, and a status line while it's busy. */
function signTexture(game: GameId, status: string): THREE.CanvasTexture {
  const def = GAMES[game];
  return canvasTexture(512, 160, (ctx) => {
    ctx.fillStyle = "rgba(15, 12, 30, 0.82)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 152, 28);
    ctx.fill();
    ctx.strokeStyle = status === "playing" ? "#22c55e" : status === "waiting" ? "#f59e0b" : "#67e8f9";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "700 52px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${def.icon} ${def.name}`, 256, status ? 70 : 96, 480);
    if (status) {
      ctx.font = "600 36px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = status === "playing" ? "#86efac" : "#fcd34d";
      ctx.fillText(status === "playing" ? "● Game on — come watch" : "Waiting for players", 256, 124, 480);
    }
  });
}

/** Floating signs over every station, updated from the room's `stations` state. */
export class StationSigns {
  private readonly signs = new Map<string, { sprite: THREE.Sprite; status: string }>();

  constructor(scene: THREE.Scene) {
    for (const st of GAME_STATIONS) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(st.game, ""), depthWrite: false }));
      const height = 0.42;
      sprite.scale.set(height * (512 / 160), height, 1);
      const y = st.kind === "arcade" ? st.h + 0.45 : st.kind === "dartboard" ? st.h + 0.75 : st.h + 1.25;
      // The dartboard's sign floats a little into the room so it isn't inside the wall.
      sprite.position.set(st.kind === "dartboard" ? st.x - 0.3 : st.x, y, st.z);
      sprite.renderOrder = 2;
      scene.add(sprite);
      this.signs.set(st.id, { sprite, status: "" });
    }
  }

  update(state: HouseStateView): void {
    for (const [id, sign] of this.signs) {
      const status = state.stations?.get(id) ?? "";
      if (status === sign.status) continue;
      sign.status = status;
      const material = sign.sprite.material;
      material.map?.dispose();
      material.map = signTexture(STATION_BY_ID.get(id)!.game, status);
      material.needsUpdate = true;
    }
  }
}
