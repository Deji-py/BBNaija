import * as THREE from "three";
import { FURNITURE, encodeLook, type Look, type PartyEffect } from "@bbn/shared";
import { Avatar } from "../entities/avatar.js";
import { HouseRadio } from "./houseRadio.js";
import { PartyMix, loadSetlist } from "../audio/partyMix.js";
import { box, mat } from "./materials.js";

/**
 * The party room: DJ booth, light-up dance floor, disco ball and beam lights,
 * all brought to life when someone starts the party at the DJ booth. Also the
 * party effects anyone at the booth can fire: confetti over the dance floor and
 * fireworks over the garden.
 */

/** Headphones, gold chain, shades and a hot pink top. Indices into LOOK_SLOTS. */
const DJ_LOOK: Look = { body: 0, skin: 0, hair: 2, hairColor: 0, top: 6, bottom: 1, shoes: 0, hat: 0, glasses: 2, neck: 1, ears: 2, back: 0, wrist: 1 };

const NEON = [0xff2fd6, 0x22d3ee, 0xfacc15, 0x7c3aed, 0x22c55e, 0xf97316];
const TILE = 1;

/** Builds the party room's own furniture kinds, or returns false. */
export function buildPartyModel(g: THREE.Group, kind: string, w: number, d: number, h: number): boolean {
  switch (kind) {
    case "stage":
      g.add(box(w, h, d, 0x1b1530));
      g.add(box(w + 0.02, 0.03, d + 0.02, 0xff2fd6, 0, h - 0.015));
      return true;
    case "djBooth": {
      const front = box(w, h, d, 0x111018, 0, 0.3);
      g.add(front);
      // Lit front panel facing the dance floor (local +Z), across the booth's width.
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.2), mat(0x22d3ee, { emissive: 0x0e7490 }));
      panel.name = "dj-panel";
      panel.position.set(0, 0.3 + h / 2, d / 2 + 0.005);
      g.add(panel);
      // Two decks and a mixer on top.
      for (const sx of [-0.8, 0.8]) {
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20), mat(0x0b0b0b));
        deck.position.set(sx, 0.3 + h + 0.02, 0);
        deck.name = "dj-deck";
        g.add(deck);
      }
      g.add(box(0.5, 0.06, 0.4, 0x2a2a35, 0, 0.3 + h, 0));
      return true;
    }
    case "danceFloor": {
      const tiles = new THREE.Group();
      tiles.name = "dance-tiles";
      const cols = Math.round(w / TILE);
      const rows = Math.round(d / TILE);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tile = new THREE.Mesh(new THREE.BoxGeometry(TILE - 0.04, h, TILE - 0.04), new THREE.MeshStandardMaterial({ color: 0x1a1726, emissive: 0x000000, roughness: 0.3 }));
          tile.position.set(-w / 2 + TILE / 2 + c * TILE, h / 2, -d / 2 + TILE / 2 + r * TILE);
          tile.receiveShadow = true;
          tiles.add(tile);
        }
      }
      g.add(tiles);
      return true;
    }
    case "discoBall": {
      g.add(box(0.02, 0.5, 0.02, 0x888888, 0, h - 0.1));
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(w / 2, 2), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.95, roughness: 0.15, flatShading: true }));
      ball.name = "disco-ball-mesh";
      ball.position.y = h - 0.2;
      g.add(ball);
      return true;
    }
    case "partyLight": {
      // A moving-head light hanging from the ceiling, with a visible beam.
      const head = new THREE.Group();
      head.name = "party-head";
      head.position.y = h;
      head.add(box(0.3, 0.25, 0.3, 0x1f1f2a, 0, -0.25));
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 5.5, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff2fd6, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.name = "party-beam";
      beam.position.y = -0.25 - 2.75;
      head.add(beam);
      g.add(head);
      return true;
    }
  }
  return false;
}

/** What the room state says about the party. */
export interface PartyState {
  partyOn: boolean | undefined;
  partyStartedAt: number;
  partySeed: number;
  serverTime: number;
}

interface Particle {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

export class PartyRoom {
  private readonly tiles: THREE.Mesh[] = [];
  private readonly heads: Array<{ head: THREE.Object3D; beam: THREE.Mesh; phase: number }> = [];
  private readonly ball: THREE.Object3D | null;
  private readonly panel: THREE.Mesh | null;
  private readonly spots: THREE.PointLight[] = [];
  private readonly particles: Particle[] = [];
  private readonly confettiGeo = new THREE.PlaneGeometry(0.08, 0.05);
  private readonly sparkGeo = new THREE.SphereGeometry(0.08, 6, 4);
  /** The drum loop, for when there are no tracks in /music. */
  private radio: HouseRadio | null = null;
  private mix: PartyMix | null = null;
  private lastServerTime = 0;
  private readonly dj: Avatar | null = null;
  private time = 0;
  private on = false;
  private readonly floorCenter: THREE.Vector3;

  constructor(
    root: THREE.Object3D,
    private readonly scene: THREE.Scene,
  ) {
    root.getObjectByName("dance-tiles")?.traverse((o) => {
      if (o instanceof THREE.Mesh) this.tiles.push(o);
    });
    root.traverse((o) => {
      if (o.name === "party-head") this.heads.push({ head: o, beam: o.getObjectByName("party-beam") as THREE.Mesh, phase: this.heads.length * 1.7 });
    });
    this.ball = root.getObjectByName("disco-ball-mesh") ?? null;
    this.panel = (root.getObjectByName("dj-panel") as THREE.Mesh) ?? null;
    const floor = FURNITURE.find((f) => f.id === "dance-floor");
    this.floorCenter = new THREE.Vector3(floor?.x ?? -22.5, 0, floor?.z ?? 0);
    // Coloured lights that sweep over the floor while the party's on.
    for (let i = 0; i < 3; i++) {
      const spot = new THREE.PointLight(NEON[i]!, 0, 9, 2);
      spot.position.set(this.floorCenter.x, 2.2, this.floorCenter.z);
      root.add(spot);
      this.spots.push(spot);
    }
    for (const { beam } of this.heads) beam.visible = false;
    // The resident DJ stands where the "dj" furniture is (on the stage, behind the decks), which also makes him solid.
    const spot = FURNITURE.find((f) => f.kind === "dj");
    if (spot) {
      this.dj = new Avatar("DJ Ninja", 0xff2fd6, encodeLook(DJ_LOOK));
      this.dj.root.position.set(spot.x, 0.3, spot.z);
      this.dj.root.rotation.y = spot.facing ?? 0;
      root.add(this.dj.root);
    }
  }

  /** Party music plays from the DJ booth's speakers: the DJ's mix, or a drum loop without tracks. */
  attach(ctx: AudioContext): void {
    const booth = FURNITURE.find((f) => f.id === "dj-booth");
    const at = { x: booth?.x ?? -29, y: 1.6, z: booth?.z ?? 0 };
    void loadSetlist().then((tracks) => {
      if (tracks.length === 0) {
        this.radio = new HouseRadio(ctx, at);
        this.radio.setStation("drums");
        this.radio.setPlaying(this.on);
        return;
      }
      const speakers = ctx.createPanner();
      speakers.panningModel = "HRTF";
      // Linear: full volume across the dance floor, then a fade into the next rooms.
      speakers.distanceModel = "linear";
      speakers.refDistance = 12;
      speakers.maxDistance = 36;
      speakers.rolloffFactor = 1;
      speakers.positionX.value = at.x;
      speakers.positionY.value = at.y;
      speakers.positionZ.value = at.z;
      speakers.connect(ctx.destination);
      this.mix = new PartyMix(ctx, speakers, tracks);
    });
  }

  update(dt: number, state: PartyState): void {
    this.time += dt;
    const t = this.time;
    const partyOn = !!state.partyOn;
    this.dj?.update(dt, 0, partyOn ? "dance" : "idle");
    if (this.mix) {
      if (state.serverTime && state.serverTime !== this.lastServerTime) {
        this.lastServerTime = state.serverTime;
        this.mix.syncClock(state.serverTime);
      }
      this.mix.setParty(partyOn, state.partyStartedAt, state.partySeed);
      this.mix.update();
    }
    if (partyOn !== this.on) {
      this.on = partyOn;
      this.radio?.setPlaying(partyOn);
      for (const { beam } of this.heads) beam.visible = partyOn;
      if (!partyOn) {
        for (const tile of this.tiles) (tile.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
        for (const spot of this.spots) {
          spot.intensity = 0;
          spot.visible = false;
        }
      }
    }
    if (partyOn) {
      // Floor: a travelling pattern of colours on the beat: the music's kicks with the DJ's
      // mix, otherwise a steady ~120 bpm.
      const beat = this.mix ? this.mix.beats : Math.floor(t * 2);
      const throb = this.mix ? 0.35 + 0.65 * this.mix.kick : 0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 2));
      this.tiles.forEach((tile, i) => {
        const c = (i + beat + Math.floor(i / 8)) % NEON.length;
        const pulse = ((i * 7 + beat) % 3 === 0 ? 1 : 0.35) * throb;
        (tile.material as THREE.MeshStandardMaterial).emissive.setHex(NEON[c]!).multiplyScalar(pulse);
      });
      if (this.ball) this.ball.rotation.y += dt * 0.8;
      this.heads.forEach(({ head, beam, phase }, i) => {
        head.rotation.x = Math.sin(t * 0.9 + phase) * 0.6;
        head.rotation.z = Math.cos(t * 0.7 + phase) * 0.6;
        (beam.material as THREE.MeshBasicMaterial).color.setHex(NEON[(Math.floor(t * 0.5) + i) % NEON.length]!);
      });
      this.spots.forEach((spot, i) => {
        const a = t * (0.8 + i * 0.3) + i * 2;
        spot.position.set(this.floorCenter.x + Math.cos(a) * 3, 2.2, this.floorCenter.z + Math.sin(a) * 3);
        spot.intensity = this.mix ? 3 + 5 * this.mix.kick : 6;
        spot.visible = true;
      });
      if (this.panel) (this.panel.material as THREE.MeshStandardMaterial).emissive.setHex(NEON[beat % NEON.length]!);
    }
    // Effects.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.v.y -= (p.mesh.geometry === this.sparkGeo ? 4 : 1.2) * dt;
      if (p.mesh.geometry === this.confettiGeo) p.v.multiplyScalar(1 - dt * 1.5);
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.y += dt * 3;
      if (p.life <= 0 || p.mesh.position.y < 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  nowPlaying(): string {
    return this.mix?.nowPlaying() ?? "";
  }

  play(kind: PartyEffect): void {
    if (kind === "confetti") {
      for (let i = 0; i < 260; i++) {
        const m = new THREE.Mesh(this.confettiGeo, new THREE.MeshBasicMaterial({ color: NEON[i % NEON.length]!, side: THREE.DoubleSide }));
        m.position.set(this.floorCenter.x + (Math.random() - 0.5) * 2, 4.5, this.floorCenter.z + (Math.random() - 0.5) * 2);
        const v = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 2, (Math.random() - 0.5) * 7);
        this.scene.add(m);
        this.particles.push({ mesh: m, v, life: 6 });
      }
      return;
    }
    // Fireworks: a few rockets bursting over the garden.
    for (let k = 0; k < 5; k++) {
      const cx = -10 + Math.random() * 20;
      const cz = 15 + Math.random() * 8;
      const cy = 14 + Math.random() * 6;
      const color = NEON[k % NEON.length]!;
      setTimeout(() => {
        for (let i = 0; i < 70; i++) {
          const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color, fog: false }));
          m.position.set(cx, cy, cz);
          const dir = new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 3);
          this.scene.add(m);
          this.particles.push({ mesh: m, v: dir, life: 1.8 + Math.random() * 0.6 });
        }
      }, k * 450);
    }
  }
}
