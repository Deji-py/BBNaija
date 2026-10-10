import * as THREE from "three";
import {
  AREAS,
  DOORS,
  DOOR_HEADERS,
  FURNITURE,
  GAME_HALL,
  MOVIE_CHANNEL,
  WALLS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  areaAt,
  openDoorSet,
  tvChannel,
  type AreaId,
  type Door,
  type Furniture,
  type Wall,
} from "@bbn/shared";
import { HouseRadio } from "./houseRadio.js";
import { box, mat } from "./materials.js";
import { artTexture } from "./wallArt.js";
import { buildStationModel } from "./gameHall.js";
import { buildPartyModel } from "./partyRoom.js";

const FLOOR_COLORS: Record<AreaId, number> = {
  lounge: 0xc9a27a,
  kitchen: 0xdcd6c8,
  bedroom: 0x8f7aa8,
  gym: 0x55606e,
  diary: 0x6b1f2a,
  garden: 0x6aa84f,
  games: 0x2b2d42,
  bathroom: 0xdfe7ea,
  party: 0x14121c,
};

const WALL_COLOR = 0xefe8da;

/**
 * Each room's side of a wall gets its own finish: paint above a darker
 * wainscot, with skirting, a dado rail and ceiling moulding. Outside faces get
 * a stone base. The Diary Room is the classic deep red with gold trim.
 */
interface WallFinish {
  paint: number;
  wainscot: number;
  trim: number;
}
const ROOM_FINISH: Record<Exclude<AreaId, "garden">, WallFinish> = {
  lounge: { paint: 0xe9dfcf, wainscot: 0xb9a184, trim: 0xfaf6ee },
  kitchen: { paint: 0xcfe0d2, wainscot: 0x6f9a80, trim: 0xf7f7f2 },
  bedroom: { paint: 0xd9cfea, wainscot: 0x8a76b0, trim: 0xf6f2fb },
  gym: { paint: 0xc9d3dc, wainscot: 0x4b5563, trim: 0xe7ebef },
  diary: { paint: 0x7a1f2b, wainscot: 0x4f121b, trim: 0xc6a15b },
  // Games hall: dark arcade purple with neon-cyan trim.
  games: { paint: 0x3d2c5e, wainscot: 0x221a36, trim: 0x22d3ee },
  bathroom: { paint: 0xf1f5f9, wainscot: 0x9ec9d6, trim: 0xffffff },
  // Party room: deep club purple with hot-pink trim.
  party: { paint: 0x231a3a, wainscot: 0x120d1f, trim: 0xff2fd6 },
};
const EXTERIOR: WallFinish = { paint: 0xf2ece0, wainscot: 0x8a8178, trim: 0xe0d6c4 };
const WAINSCOT_TOP = 1.05;
const FENCE_COLOR = 0x8b6a46;
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x5c3d24;

export interface House {
  root: THREE.Group;
  /** Meshes that should block the camera (walls and fences). */
  cameraBlockers: THREE.Object3D[];
  /** Switch the TV screen on/off. Call `animate` each frame for the "picture". */
  tv: TvScreen;
  /** Swinging doors. `setOpen` takes the room's `openDoors` string; `animate` eases them. */
  doors: HouseDoors;
  /** Turns shower water on for the showers in use (ids of the interactables, e.g. "shower-1"). */
  setShowers(inUse: ReadonlySet<string>): void;
  /** Ceiling lamps per room, switched from the room's `lightsOff` state. */
  lights: RoomLights;
}

/** Ceiling lamp spots per room (the light switch by the door turns them all on or off). */
const ROOM_LAMPS: Partial<Record<AreaId, Array<[number, number]>>> = {
  lounge: [[1, 4], [10, 2]],
  kitchen: [[5, -6], [11, -6]],
  bedroom: [[-10, -6]],
  diary: [[-2, -6]],
  gym: [[-10, 4]],
  games: [[19, -4], [27, -4], [19, 5], [27, 5]],
  bathroom: [[5, -13], [11.5, -13]],
  party: [[-26, -5], [-19, 5]],
};

/**
 * The house's indoor lighting: a lamp fitting on the ceiling and a point light
 * for each spot in ROOM_LAMPS. Switching a room off darkens its lamps (which
 * really matters at night); party room lamps are dim and coloured.
 */
export class RoomLights {
  private readonly rooms = new Map<string, Array<{ light: THREE.PointLight; lamp: THREE.Mesh | null; base: number }>>();
  private readonly lit = mat(0xfff6e0, { emissive: 0xfff1cc });
  private readonly unlit = mat(0xd9d4c8);
  private off = "";

  constructor(root: THREE.Group) {
    for (const [area, spots] of Object.entries(ROOM_LAMPS)) {
      const party = area === "party";
      const list = spots!.map(([x, z]) => {
        const light = new THREE.PointLight(party ? 0xb388ff : 0xfff4e4, party ? 5 : 8, 22, 2);
        light.position.set(x, 4.2, z);
        root.add(light);
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.08, 16), this.lit);
        lamp.position.set(x, WALL_HEIGHT - 0.05, z);
        root.add(lamp);
        return { light, lamp, base: light.intensity };
      });
      this.rooms.set(area, list);
    }
  }

  /** Puts an existing light fitting (e.g. the lounge chandelier) on a room's switch. */
  adopt(area: AreaId, fitting: THREE.Object3D | undefined): void {
    if (!fitting) return;
    fitting.traverse((o) => {
      if (o instanceof THREE.PointLight) this.rooms.get(area)?.push({ light: o, lamp: null, base: o.intensity });
    });
  }

  /** `lightsOff`: space-separated room ids switched off. */
  set(lightsOff: string): void {
    if (lightsOff === this.off) return;
    this.off = lightsOff;
    const off = new Set(lightsOff.split(" ").filter(Boolean));
    for (const [area, list] of this.rooms) {
      const on = !off.has(area);
      for (const l of list) {
        l.light.intensity = on ? l.base : 0;
        l.light.visible = on;
        if (l.lamp) l.lamp.material = on ? this.lit : this.unlit;
      }
    }
  }
}

const THEATER = { x: 14.5, y: 0.7, z: 4 };
const TV_AT = { x: 14.5, y: 1.2, z: 4 };

/**
 * The lounge television plays a shared video channel. Music is the home theater
 * beside it (`setTheater`), not this screen.
 */
export class TvScreen {
  private on = false;
  private channel = "";
  private movieUrl = "";
  private readonly video = document.createElement("video");
  private readonly videoTexture: THREE.VideoTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private radio: HouseRadio | null = null;
  private videoOut: MediaElementAudioSourceNode | null = null;

  constructor(readonly mesh: THREE.Mesh) {
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.crossOrigin = "anonymous";
    this.video.preload = "auto";
    this.videoTexture = new THREE.VideoTexture(this.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 1 });
    mesh.material = this.material;
    this.video.addEventListener("loadeddata", () => {
      if (this.video.duration > 0) this.video.currentTime = (Date.now() / 1000) % this.video.duration;
      if (this.on) void this.video.play().catch(() => {});
    });
  }

  /** Call once the page has an AudioContext (after the click that entered the house). */
  attach(ctx: AudioContext): void {
    this.radio = new HouseRadio(ctx, THEATER);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2;
    panner.maxDistance = 22;
    panner.rolloffFactor = 1.2;
    panner.positionX.value = TV_AT.x;
    panner.positionY.value = TV_AT.y;
    panner.positionZ.value = TV_AT.z;
    this.videoOut = ctx.createMediaElementSource(this.video);
    this.videoOut.connect(panner);
    panner.connect(ctx.destination);
  }

  /** `movieUrl` is the shared upload for this house. Built-in channels ignore it. */
  setChannel(id: string, movieUrl = ""): void {
    if (id === MOVIE_CHANNEL) {
      if (!movieUrl || (this.channel === MOVIE_CHANNEL && this.movieUrl === movieUrl)) return;
      this.channel = MOVIE_CHANNEL;
      this.movieUrl = movieUrl;
      this.video.src = movieUrl;
      this.video.load();
      return;
    }
    const next = tvChannel(id);
    if (!next || next.id === this.channel) return;
    this.channel = next.id;
    this.movieUrl = "";
    this.video.src = next.src;
    this.video.load();
  }

  setStation(id: string): void {
    this.radio?.setStation(id);
  }

  /** A track from this computer, through the home theater. Other people keep hearing the shared station. */
  playFile(file: File): void {
    this.radio?.playFile(file);
  }

  stopFile(): void {
    this.radio?.stopFile();
  }

  get localFile(): boolean {
    return this.radio?.playingFile ?? false;
  }

  /** Home theater power. Does not change the television picture. */
  setTheater(on: boolean): void {
    this.radio?.setPlaying(on);
  }

  setOn(on: boolean): void {
    this.on = on;
    if (!on) {
      this.video.pause();
      this.material.map = null;
      this.material.emissiveMap = null;
      this.material.color.set(0x111418);
      this.material.emissive.set(0x000000);
      this.material.needsUpdate = true;
      return;
    }
    this.material.map = this.videoTexture;
    this.material.emissiveMap = this.videoTexture;
    this.material.color.set(0x000000);
    this.material.emissive.set(0xffffff);
    this.material.needsUpdate = true;
    void this.video.play().catch(() => {});
  }

  animate(_dt: number): void {
    if (this.on && !this.video.paused) this.videoTexture.needsUpdate = true;
  }
}

/** Builds the whole house from the shared layout data. */
export function buildHouse(): House {
  const root = new THREE.Group();
  root.name = "house";

  // Lawn surrounding everything.
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x4f8a3c));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  root.add(lawn);

  // One floor slab per area, coloured so each room reads at a glance.
  for (const a of AREAS) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(a.maxX - a.minX, a.maxZ - a.minZ), mat(FLOOR_COLORS[a.id]));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((a.minX + a.maxX) / 2, 0, (a.minZ + a.maxZ) / 2);
    floor.receiveShadow = true;
    root.add(floor);
  }

  const cameraBlockers: THREE.Object3D[] = [];
  for (const w of WALLS) {
    const mesh = box(
      w.maxX - w.minX,
      w.height,
      w.maxZ - w.minZ,
      w.kind === "wall" ? WALL_COLOR : FENCE_COLOR,
      (w.minX + w.maxX) / 2,
      0,
      (w.minZ + w.maxZ) / 2,
    );
    root.add(mesh);
    if (w.kind === "wall") {
      cameraBlockers.push(mesh);
      addWallFinishes(root, w, 0, WALL_HEIGHT);
    }
    if (w.kind === "fence") addFencePosts(root, w);
  }

  // Fill the wall above each doorway (door top → ceiling) and frame the opening.
  for (const header of DOOR_HEADERS) {
    const h = header.top - header.bottom;
    const mesh = box(header.maxX - header.minX, h, header.maxZ - header.minZ, WALL_COLOR, (header.minX + header.maxX) / 2, header.bottom, (header.minZ + header.maxZ) / 2);
    root.add(mesh);
    cameraBlockers.push(mesh);
    addWallFinishes(root, { ...header, height: header.top, kind: "wall" }, header.bottom, header.top);
    const door = DOORS.find((d) => d.id === header.doorId);
    if (door) {
      addDoorFrame(root, door);
      addDoorSigns(root, door);
    }
  }

  const doors = buildDoors(root);

  // One roof over the indoor rooms. The garden stays open.
  const roof = box(30 + WALL_THICKNESS, 0.28, 20 + WALL_THICKNESS, 0xf7f3ea, 0, WALL_HEIGHT, 0);
  root.add(roof);
  cameraBlockers.push(roof);
  const hallW = GAME_HALL.maxX - GAME_HALL.minX;
  const hallD = GAME_HALL.maxZ - GAME_HALL.minZ;
  const hallRoof = box(hallW + WALL_THICKNESS, 0.28, hallD + WALL_THICKNESS, 0xf7f3ea, (GAME_HALL.minX + GAME_HALL.maxX) / 2, WALL_HEIGHT, (GAME_HALL.minZ + GAME_HALL.maxZ) / 2);
  root.add(hallRoof);
  cameraBlockers.push(hallRoof);
  addGameHallDecor(root);
  // The bathroom sits behind the kitchen, outside the main roof.
  const bathRoof = box(14 + WALL_THICKNESS, 0.28, 6 + WALL_THICKNESS, 0xf7f3ea, 8, WALL_HEIGHT, -13);
  root.add(bathRoof);
  cameraBlockers.push(bathRoof);
  // The party room sits west of the gym and bedroom, under its own roof too.
  const partyRoof = box(16 + WALL_THICKNESS, 0.28, 20 + WALL_THICKNESS, 0xf7f3ea, -23, WALL_HEIGHT, 0);
  root.add(partyRoof);
  cameraBlockers.push(partyRoof);
  // The roof blocks the sun, so each room has ceiling lamps that its switch turns on and off.
  const lights = new RoomLights(root);

  for (const f of FURNITURE) root.add(buildFurniture(f));

  const screen = root.getObjectByName("tv-screen") as THREE.Mesh;
  const showerWater = new Map<string, THREE.Object3D>();
  for (const f of FURNITURE) if (f.kind === "shower") {
    const water = root.getObjectByName(`${f.id}-water`);
    if (water) showerWater.set(f.id, water);
  }
  const setShowers = (inUse: ReadonlySet<string>) => {
    for (const [id, water] of showerWater) {
      water.visible = inUse.has(id);
      if (!water.visible) continue;
      // Let the streams fall, wrapping back up to the shower head.
      for (const stream of water.children) {
        stream.position.y -= 0.05;
        if (stream.position.y < 0.2) stream.position.y += 1.7;
      }
    }
  };
  lights.adopt("lounge", root.getObjectByName("chandelier"));
  return { root, cameraBlockers, tv: new TvScreen(screen), doors, setShowers, lights };
}

/** Finish for whatever is on one side of a wall (a room, or outside). */
function finishAt(x: number, z: number): WallFinish {
  const area = areaAt(x, z)?.id;
  return area && area !== "garden" ? ROOM_FINISH[area] : EXTERIOR;
}

/**
 * Paint, wainscot, skirting, dado rail and ceiling moulding on both faces of a
 * wall segment, between heights `from` and `to`. Long walls pass several rooms
 * (the north wall runs behind the bedroom, Diary Room and kitchen), so each face
 * is split at room boundaries and every stretch takes the finish of the room it faces.
 */
function addWallFinishes(root: THREE.Group, w: Wall, from: number, to: number): void {
  const alongX = w.maxX - w.minX >= w.maxZ - w.minZ;
  const start = alongX ? w.minX : w.minZ;
  const end = alongX ? w.maxX : w.maxZ;
  const cross = alongX ? (w.minZ + w.maxZ) / 2 : (w.minX + w.maxX) / 2;
  const half = WALL_THICKNESS / 2;

  // Room edges that fall inside this segment become break points.
  const cuts = new Set<number>([start, end]);
  for (const a of AREAS) for (const v of alongX ? [a.minX, a.maxX] : [a.minZ, a.maxZ]) if (v > start + 1e-6 && v < end - 1e-6) cuts.add(v);
  const points = [...cuts].sort((a, b) => a - b);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const mid = (a + b) / 2;
    const length = b - a;
    for (const side of [-1, 1]) {
      const face = cross + side * half;
      // A point just in front of this stretch of face tells us which room it's in.
      const probe = cross + side * 0.6;
      const finish = alongX ? finishAt(mid, probe) : finishAt(probe, mid);
      /** A layer `proud` metres off the face, `height` tall starting at `y`. */
      const layer = (y: number, height: number, proud: number, color: number) => {
        const t = Math.max(proud, 0.01);
        const off = face + side * (t / 2);
        const m = alongX ? box(length, height, t, color, mid, y, off) : box(t, height, length, color, off, y, mid);
        m.castShadow = false;
        root.add(m);
      };
      if (from < WAINSCOT_TOP) {
        layer(from, WAINSCOT_TOP - from, 0.012, finish.wainscot);
        layer(WAINSCOT_TOP, to - WAINSCOT_TOP, 0.01, finish.paint);
        layer(0, 0.14, 0.035, finish.trim); // skirting board
        layer(WAINSCOT_TOP - 0.03, 0.06, 0.03, finish.trim); // dado rail
      } else {
        layer(from, to - from, 0.01, finish.paint);
      }
      if (to >= WALL_HEIGHT) layer(WALL_HEIGHT - 0.18, 0.18, 0.05, finish.trim); // ceiling moulding
    }
  }
}

/** Painted frame (architrave) around a doorway, on both faces. */
function addDoorFrame(root: THREE.Group, door: Door): void {
  const trim = 0xf4efe6;
  const t = WALL_THICKNESS + 0.06;
  const jambW = 0.1;
  for (const s of [-1, 1]) {
    const along = s * (door.w / 2 + jambW / 2);
    if (door.along === "x") root.add(box(jambW, door.h + jambW, t, trim, door.x + along, 0, door.z));
    else root.add(box(t, door.h + jambW, jambW, trim, door.x, 0, door.z + along));
  }
  if (door.along === "x") root.add(box(door.w + jambW * 2, jambW, t, trim, door.x, door.h, door.z));
  else root.add(box(t, jambW, door.w + jambW * 2, trim, door.x, door.h, door.z));
}

/**
 * A sign above the doorway on each side, naming the room it leads to
 * (so from the lounge the kitchen door reads "Kitchen", and from the kitchen it reads "Lounge").
 */
function addDoorSigns(root: THREE.Group, door: Door): void {
  const height = 0.4;
  const y = door.h + 0.5;
  for (const side of [-1, 1]) {
    // The sign on this side names the area on the other side.
    const beyond = door.along === "x" ? areaAt(door.x, door.z - side * 0.6) : areaAt(door.x - side * 0.6, door.z);
    if (!beyond) continue;
    const texture = signTexture(beyond.label);
    const img = texture.image as HTMLCanvasElement;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry((img.width / img.height) * height, height),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }),
    );
    const off = WALL_THICKNESS / 2 + 0.025;
    if (door.along === "x") {
      sign.position.set(door.x, y, door.z + side * off);
      sign.rotation.y = side > 0 ? 0 : Math.PI;
    } else {
      sign.position.set(door.x + side * off, y, door.z);
      sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    sign.name = `${door.id}-sign`;
    root.add(sign);
  }
}

const signTextures = new Map<string, THREE.CanvasTexture>();

/** Dark plaque with a gold border and the room name, drawn once per room. */
function signTexture(label: string): THREE.CanvasTexture {
  const cached = signTextures.get(label);
  if (cached) return cached;
  const text = label;
  const font = "700 64px system-ui, -apple-system, sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  canvas.width = Math.max(320, Math.ceil(ctx.measureText(text).width) + 96);
  canvas.height = 112;
  // Resizing the canvas resets its context state, so set the font again.
  ctx.font = font;
  ctx.fillStyle = "#1c1a24";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 18);
  ctx.fill();
  ctx.strokeStyle = "#c6a15b";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(9, 9, canvas.width - 18, canvas.height - 18, 12);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  signTextures.set(label, texture);
  return texture;
}

/** Neon strips along the hall walls and a "GAMES HALL" sign over the door wall. */
function addGameHallDecor(root: THREE.Group): void {
  const neon = (color: number) => mat(color, { emissive: color });
  const y = 3.6;
  const inset = WALL_THICKNESS / 2 + 0.03;
  const { minX, maxX, minZ, maxZ } = GAME_HALL;
  const strips: Array<[number, number, number, number, number]> = [
    // [width, depth, x, z, colour]
    [maxX - minX - 0.6, 0.04, (minX + maxX) / 2, minZ + inset, 0xff2fd6],
    [maxX - minX - 0.6, 0.04, (minX + maxX) / 2, maxZ - inset, 0x22d3ee],
    [0.04, maxZ - minZ - 0.6, maxX - inset, (minZ + maxZ) / 2, 0xff2fd6],
  ];
  for (const [w, d, x, z, color] of strips) {
    const strip = box(w, 0.06, d, color, x, y, z);
    strip.material = neon(color);
    strip.castShadow = false;
    root.add(strip);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 0.9),
    new THREE.MeshBasicMaterial({ map: hallSignTexture(), transparent: true }),
  );
  sign.position.set((minX + maxX) / 2, 4.6, maxZ - inset - 0.02);
  sign.rotation.y = Math.PI; // faces into the hall (north)
  root.add(sign);
}

function hallSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "800 150px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff2fd6";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ffe4fa";
  ctx.fillText("GAMES HALL", 512, 115);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Posts a little taller than the rails, so the raised garden fence reads as a fence. */
function addFencePosts(root: THREE.Group, w: { minX: number; maxX: number; minZ: number; maxZ: number; height: number }): void {
  const alongX = w.maxX - w.minX > w.maxZ - w.minZ;
  const start = alongX ? w.minX : w.minZ;
  const end = alongX ? w.maxX : w.maxZ;
  const span = end - start;
  const count = Math.max(2, Math.round(span / 2.4));
  const cx = (w.minX + w.maxX) / 2;
  const cz = (w.minZ + w.maxZ) / 2;
  for (let i = 0; i <= count; i++) {
    const t = start + (span * i) / count;
    root.add(box(0.16, w.height + 0.22, 0.16, 0x6a4a2c, alongX ? t : cx, 0, alongX ? cz : t));
  }
}

interface DoorLeaf {
  pivot: THREE.Group;
  closed: number;
  open: number;
  target: number;
}

/** One swinging leaf per doorway, eased open when the room says that door is open. */
export class HouseDoors {
  private readonly leaves: DoorLeaf[] = [];
  private readonly byId = new Map<string, DoorLeaf[]>();

  constructor(leaves: Map<string, DoorLeaf[]>) {
    this.byId = leaves;
    for (const group of leaves.values()) this.leaves.push(...group);
  }

  /** `raw` is the room's space-separated list of open door ids. */
  setOpen(raw: string): void {
    const open = openDoorSet(raw);
    for (const [id, group] of this.byId) {
      const target = open.has(id) ? "open" : "closed";
      for (const leaf of group) leaf.target = leaf[target];
    }
  }

  animate(dt: number): void {
    const k = 1 - Math.exp(-8 * dt);
    for (const leaf of this.leaves) {
      leaf.pivot.rotation.y += (leaf.target - leaf.pivot.rotation.y) * k;
    }
  }
}

function buildDoors(root: THREE.Group): HouseDoors {
  const byId = new Map<string, DoorLeaf[]>();
  for (const door of DOORS) {
    const leaves = leavesFor(door).map((spec) => {
      const pivot = new THREE.Group();
      pivot.position.set(spec.x, 0, spec.z);
      pivot.rotation.y = spec.closed;
      const width = spec.width * 0.98;
      const thick = door.thick;
      pivot.add(box(width, door.h, thick, 0x6e4428, width / 2, 0, 0));
      for (const side of [1, -1]) {
        const face = side * (thick / 2);
        pivot.add(box(width * 0.72, door.h * 0.34, 0.02, 0x8d5a34, width / 2, door.h * 0.14, face));
        pivot.add(box(width * 0.72, door.h * 0.34, 0.02, 0x8d5a34, width / 2, door.h * 0.56, face));
        pivot.add(box(0.05, 0.18, 0.06, 0xd4b483, width - 0.12, 1.05, face + side * 0.03));
      }
      root.add(pivot);
      return { pivot, closed: spec.closed, open: spec.open, target: spec.closed };
    });
    byId.set(door.id, leaves);
  }
  return new HouseDoors(byId);
}

/**
 * Hinge positions for a shut door, and the yaw that swings it clear of the opening.
 * Leaves extend along local +X. Along-X doors swing south into the next room; the gym door swings east into the lounge.
 */
function leavesFor(door: Door): { x: number; z: number; width: number; closed: number; open: number }[] {
  const leafW = door.w / door.leaves;
  if (door.along === "x") {
    return Array.from({ length: door.leaves }, (_, i) => {
      const west = i % 2 === 0;
      return {
        x: west ? door.x - door.w / 2 : door.x + door.w / 2,
        z: door.z,
        width: leafW,
        closed: west ? 0 : Math.PI,
        // Positive yaw sends local +X toward -Z, so -PI/2 swings the leaf south, out of the opening.
        open: -Math.PI / 2,
      };
    });
  }
  // Shut: local +X points +Z, which is yaw -PI/2. Open: yaw 0 points +X, east into the lounge.
  return [{ x: door.x, z: door.z - door.w / 2, width: door.w, closed: -Math.PI / 2, open: 0 }];
}

/**
 * Each builder works in local space: width along X, depth along Z, and the
 * object's front facing +Z. The group is then rotated to `facing`.
 */
function buildFurniture(f: Furniture): THREE.Group {
  const facing = f.facing ?? 0;
  // When turned sideways, the world-space footprint's w/d swap in local space.
  const sideways = Math.abs(Math.sin(facing)) > 0.5;
  const g = buildModel(f.kind, sideways ? f.d : f.w, sideways ? f.w : f.d, f.h, f.id);
  g.name = f.id;
  g.position.set(f.x, 0, f.z);
  g.rotation.y = facing;
  return g;
}

/**
 * Builds a model in local space (width along X, depth along Z, front facing +Z,
 * standing at y = 0). Used for fixed furniture and for carryable props.
 */
export function buildModel(kind: string, w: number, d: number, h: number, id = ""): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case "sofa": {
      const c = 0x2f7f86;
      g.add(box(w, 0.45, d, c));
      g.add(box(w, h, 0.28, c, 0, 0, -d / 2 + 0.14));
      g.add(box(0.25, 0.65, d, c, -w / 2 + 0.125));
      g.add(box(0.25, 0.65, d, c, w / 2 - 0.125));
      for (let i = 0; i < 3; i++) g.add(box(w / 3 - 0.3, 0.12, d - 0.35, 0x3b98a0, -w / 3 + (i * w) / 3, 0.45, 0.07));
      break;
    }
    case "coffeeTable":
      g.add(box(w, 0.08, d, WOOD, 0, h - 0.08));
      g.add(box(w - 0.2, h - 0.08, d - 0.2, DARK_WOOD));
      break;
    case "tv": {
      g.add(box(w, 0.5, d, DARK_WOOD));
      g.add(box(w * 0.9, 1.0, 0.08, 0x111111, 0, 0.6));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 0.9));
      screen.name = "tv-screen";
      screen.position.set(0, 1.1, 0.045);
      g.add(screen);
      break;
    }
    case "counter":
      g.add(box(w, h - 0.06, d, 0xf3f1ec));
      g.add(box(w, 0.06, d, 0x3a3a3f, 0, h - 0.06));
      break;
    case "stove": {
      g.add(box(w, h, d, 0x2b2b30));
      for (const [bx, bz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]] as const) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 8), mat(0x777777));
        burner.position.set(bx, h + 0.015, bz);
        g.add(burner);
      }
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.16, 8), mat(0x2a2a2a));
      pot.position.set(-0.3, h + 0.12, -0.2);
      g.add(pot);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 8), mat(0x555555));
      lid.position.set(-0.3, h + 0.21, -0.2);
      g.add(lid);
      break;
    }
    case "fridge":
      g.add(box(w, h, d, 0xcfd6dc));
      g.add(box(0.06, 0.5, 0.06, 0x888888, w / 2 - 0.2, 1.1, d / 2 + 0.03));
      break;
    case "diningTable":
      g.add(box(w, 0.08, d, WOOD, 0, h - 0.08));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(box(0.1, h - 0.08, 0.1, DARK_WOOD, sx * (w / 2 - 0.15), 0, sz * (d / 2 - 0.15)));
      }
      break;
    case "bed": {
      const blankets = [0xd9485f, 0x3f7fd9, 0xe0a83a];
      const blanket = blankets[Number(id.split("-")[1] ?? 0) % blankets.length] ?? blankets[0]!;
      g.add(box(w, 0.3, d, DARK_WOOD));
      g.add(box(w - 0.1, 0.2, d - 0.1, 0xf5f5f5, 0, 0.3));
      g.add(box(w - 0.08, 0.08, d * 0.6, blanket, 0, 0.5, d * 0.18));
      g.add(box(w * 0.6, 0.12, 0.4, 0xffffff, 0, 0.5, -d / 2 + 0.35));
      g.add(box(w, 1.0, 0.1, DARK_WOOD, 0, 0, -d / 2 + 0.05));
      break;
    }
    case "treadmill":
      g.add(box(w, 0.2, d, 0x222428));
      g.add(box(w * 0.75, 0.03, d * 0.85, 0x3d3f45, 0, 0.2, -0.05));
      g.add(box(0.08, h, 0.08, 0x9aa0a8, -w / 2 + 0.06, 0, d / 2 - 0.1));
      g.add(box(0.08, h, 0.08, 0x9aa0a8, w / 2 - 0.06, 0, d / 2 - 0.1));
      g.add(box(w, 0.25, 0.25, 0x222428, 0, h - 0.1, d / 2 - 0.15));
      break;
    case "weights":
      g.add(box(w, 0.1, d, 0x333333, 0, h - 0.1));
      g.add(box(w, 0.1, d, 0x333333, 0, 0.4));
      for (let i = 0; i < 5; i++) {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 6), mat(0x1c1c1c));
        bell.rotation.x = Math.PI / 2;
        bell.position.set(-w / 2 + 0.3 + i * ((w - 0.6) / 4), h + 0.1, 0);
        g.add(bell);
      }
      g.add(box(0.08, h, d, 0x666666, -w / 2 + 0.04));
      g.add(box(0.08, h, d, 0x666666, w / 2 - 0.04));
      break;
    case "bench":
      g.add(box(w, 0.1, d, 0x1e1e1e, 0, h - 0.1));
      g.add(box(0.15, h - 0.1, d * 0.8, 0x666666));
      break;
    case "diaryChair": {
      const red = 0xb3122e;
      g.add(box(w, 0.5, d, red));
      g.add(box(w, h, 0.3, red, 0, 0, -d / 2 + 0.15));
      g.add(box(0.25, 0.75, d, red, -w / 2 + 0.125));
      g.add(box(0.25, 0.75, d, red, w / 2 - 0.125));
      break;
    }
    case "pool": {
      const border = 0xe7e1d3;
      const water = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat(0x3fb4e0, { emissive: 0x0b3a52, opacity: 0.9 }));
      water.position.y = 0.03;
      water.receiveShadow = true;
      g.add(water);
      g.add(box(w + 0.6, 0.15, 0.3, border, 0, 0, -d / 2 - 0.15));
      g.add(box(w + 0.6, 0.15, 0.3, border, 0, 0, d / 2 + 0.15));
      g.add(box(0.3, 0.15, d, border, -w / 2 - 0.15));
      g.add(box(0.3, 0.15, d, border, w / 2 + 0.15));
      break;
    }
    case "lounger": {
      g.add(box(w, 0.3, d, 0xf0f0f0));
      g.add(box(w - 0.05, 0.06, d * 0.6, 0x2f9fd0, 0, 0.3, d * 0.2));
      // Backrest hinged at the seat, tilted up toward the head (-Z) end.
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.32, -d / 2 + d * 0.4);
      hinge.rotation.x = 0.7;
      hinge.add(box(w - 0.05, 0.06, d * 0.4, 0x2f9fd0, 0, 0, -d * 0.2));
      g.add(hinge);
      break;
    }
    case "tree": {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h * 0.45, 6), mat(0x6b4a2b));
      trunk.position.y = (h * 0.45) / 2;
      trunk.castShadow = true;
      g.add(trunk);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 0), mat(0x3e8a3a));
      leaves.position.y = h * 0.62;
      leaves.castShadow = true;
      g.add(leaves);
      break;
    }
    case "rug": {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xb5524a));
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.01;
      rug.receiveShadow = true;
      g.add(rug);
      break;
    }
    case "frame": {
      const y = 1.15;
      g.add(box(w, h, Math.max(d, 0.05), 0x5c3d24, 0, y));
      const pic = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.82, h * 0.8),
        new THREE.MeshStandardMaterial({ map: artTexture(id), roughness: 0.95 }),
      );
      pic.position.set(0, y + h / 2, Math.max(d, 0.05) / 2 + 0.01);
      g.add(pic);
      break;
    }
    case "vegBowl": {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.1, 8), mat(0xefe6d6));
      bowl.position.y = h + 0.05;
      g.add(bowl);
      const colors = [0xc23b22, 0xe85d04, 0xf4d35e, 0x2d6a4f, 0x9b2226];
      colors.forEach((c, i) => {
        const veg = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), mat(c));
        const angle = (i / colors.length) * Math.PI * 2;
        veg.position.set(Math.cos(angle) * 0.07, h + 0.12, Math.sin(angle) * 0.07);
        g.add(veg);
      });
      break;
    }
    case "drinks": {
      const colors = [0x1b4332, 0xc1121f, 0xe9c46a, 0x0077b6];
      colors.forEach((c, i) => {
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.26, 6), mat(c));
        bottle.position.set((i - 1.5) * 0.12, h + 0.13, 0);
        g.add(bottle);
      });
      break;
    }
    case "board": {
      g.add(box(w, 0.04, d, 0xc4a574, 0, h));
      const tomato = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat(0xc23b22));
      tomato.position.set(-0.12, h + 0.08, 0.04);
      g.add(tomato);
      const pepper = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.08, 2, 6), mat(0x2d6a4f));
      pepper.rotation.z = Math.PI / 2;
      pepper.position.set(0.12, h + 0.08, -0.02);
      g.add(pepper);
      g.add(box(0.28, 0.015, 0.04, 0xdddddd, 0.02, h + 0.05, 0.1));
      break;
    }
    case "chair": {
      const wood = 0x6b4a2b;
      g.add(box(w * 0.9, 0.08, d * 0.9, wood, 0, 0.42));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(box(0.06, 0.42, 0.06, wood, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)));
      }
      g.add(box(w * 0.9, 0.42, 0.07, wood, 0, 0.5, -d / 2 + 0.05));
      break;
    }
    case "theater": {
      // The sound bar sits on the TV stand under the screen. The tower speakers stand on the floor (kind "speaker").
      const barY = 0.5;
      g.add(box(w * 0.7, 0.12, 0.14, 0x1a1a1a, 0, barY, d / 2 - 0.1));
      for (const x of [-0.4, 0, 0.4]) {
        const driver = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), mat(0x333333));
        driver.position.set(x, barY + 0.06, d / 2 - 0.02);
        g.add(driver);
      }
      break;
    }
    case "speaker": {
      // Floor-standing tower: plinth, cabinet, grille, two woofers and a tweeter on the front (+Z).
      g.add(box(w + 0.06, 0.05, d + 0.06, 0x111111));
      g.add(box(w, h - 0.05, d, 0x1b1b1d, 0, 0.05));
      g.add(box(w - 0.04, h - 0.2, 0.012, 0x26262a, 0, 0.12, d / 2 + 0.006));
      const driver = (y: number, r: number) => {
        const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 14), mat(0x3a3a3f));
        ring.position.set(0, y, d / 2 + 0.014);
        g.add(ring);
        const cone = new THREE.Mesh(new THREE.CircleGeometry(r * 0.55, 12), mat(0x0e0e10));
        cone.position.set(0, y, d / 2 + 0.016);
        g.add(cone);
      };
      driver(h - 0.25, 0.045);
      driver(h * 0.55, 0.11);
      driver(h * 0.3, 0.11);
      break;
    }
    case "chandelier": {
      const gold = 0xc6a15b;
      const drop = 3.35;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, WALL_HEIGHT - drop, 5), mat(0x8a7344));
      chain.position.y = (WALL_HEIGHT + drop) / 2;
      chain.castShadow = true;
      g.add(chain);
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.08, 8), mat(gold));
      rose.position.y = WALL_HEIGHT - 0.04;
      g.add(rose);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(gold));
      hub.position.y = drop;
      hub.castShadow = true;
      g.add(hub);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.045, 6, 18), mat(gold));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = drop - 0.05;
      ring.castShadow = true;
      g.add(ring);
      for (let i = 0; i < 8; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = (i / 8) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 4), mat(gold));
        spoke.rotation.z = Math.PI / 2;
        spoke.position.set(0.52, drop - 0.05, 0);
        arm.add(spoke);
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.28, 5), mat(0xf6f1e6));
        candle.position.set(1.05, drop - 0.28, 0);
        arm.add(candle);
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 6, 5),
          mat(0xfff3d0, { emissive: 0xffc46b }),
        );
        bulb.position.set(1.05, drop - 0.08, 0);
        arm.add(bulb);
        g.add(arm);
      }
      const light = new THREE.PointLight(0xffe0b0, 7, 16, 2);
      light.position.y = drop - 0.15;
      g.add(light);
      break;
    }
    case "armchair": {
      const c = id.endsWith("3") ? 0x2d6a4f : 0xd4a017;
      g.add(box(w, 0.42, d, c));
      g.add(box(w, h, 0.22, c, 0, 0, -d / 2 + 0.11));
      g.add(box(0.18, 0.62, d, c, -w / 2 + 0.09));
      g.add(box(0.18, 0.62, d, c, w / 2 - 0.09));
      g.add(box(w - 0.4, 0.12, d - 0.3, 0xf2e8cf, 0, 0.42, 0.06));
      break;
    }
    case "bookshelf": {
      const wood = 0x6b4a2b;
      g.add(box(w, h, 0.04, wood, 0, 0, -d / 2 + 0.02));
      g.add(box(0.05, h, d, wood, -w / 2 + 0.025));
      g.add(box(0.05, h, d, wood, w / 2 - 0.025));
      const shelves = 5;
      const bookColors = [0xc1121f, 0x264653, 0xe9c46a, 0x2a9d8f, 0xf4a261, 0x6d597a, 0x1d3557];
      for (let i = 0; i <= shelves; i++) {
        const y = (i / shelves) * (h - 0.04);
        g.add(box(w - 0.1, 0.04, d, wood, 0, y));
        if (i === shelves) break;
        let x = -w / 2 + 0.1;
        let n = 0;
        while (x < w / 2 - 0.18) {
          const bw = 0.05 + ((n * 37 + i * 11) % 5) * 0.012;
          const bh = 0.22 + ((n * 13 + i * 7) % 4) * 0.03;
          g.add(box(bw, bh, d * 0.75, bookColors[(n + i * 3) % bookColors.length]!, x + bw / 2, y + 0.04, 0));
          x += bw + 0.008;
          n++;
          if (n % 9 === 8) x += 0.18; // gaps, so shelves don't look stuffed
        }
      }
      break;
    }
    case "billiards": {
      const wood = 0x5c3d24;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.14, h - 0.12, 0.14, wood, sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.2)));
      g.add(box(w, 0.12, d, wood, 0, h - 0.12));
      g.add(box(w - 0.24, 0.02, d - 0.24, 0x1f7a4a, 0, h));
      for (const sz of [-1, 1]) g.add(box(w, 0.06, 0.12, wood, 0, h, sz * (d / 2 - 0.06)));
      for (const sx of [-1, 1]) g.add(box(0.12, 0.06, d, wood, sx * (w / 2 - 0.06)));
      for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
        const pocket = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 8), mat(0x111111));
        pocket.position.set(sx * (w / 2 - 0.14), h + 0.02, sz * (d / 2 - 0.14));
        g.add(pocket);
      }
      const balls = [0xffffff, 0xe63946, 0xf1c40f, 0x1d3557, 0x2a9d8f, 0x111111];
      balls.forEach((c, i) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat(c));
        ball.position.set(-0.4 + (i % 3) * 0.08 + (i > 2 ? 0.04 : 0), h + 0.05, (i > 2 ? 0.07 : 0) - 0.03);
        g.add(ball);
      });
      // Cue resting along the rail.
      const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 1.4, 6), mat(0xd9b38c));
      cue.rotation.z = Math.PI / 2;
      cue.position.set(0.2, h + 0.08, d / 2 - 0.06);
      g.add(cue);
      break;
    }
    case "bbEye": {
      // The glowing Big Brother eye, mounted flat on a wall (front = +Z).
      const r = Math.min(w, h) / 2;
      const y = 2.6;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), mat(0x14141c));
      disc.position.set(0, y, d / 2 + 0.002);
      g.add(disc);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 32), mat(0xe0243b, { emissive: 0x9c0f22 }));
      ring.position.set(0, y, d / 2 + 0.004);
      g.add(ring);
      const white = new THREE.Mesh(new THREE.CircleGeometry(r * 0.62, 32), mat(0xf4f1ea, { emissive: 0x6e6a60 }));
      white.scale.y = 0.55;
      white.position.set(0, y, d / 2 + 0.006);
      g.add(white);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(r * 0.28, 24), mat(0x2a9df4, { emissive: 0x0f5aa0 }));
      iris.position.set(0, y, d / 2 + 0.008);
      g.add(iris);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.12, 16), mat(0x050505));
      pupil.position.set(0, y, d / 2 + 0.01);
      g.add(pupil);
      break;
    }
    case "island": {
      g.add(box(w - 0.1, h - 0.05, d - 0.1, 0x2a9d8f));
      for (let i = 0; i < 3; i++) g.add(box(0.02, 0.5, 0.02, 0xd9d9d9, -w / 2 + 0.4 + i * ((w - 0.8) / 2), 0.35, d / 2 - 0.04));
      g.add(box(w, 0.05, d, 0xf3f1ec, 0, h - 0.05));
      break;
    }
    case "microwave":
      g.add(box(w, 0.3, d, 0xd9d9d9, 0, h));
      g.add(box(w * 0.6, 0.2, 0.01, 0x1a1a1a, -w * 0.12, h + 0.05, d / 2 + 0.005));
      g.add(box(w * 0.18, 0.2, 0.01, 0x8f8f8f, w * 0.34, h + 0.05, d / 2 + 0.005));
      break;
    case "kettle": {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 10), mat(0xc0c4c8));
      body.position.y = h + 0.1;
      g.add(body);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 10, Math.PI), mat(0x222222));
      handle.position.set(0, h + 0.2, 0);
      g.add(handle);
      break;
    }
    case "wardrobe": {
      const c = 0xf2ece0;
      g.add(box(w, h, d, c));
      g.add(box(0.01, h - 0.2, 0.01, 0xbdb3a3, 0, 0.1, d / 2 + 0.005));
      for (const sx of [-1, 1]) g.add(box(0.03, 0.4, 0.03, 0xc6a15b, sx * 0.08, h * 0.5, d / 2 + 0.02));
      g.add(box(w + 0.04, 0.06, d + 0.04, 0xbdb3a3, 0, h));
      break;
    }
    case "vanity": {
      g.add(box(w, 0.06, d, 0xf6efe3, 0, h - 0.06));
      for (const sx of [-1, 1]) g.add(box(0.36, h - 0.06, d - 0.04, 0xf6efe3, sx * (w / 2 - 0.2)));
      for (const sx of [-1, 1]) g.add(box(0.06, 0.03, 0.02, 0xc6a15b, sx * (w / 2 - 0.2), h * 0.55, d / 2));
      // Mirror with a gold frame and bulbs, against the wall behind the table.
      g.add(box(w * 0.75, 0.9, 0.04, 0xc6a15b, 0, h + 0.15, -d / 2 + 0.02));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.68, 0.82), mat(0xbfd7e6, { emissive: 0x2a3640 }));
      glass.position.set(0, h + 0.6, -d / 2 + 0.045);
      g.add(glass);
      for (let i = 0; i < 4; i++) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat(0xfff3d0, { emissive: 0xffd27f }));
        bulb.position.set(-w * 0.3 + i * (w * 0.2), h + 1.09, -d / 2 + 0.06);
        g.add(bulb);
      }
      break;
    }
    case "bike": {
      const grey = 0x2b2d33;
      g.add(box(0.5, 0.06, d, grey));
      g.add(box(0.07, 0.75, 0.07, grey, 0, 0.06, -0.25));
      g.add(box(0.26, 0.06, 0.12, 0x111111, 0, 0.8, -0.25)); // saddle
      g.add(box(0.07, h - 0.06, 0.07, grey, 0, 0.06, d / 2 - 0.2));
      g.add(box(0.5, 0.05, 0.05, 0x9aa0a8, 0, h - 0.05, d / 2 - 0.2)); // handlebar
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14), mat(0xe63946));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.3, d / 2 - 0.25);
      g.add(wheel);
      g.add(box(0.2, 0.14, 0.04, 0x111111, 0, h + 0.05, d / 2 - 0.2)); // console
      break;
    }
    case "punchingBag": {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, WALL_HEIGHT - 1.9, 4), mat(0x8a8a8a));
      chain.position.y = (WALL_HEIGHT + 1.9) / 2;
      g.add(chain);
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 3, 10), mat(0xb3122e));
      bag.position.y = 1.35;
      bag.castShadow = true;
      g.add(bag);
      g.add(box(0.46, 0.06, 0.46, 0x111111, 0, 1.82));
      break;
    }
    case "mirror": {
      g.add(box(w, h + 0.08, Math.max(d, 0.04), 0x9aa0a8, 0, 0.3));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h), mat(0xcfe0ea, { emissive: 0x3a4650 }));
      glass.position.set(0, 0.34 + h / 2, Math.max(d, 0.04) / 2 + 0.003);
      g.add(glass);
      break;
    }
    case "camera": {
      // Studio camera on a tripod, pointing at the Diary Room chair (front = +Z).
      const legMat = mat(0x222222);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.3, 5), legMat);
        const a = (i / 3) * Math.PI * 2;
        leg.position.set(Math.sin(a) * 0.15, 0.62, Math.cos(a) * 0.15);
        leg.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
        g.add(leg);
      }
      g.add(box(0.22, 0.24, 0.42, 0x1a1a1a, 0, 1.25));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 12), mat(0x111111));
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 1.37, 0.28);
      g.add(lens);
      const tally = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), mat(0xff2a2a, { emissive: 0xff0000 }));
      tally.position.set(0.08, 1.5, 0.2);
      g.add(tally);
      break;
    }
    case "softbox": {
      g.add(box(0.04, h - 0.4, 0.04, 0x222222));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(box(0.03, 0.03, 0.35, 0x222222, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12));
      }
      const head = new THREE.Group();
      head.position.set(0, h - 0.35, 0);
      head.rotation.x = -0.25;
      head.add(box(0.55, 0.5, 0.3, 0x111111, 0, -0.25));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.45), mat(0xffffff, { emissive: 0xf5efe0 }));
      face.position.set(0, 0, 0.152);
      head.add(face);
      g.add(head);
      break;
    }
    case "gardenTable": {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) / 2 + 0.2, Math.min(w, d) / 2 + 0.2, 0.05, 16), mat(0xe8e2d4));
      top.position.y = h;
      top.castShadow = true;
      g.add(top);
      g.add(box(0.08, h, 0.08, 0x6b6b6b));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), mat(0xdddddd));
      pole.position.y = 1.2;
      g.add(pole);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.5, 8, 1, true), mat(0xf4a261));
      canopy.material.side = THREE.DoubleSide;
      canopy.position.y = 2.35;
      canopy.castShadow = true;
      g.add(canopy);
      break;
    }
    case "bbq": {
      for (const sx of [-1, 1]) g.add(box(0.05, 0.75, 0.05, 0x222222, sx * (w / 2 - 0.08)));
      g.add(box(w, 0.25, d, 0x1c1c1c, 0, 0.75));
      g.add(box(w, 0.04, d, 0x555555, 0, 1.0));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 10, 1, false, 0, Math.PI), mat(0x1c1c1c));
      lid.rotation.z = Math.PI / 2;
      lid.position.set(0, 1.0, -0.05);
      lid.scale.set(1, 1, 0.55);
      g.add(lid);
      g.add(box(0.3, 0.04, 0.04, 0xc0c0c0, 0, 0.95, d / 2 + 0.02));
      break;
    }
    case "gardenBench": {
      const wood = 0x9a6b43;
      for (let i = 0; i < 3; i++) g.add(box(w, 0.04, d / 3 - 0.04, wood, 0, 0.42, -d / 3 + (i * d) / 3));
      for (const sz of [-1, 1]) g.add(box(w, 0.42, 0.06, 0x3a3a3a, 0, 0, sz * (d / 2 - 0.1)));
      g.add(box(w * 0.2, h - 0.42, d, wood, -w / 2 + 0.06, 0.42));
      break;
    }
    case "pergola": {
      const wood = 0x8b5e34;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.14, h, 0.14, wood, sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07)));
      for (const sz of [-1, 1]) g.add(box(w + 0.3, 0.16, 0.12, wood, 0, h, sz * (d / 2 - 0.07)));
      for (let i = 0; i <= 8; i++) g.add(box(0.08, 0.1, d + 0.3, wood, -w / 2 + (i * w) / 8, h + 0.16, 0));
      break;
    }
    case "hotTub": {
      g.add(box(w, h, d, 0x8b5e34));
      for (let i = 1; i < 6; i++) g.add(box(w + 0.01, 0.02, d + 0.01, 0x6f4a29, 0, (i * h) / 6));
      g.add(box(w - 0.1, 0.06, d - 0.1, 0xd9d9d9, 0, h - 0.04));
      const water = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.04, d - 0.3), mat(0x48cae4, { emissive: 0x0e6a80, opacity: 0.85 }));
      water.position.y = h - 0.02;
      g.add(water);
      g.add(box(0.5, 0.16, 0.4, 0x8b5e34, 0, 0, d / 2 + 0.2)); // step
      break;
    }
    // --- carryable props (see props.ts) ---
    case "stool": {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 12), mat(0x2b2d33));
      seat.position.y = h - 0.03;
      seat.castShadow = true;
      g.add(seat);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(box(0.03, h - 0.06, 0.03, 0xc0c4c8, Math.sin(a) * w * 0.32, 0, Math.cos(a) * w * 0.32));
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.32, 0.012, 4, 12), mat(0xc0c4c8));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h * 0.35;
      g.add(ring);
      break;
    }
    case "sideTable": {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.04, 14), mat(0x9a6b43));
      top.position.y = h - 0.02;
      top.castShadow = true;
      g.add(top);
      g.add(box(0.06, h - 0.04, 0.06, 0x5c3d24));
      const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.36, 0.04, 12), mat(0x5c3d24));
      base.position.y = 0.02;
      g.add(base);
      break;
    }
    case "nightstand": {
      g.add(box(w, h, d, 0xf2ece0));
      g.add(box(w - 0.06, 0.16, 0.01, 0xe2d9c8, 0, h * 0.45, d / 2 + 0.005));
      g.add(box(0.08, 0.02, 0.02, 0xc6a15b, 0, h * 0.53, d / 2 + 0.015));
      // Bedside lamp.
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), mat(0xc6a15b));
      base.position.y = h + 0.1;
      g.add(base);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.16, 10), mat(0xfff1d6, { emissive: 0xc98f3a }));
      shade.position.y = h + 0.28;
      g.add(shade);
      break;
    }
    case "floorLamp": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 12), mat(0x222222));
      base.position.y = 0.02;
      g.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h - 0.25, 6), mat(0x222222));
      pole.position.y = (h - 0.25) / 2;
      g.add(pole);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.28, 12), mat(0xfff1d6, { emissive: 0xc98f3a }));
      shade.position.y = h - 0.14;
      shade.castShadow = true;
      g.add(shade);
      break;
    }
    case "books": {
      const colors = [0x264653, 0xe76f51, 0xe9c46a];
      colors.forEach((c, i) => g.add(box(w - i * 0.03, 0.045, d - i * 0.02, c, 0, i * 0.045)));
      break;
    }
    case "vase": {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 10), mat(0x2a9df4));
      body.position.y = 0.11;
      g.add(body);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.18, 3), mat(0x2d6a4f));
        stem.position.set(Math.sin(a) * 0.02, 0.3, Math.cos(a) * 0.02);
        g.add(stem);
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), mat([0xe63946, 0xf4a261, 0xffffff][i % 3]!));
        bloom.position.set(Math.sin(a) * 0.05, 0.39, Math.cos(a) * 0.05);
        g.add(bloom);
      }
      break;
    }
    case "kettlebell": {
      const bell = new THREE.Mesh(new THREE.SphereGeometry(w * 0.45, 10, 8), mat(0x1c1c1c));
      bell.position.y = w * 0.45;
      bell.castShadow = true;
      g.add(bell);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(w * 0.25, 0.018, 6, 12, Math.PI), mat(0x1c1c1c));
      handle.position.y = w * 0.8;
      g.add(handle);
      break;
    }
    case "yogaMat":
      g.add(box(w, 0.012, d, 0x7b2cbf));
      break;
    case "ball": {
      const r = w / 2;
      const beach = id.startsWith("beach");
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(beach ? 0xffffff : 0x3a2a1a));
      ball.position.y = r;
      ball.castShadow = true;
      g.add(ball);
      if (beach) {
        for (const [c, rot] of [[0xe63946, 0], [0x2a9df4, Math.PI / 1.5], [0xf1c40f, -Math.PI / 1.5]] as const) {
          const band = new THREE.Mesh(new THREE.SphereGeometry(r * 1.01, 12, 10, 0, Math.PI / 3), mat(c));
          band.rotation.y = rot;
          band.position.y = r;
          g.add(band);
        }
      }
      break;
    }
    case "gardenChair": {
      const white = 0xf4f4f0;
      g.add(box(w * 0.9, 0.05, d * 0.9, white, 0, 0.42));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, 0.42, 0.04, white, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)));
      g.add(box(w * 0.9, 0.4, 0.05, white, 0, 0.47, -d / 2 + 0.05));
      for (const sx of [-1, 1]) g.add(box(0.04, 0.2, d * 0.8, white, sx * (w / 2 - 0.04), 0.47));
      break;
    }
    case "basket": {
      g.add(box(w, h, d, 0xc8a46a));
      for (let i = 1; i < 4; i++) g.add(box(w + 0.01, 0.015, d + 0.01, 0xa98551, 0, (i * h) / 4));
      g.add(box(w - 0.08, 0.06, d - 0.08, 0x8ecae6, 0, h - 0.04));
      break;
    }
    case "toilet": {
      const white = 0xf4f6f8;
      g.add(box(0.26, 0.38, 0.3, white, 0, 0, 0.06)); // pedestal
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.12, 12), mat(white));
      bowl.scale.z = 1.25;
      bowl.position.set(0, 0.42, 0.08);
      g.add(bowl);
      const seat = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 4, 14), mat(0xdfe3e8));
      seat.rotation.x = Math.PI / 2;
      seat.scale.y = 1.25;
      seat.position.set(0, 0.49, 0.08);
      g.add(seat);
      g.add(box(w, 0.38, 0.18, white, 0, 0.42, -d / 2 + 0.09)); // cistern
      g.add(box(0.08, 0.025, 0.04, 0xc0c6cc, 0.12, 0.8, -d / 2 + 0.1)); // flush handle
      break;
    }
    case "partition":
      g.add(box(w, h - 0.15, d, 0xd7e3ea, 0, 0.15));
      g.add(box(0.05, 0.15, 0.05, 0x9aa0a8, 0, 0, d / 2 - 0.03));
      break;
    case "shower": {
      g.add(box(w, 0.06, d, 0xe6edf1)); // tray
      g.add(box(w, h, 0.06, 0x9ec9d6, 0, 0, -d / 2 + 0.03)); // tiled back wall
      const glass = mat(0xbfe6f2, { opacity: 0.28 });
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, h - 0.1, d - 0.06), glass);
        side.position.set((sx * w) / 2, h / 2, 0.03);
        g.add(side);
      }
      // Half-width glass screen at the front, open on one side so you can step in.
      const front = new THREE.Mesh(new THREE.BoxGeometry(w / 2, h - 0.1, 0.02), glass);
      front.position.set(-w / 4, h / 2, d / 2);
      g.add(front);
      g.add(box(0.04, 0.3, 0.04, 0xc0c6cc, 0, h - 0.4, -d / 2 + 0.1)); // pipe
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.04, 12), mat(0xc0c6cc));
      head.position.set(0, h - 0.12, -d / 2 + 0.28);
      g.add(head);
      // Falling water, shown while someone is showering (see HouseFixtures).
      const water = new THREE.Group();
      water.name = `${id}-water`;
      water.visible = false;
      const drop = mat(0x9fe0ff, { emissive: 0x2a6f8a, opacity: 0.55 });
      for (let i = 0; i < 18; i++) {
        const stream = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.35, 0.012), drop);
        stream.position.set(((i * 37) % 17) / 17 * 0.2 - 0.1, h - 0.4 - ((i * 53) % 19) / 19 * 1.6, -d / 2 + 0.28 + (((i * 71) % 13) / 13 - 0.5) * 0.2);
        water.add(stream);
      }
      g.add(water);
      break;
    }
    case "bathtub": {
      g.add(box(w, h, d, 0xf4f6f8));
      g.add(box(w - 0.12, 0.02, d - 0.12, 0xe1e6ea, 0, h - 0.02));
      const water = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.03, d - 0.16), mat(0x7fd3ec, { emissive: 0x1f6a80, opacity: 0.8 }));
      water.position.y = h - 0.08;
      g.add(water);
      // Claw feet and a mixer tap at the end.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, 0.08, 0.07, 0xc9a227, sx * (w / 2 - 0.12), -0.04, sz * (d / 2 - 0.1)));
      g.add(box(0.05, 0.22, 0.05, 0xc0c6cc, -w / 2 + 0.06, h - 0.02, 0));
      g.add(box(0.14, 0.04, 0.04, 0xc0c6cc, -w / 2 + 0.12, h + 0.16, 0));
      break;
    }
    case "sink": {
      g.add(box(w, h - 0.06, d, 0x6f4e37)); // vanity cabinet
      g.add(box(w + 0.04, 0.06, d + 0.02, 0xf0ece4, 0, h - 0.06)); // counter
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.07, 14), mat(0xffffff));
      basin.scale.z = 0.8;
      basin.position.set(0, h + 0.02, 0.03);
      g.add(basin);
      g.add(box(0.03, 0.16, 0.03, 0xc0c6cc, 0, h, -d / 2 + 0.08));
      g.add(box(0.03, 0.03, 0.12, 0xc0c6cc, 0, h + 0.15, -d / 2 + 0.13));
      g.add(box(0.05, 0.08, 0.05, 0xf3a712, 0.3, h, -0.1)); // soap
      break;
    }
    case "washer": {
      g.add(box(w, h, d, 0xf2f4f5));
      g.add(box(w, 0.12, 0.02, 0xd5dade, 0, h - 0.14, d / 2 + 0.01)); // control strip
      g.add(box(0.06, 0.04, 0.02, 0x22c55e, w / 2 - 0.1, h - 0.1, d / 2 + 0.02));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 18), mat(0xc0c6cc));
      ring.position.set(0, h * 0.45, d / 2 + 0.02);
      g.add(ring);
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.18, 18), mat(0x3a4a5a, { emissive: 0x0e1820 }));
      door.position.set(0, h * 0.45, d / 2 + 0.025);
      g.add(door);
      break;
    }
    case "towelRack": {
      for (const sx of [-1, 1]) g.add(box(0.04, h, 0.04, 0xc0c6cc, sx * (w / 2 - 0.02), 0, 0));
      for (const y of [h * 0.55, h * 0.9]) g.add(box(w, 0.025, 0.025, 0xc0c6cc, 0, y, 0));
      g.add(box(w * 0.42, 0.5, 0.04, 0xf3a712, -w * 0.22, h * 0.45, 0.02));
      g.add(box(w * 0.42, 0.45, 0.04, 0x17bebb, w * 0.22, h * 0.48, 0.02));
      break;
    }
    case "lightSwitch": {
      // Wall plate with a rocker, flush against the wall behind it (local -Z).
      g.add(box(0.09, 0.13, 0.015, 0xf5f5f0, 0, h - 0.065, -d / 2 + 0.008));
      g.add(box(0.035, 0.06, 0.02, 0xdedbd2, 0, h - 0.03, -d / 2 + 0.02));
      break;
    }
    default:
      if (!buildPartyModel(g, kind, w, d, h)) buildStationModel(g, kind, w, d, h, id);
      break;
    case "plant": {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.22, 6), mat(0xc47b4a));
      pot.position.y = 0.11;
      pot.castShadow = true;
      g.add(pot);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(0x2d6a4f));
      leaves.position.y = 0.42;
      leaves.castShadow = true;
      g.add(leaves);
      break;
    }
  }
  return g;
}
