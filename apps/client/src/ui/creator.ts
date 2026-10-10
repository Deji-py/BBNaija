import * as THREE from "three";
import { DEFAULT_LOOK, LOOK_SLOTS, decodeLook, encodeLook, randomLook, type Look, type LookSlot } from "@bbn/shared";
import { Character } from "../entities/character.js";
import { loadModel } from "../entities/characterModels.js";

const STORAGE_KEY = "bbn:look";

/** The look you chose last time (or a random one the first time). */
export function savedLook(): Look {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return decodeLook(raw);
  } catch {
    // Storage can be unavailable; a fresh look is fine.
  }
  return { ...randomLook(), hat: 0, glasses: 0, neck: 0, ears: 0, back: 0, wrist: 0 };
}

function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeLook(look));
  } catch {
    // Remembering it is just a convenience.
  }
}

const COLOR_SLOTS: Array<{ slot: LookSlot; label: string }> = [
  { slot: "skin", label: "Skin" },
  { slot: "hairColor", label: "Hair colour" },
  { slot: "top", label: "Top" },
  { slot: "bottom", label: "Trousers / shorts" },
  { slot: "shoes", label: "Shoes" },
];
const CHOICE_SLOTS: Array<{ slot: LookSlot; label: string }> = [
  { slot: "hair", label: "Hair" },
  { slot: "hat", label: "Headwear" },
  { slot: "glasses", label: "Glasses" },
  { slot: "neck", label: "Neck" },
  { slot: "ears", label: "Ears" },
  { slot: "back", label: "Back" },
  { slot: "wrist", label: "Wrist" },
];

/**
 * Character creator: a turning 3D preview of your housemate and every choice
 * (body, skin, hair, clothes and accessories). Changes show instantly and are
 * remembered for next time.
 */
export class CharacterCreator {
  readonly el: HTMLElement;
  private look: Look;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private readonly turntable = new THREE.Group();
  private character: Character | null = null;
  private characterBody = -1;
  private spin = 0.5;
  private dragging = false;
  private lastX = 0;
  private running = true;
  private readonly controls: HTMLElement;

  constructor(initial: Look = savedLook()) {
    this.look = { ...DEFAULT_LOOK, ...initial };
    this.el = document.createElement("div");
    this.el.className = "creator";
    const stage = document.createElement("div");
    stage.className = "creator-stage";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.append(this.renderer.domElement);
    const hint = document.createElement("p");
    hint.className = "creator-hint";
    hint.textContent = "Drag to turn";
    stage.append(hint);
    this.controls = document.createElement("div");
    this.controls.className = "creator-controls";
    this.el.append(stage, this.controls);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554466, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshStandardMaterial({ color: 0x2a2640 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor, this.turntable);
    this.camera.position.set(0, 1.25, 4.1);
    this.camera.lookAt(0, 0.95, 0);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.turntable.rotation.y += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    canvas.addEventListener("pointerup", () => (this.dragging = false));

    this.renderControls();
    void this.rebuild();
    let last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.resize();
      if (!this.dragging) this.turntable.rotation.y += dt * this.spin;
      this.character?.update(dt, "idle", 0, false);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** The chosen look, encoded for the server. */
  get value(): string {
    return encodeLook(this.look);
  }

  /** Name colour that goes with the outfit. */
  get color(): string {
    return LOOK_SLOTS.top[this.look.top]!;
  }

  destroy(): void {
    this.running = false;
    this.character?.dispose();
    this.renderer.dispose();
  }

  private set(slot: LookSlot, value: number): void {
    this.look = { ...this.look, [slot]: value };
    saveLook(this.look);
    this.renderControls();
    void this.rebuild();
  }

  /** Swaps the model when the body changes, otherwise just re-dresses it. */
  private async rebuild(): Promise<void> {
    const look = this.look;
    if (this.character && this.characterBody === look.body) {
      this.character.setLook(look);
      return;
    }
    const model = await loadModel(look.body === 1 ? "suit" : "hoodie");
    if (look !== this.look && look.body !== this.look.body) return; // changed again while loading
    if (this.character) {
      this.turntable.remove(this.character.object);
      this.character.dispose();
    }
    this.character = new Character(model, this.look);
    this.characterBody = this.look.body;
    this.turntable.add(this.character.object);
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
  }

  private renderControls(): void {
    const c = this.controls;
    c.replaceChildren();
    const section = (label: string) => {
      const s = document.createElement("div");
      s.className = "creator-section";
      const title = document.createElement("span");
      title.className = "creator-label";
      title.textContent = label;
      s.append(title);
      c.append(s);
      return s;
    };

    const top = document.createElement("div");
    top.className = "creator-row";
    for (const [i, label] of LOOK_SLOTS.body.entries()) top.append(this.choice(label, this.look.body === i, () => this.set("body", i)));
    const surprise = this.choice("🎲 Surprise me", false, () => {
      this.look = randomLook();
      saveLook(this.look);
      this.renderControls();
      void this.rebuild();
    });
    surprise.classList.add("surprise");
    top.append(surprise);
    c.append(top);

    for (const { slot, label } of COLOR_SLOTS) {
      const s = section(label);
      const row = document.createElement("div");
      row.className = "creator-swatches";
      (LOOK_SLOTS[slot] as readonly string[]).forEach((hex, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "creator-swatch";
        b.style.background = hex;
        b.title = hex;
        b.setAttribute("aria-label", `${label} ${i + 1}`);
        b.setAttribute("aria-pressed", String(this.look[slot] === i));
        b.addEventListener("click", () => this.set(slot, i));
        row.append(b);
      });
      s.append(row);
    }
    for (const { slot, label } of CHOICE_SLOTS) {
      const s = section(label);
      const row = document.createElement("div");
      row.className = "creator-row";
      (LOOK_SLOTS[slot] as readonly string[]).forEach((name, i) => {
        const text = slot === "hair" && i === 0 ? (this.look.body === 1 ? "Long (classic)" : "Short (classic)") : name;
        row.append(this.choice(text, this.look[slot] === i, () => this.set(slot, i)));
      });
      s.append(row);
    }
  }

  private choice(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "creator-choice";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    return b;
  }
}
