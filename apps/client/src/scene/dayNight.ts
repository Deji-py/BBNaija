import * as THREE from "three";
import { FURNITURE } from "@bbn/shared";
import { box, mat } from "./materials.js";

const DAY_SKY = new THREE.Color(0x9fd3f0);
const DUSK_SKY = new THREE.Color(0xf4a261);
const NIGHT_SKY = new THREE.Color(0x0b1026);

/** Garden lamp posts that come on after dark. */
const LAMP_POSTS: Array<[number, number]> = [
  [-14, 11],
  [14, 11],
  [-14, 25],
  [14, 25],
  [3.2, 14.6],
];

/**
 * Day and night from the house clock: sky colour, sun height and strength,
 * ambient light, fog and stars, plus garden lamp posts and the pool's
 * underwater light at night. Indoors, rooms rely on their ceiling lamps after
 * dark — so switching them off really makes a difference.
 */
export class DayNight {
  private readonly sky = new THREE.Color();
  private readonly stars: THREE.Points;
  private readonly lampLights: THREE.PointLight[] = [];
  private readonly lampGlow = mat(0xfff2c4, { emissive: 0xffd27a });
  private readonly lampDark = mat(0x8a8578);
  private readonly lampHeads: THREE.Mesh[] = [];
  private readonly poolLight: THREE.PointLight;
  /** 0 at noon, 1 in the dead of night. */
  night = 0;
  private lastMinute = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
    root: THREE.Object3D,
  ) {
    // Stars on a big dome, faded in at night.
    const n = 600;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.45 + 0.05; // upper part of the sky only
      positions[i * 3] = Math.cos(u) * Math.cos(v * Math.PI) * 85;
      positions[i * 3 + 1] = Math.sin(v * Math.PI) * 85 * 0.6 + 10;
      positions[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI) * 85;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0, fog: false }));
    scene.add(this.stars);

    for (const [x, z] of LAMP_POSTS) {
      root.add(box(0.12, 2.6, 0.12, 0x2b2b2b, x, 0, z));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.lampDark);
      head.position.set(x, 2.75, z);
      root.add(head);
      this.lampHeads.push(head);
      const light = new THREE.PointLight(0xffd8a0, 0, 12, 2);
      light.position.set(x, 2.6, z);
      root.add(light);
      this.lampLights.push(light);
    }
    const pool = FURNITURE.find((f) => f.id === "pool");
    this.poolLight = new THREE.PointLight(0x4fd1ff, 0, 10, 2);
    this.poolLight.position.set(pool?.x ?? -3, 0.3, pool?.z ?? 18);
    root.add(this.poolLight);
  }

  /** `minutes`: house clock, minutes since midnight. */
  update(minutes: number): void {
    const minute = Math.floor(minutes);
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    const h = (((minute % 1440) + 1440) % 1440) / 60;
    // Sun up from 6:00 to 19:00, highest at 12:30.
    const day = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
    const twilight = Math.max(0, 1 - Math.min(Math.abs(h - 6.3), Math.abs(h - 19)) / 1.2);
    this.night = 1 - Math.min(1, day * 1.6);

    this.sky.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, day * 1.5));
    if (twilight > 0) this.sky.lerp(DUSK_SKY, twilight * 0.55);
    (this.scene.background as THREE.Color).copy(this.sky);
    this.scene.fog?.color.copy(this.sky);

    const angle = ((h - 6) / 13) * Math.PI; // east to west
    this.sun.position.set(Math.cos(angle) * -30, Math.max(4, Math.sin(angle) * 32), 18);
    this.sun.intensity = 2.4 * day;
    this.sun.color.setHex(twilight > 0.3 ? 0xffc28a : 0xfff1dc);
    this.hemi.intensity = 0.25 + 1.15 * Math.min(1, day * 1.4);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.3);

    const lampsOn = this.night > 0.55;
    for (const l of this.lampLights) {
      l.intensity = lampsOn ? 6 : 0;
      l.visible = lampsOn;
    }
    for (const head of this.lampHeads) head.material = lampsOn ? this.lampGlow : this.lampDark;
    this.poolLight.intensity = lampsOn ? 5 : 0;
    this.poolLight.visible = lampsOn;
  }
}

/** "22:05" from house-clock minutes. */
export function clockText(minutes: number): string {
  const m = Math.floor(((minutes % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
