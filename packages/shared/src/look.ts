/**
 * How a housemate looks: body, skin, hair, clothes and accessories, chosen in
 * the character creator before entering the house.
 *
 * Sent and synced as a short string of option indices ("1.2.0.3…") so it's tiny
 * on the wire and trivially validated: anything out of range falls back to 0.
 */

export const LOOK_SLOTS = {
  body: ["Man", "Woman"],
  skin: ["#5a3825", "#7b4a2d", "#9d6b3d", "#c08552", "#e0ac69", "#f1c9a0"],
  hair: [
    "Classic",
    "Bald",
    "Buzz cut",
    "Afro",
    "High-top",
    "Braids",
    "Locs",
    "Bun",
    "Ponytail",
    "Mohawk",
    "Curly",
    "Cornrows",
  ],
  hairColor: ["#141010", "#3b2314", "#6b4423", "#b5843f", "#d9c27a", "#8e2d2d", "#c86dd7", "#e8e8e8"],
  top: ["#3b2c7a", "#e4572e", "#f3a712", "#29bf12", "#17bebb", "#3f88c5", "#ef476f", "#2b2d42", "#f8f9fa", "#111111", "#008753"],
  bottom: ["#1f2a44", "#111111", "#6b4423", "#4a5568", "#c2b280", "#7b2cbf", "#008753", "#f8f9fa"],
  shoes: ["#111111", "#f8f9fa", "#7a3b1d", "#e63946", "#3f88c5", "#f1c40f"],
  hat: ["None", "Cap", "Beanie", "Bucket hat", "Fedora", "Fila", "Gele", "Headband"],
  glasses: ["None", "Glasses", "Sunglasses", "Round shades"],
  neck: ["None", "Gold chain", "Scarf", "Bow tie"],
  ears: ["None", "Earrings", "Headphones"],
  back: ["None", "Backpack"],
  wrist: ["None", "Watch"],
} as const;

export type LookSlot = keyof typeof LOOK_SLOTS;
export const LOOK_SLOT_ORDER = Object.keys(LOOK_SLOTS) as LookSlot[];

export type Look = Record<LookSlot, number>;

/** Accessories you can put on (hair styles, hats, glasses, jewellery…), for counting and the creator. */
export const ACCESSORY_SLOTS: LookSlot[] = ["hair", "hat", "glasses", "neck", "ears", "back", "wrist"];

export const DEFAULT_LOOK: Look = { body: 0, skin: 2, hair: 0, hairColor: 0, top: 0, bottom: 0, shoes: 0, hat: 0, glasses: 0, neck: 0, ears: 0, back: 0, wrist: 0 };

export function encodeLook(look: Look): string {
  return LOOK_SLOT_ORDER.map((slot) => look[slot]).join(".");
}

/** Parses an untrusted look string; out-of-range or missing parts become the default. */
export function decodeLook(raw: unknown): Look {
  const parts = typeof raw === "string" ? raw.slice(0, 64).split(".") : [];
  const look = { ...DEFAULT_LOOK };
  LOOK_SLOT_ORDER.forEach((slot, i) => {
    const n = Number(parts[i]);
    if (Number.isInteger(n) && n >= 0 && n < LOOK_SLOTS[slot].length) look[slot] = n;
  });
  return look;
}

/** A random look, e.g. for bots or a "Surprise me" button. */
export function randomLook(rng: () => number = Math.random): Look {
  const look = { ...DEFAULT_LOOK };
  for (const slot of LOOK_SLOT_ORDER) look[slot] = Math.floor(rng() * LOOK_SLOTS[slot].length);
  // Keep most people un-hatted and un-spectacled so the house doesn't look like a costume party.
  if (rng() < 0.6) look.hat = 0;
  if (rng() < 0.6) look.glasses = 0;
  return look;
}
