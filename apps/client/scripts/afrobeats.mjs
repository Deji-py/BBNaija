/**
 * Writes original Afrobeats-style instrumentals into public/music.
 * These are ours — not commercial Nigerian hits, which we cannot ship.
 * Drop licensed mp3s in the same folder and run `pnpm music` to replace this set.
 */
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../public/music/", import.meta.url));
const SR = 22050;

const SET = [
  { file: "lagos-lights.wav", title: "Lagos Lights", bpm: 108, root: 53, bars: 28, mood: "night" },
  { file: "waka-body.wav", title: "Waka Body", bpm: 112, root: 55, bars: 28, mood: "bright" },
  { file: "yard-log.wav", title: "Yard Log", bpm: 114, root: 50, bars: 30, mood: "piano" },
  { file: "ikeja-heat.wav", title: "Ikeja Heat", bpm: 105, root: 48, bars: 28, mood: "slow" },
  { file: "last-dance.wav", title: "Last Dance", bpm: 118, root: 57, bars: 26, mood: "peak" },
];

function hz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function infoChunk(tag, text) {
  const raw = Buffer.from(`${text}\0`, "utf8");
  const body = raw.length % 2 === 0 ? raw : Buffer.concat([raw, Buffer.from([0])]);
  const head = Buffer.alloc(8);
  head.write(tag, 0);
  head.writeUInt32LE(raw.length, 4);
  return Buffer.concat([head, body]);
}

function writeWav(path, samples, title) {
  const n = samples.length;
  const data = Buffer.alloc(8 + n * 2);
  data.write("data", 0);
  data.writeUInt32LE(n * 2, 4);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), 8 + i * 2);
  }
  const listBody = Buffer.concat([Buffer.from("INFO"), infoChunk("INAM", title), infoChunk("IART", "DJ Ninja")]);
  const list = Buffer.alloc(8 + listBody.length);
  list.write("LIST", 0);
  list.writeUInt32LE(listBody.length, 4);
  listBody.copy(list, 8);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(SR, 12);
  fmt.writeUInt32LE(SR * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const riff = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), fmt, list, data]);
  riff.writeUInt32LE(riff.length - 8, 4);
  writeFileSync(path, riff);
}

function kick(out, at, vel) {
  const n = Math.floor(SR * 0.2);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    out[at + i] += Math.sin(2 * Math.PI * (46 + 110 * Math.exp(-t * 42)) * t) * Math.exp(-t * 26) * vel;
    if (i < 90) out[at + i] += (Math.random() * 2 - 1) * (1 - i / 90) * 0.22 * vel;
  }
}

function clap(out, at, vel) {
  const n = Math.floor(SR * 0.12);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const noise = Math.random() * 2 - 1;
    const env = Math.exp(-t * 38) * vel * 0.45;
    // Cheap band-pass around 1.8 kHz.
    out[at + i] += noise * env * Math.sin(2 * Math.PI * 1800 * t);
  }
}

function hat(out, at, vel, open = false) {
  const n = Math.floor(SR * (open ? 0.14 : 0.045));
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    out[at + i] += (Math.random() * 2 - 1) * Math.exp(-t * (open ? 22 : 70)) * vel * 0.16;
  }
}

function shaker(out, at, vel) {
  const n = Math.floor(SR * 0.035);
  for (let i = 0; i < n && at + i < out.length; i++) {
    out[at + i] += (Math.random() * 2 - 1) * (1 - i / n) * vel * 0.08;
  }
}

function tone(out, at, freq, dur, vel, kind) {
  const n = Math.floor(SR * dur);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * (kind === "bass" ? 4.5 : kind === "log" ? 9 : 7)) * (1 - i / n) ** 0.15;
    let s = Math.sin(2 * Math.PI * freq * t);
    if (kind === "bass") s += 0.25 * Math.sin(2 * Math.PI * freq * 2 * t);
    if (kind === "pluck") s = Math.sin(2 * Math.PI * freq * t + 2.2 * Math.sin(2 * Math.PI * freq * t));
    if (kind === "stab") s += 0.4 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.15 * Math.sin(2 * Math.PI * freq * 3 * t);
    out[at + i] += s * env * vel;
  }
}

function render(spec) {
  const step = 60 / spec.bpm / 4;
  const steps = spec.bars * 16;
  const out = new Float64Array(Math.floor((steps * step + 1.2) * SR));
  const pent = [0, 2, 4, 7, 9];
  const bassPat =
    spec.mood === "slow"
      ? [0, , , , 0, , 7, , 0, , , 5, , , 3, ]
      : spec.mood === "piano"
        ? [0, , 7, , , 5, , 0, , 3, , 7, , 5, , ]
        : [0, , , 7, , , 5, , 0, , 3, , 7, , 5, ];
  const kickPat =
    spec.mood === "peak"
      ? [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]
      : [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0];
  const logPat = spec.mood === "piano" || spec.mood === "slow" ? [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] : [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0];

  for (let s = 0; s < steps; s++) {
    const at = Math.floor(s * step * SR);
    const i = s % 16;
    const bar = Math.floor(s / 16);
    const intro = bar < 2;
    const drop = bar >= 2;
    const fill = (bar + 1) % 8 === 0;

    if (kickPat[i]) kick(out, at, intro ? 0.55 : 0.9);
    if (i === 4 || i === 12) clap(out, at, drop ? 0.95 : 0.4);
    if (i % 2 === 0) hat(out, at, 0.55 + (i % 4 === 2 ? 0.2 : 0), i === 14 && fill);
    else hat(out, at, 0.28);
    shaker(out, at, i % 2 === 0 ? 0.9 : 0.45);

    if (drop && logPat[i]) {
      const off = pent[(i + bar) % pent.length];
      tone(out, at, hz(spec.root + 12 + off), 0.22, 0.38, "log");
    }

    if (drop && bassPat[i] !== undefined) {
      tone(out, at, hz(spec.root + bassPat[i]), step * 2.4, 0.55, "bass");
    }

    if (drop && (i === 2 || i === 6 || i === 10 || i === 14)) {
      tone(out, at, hz(spec.root + 12 + pent[(bar + i) % pent.length]), 0.12, 0.16, "pluck");
    }

    if (spec.mood === "piano" && drop && (i === 0 || i === 8)) {
      for (const d of [0, 4, 7]) tone(out, at, hz(spec.root + 12 + d), 0.35, 0.14, "stab");
    }

    if (spec.mood === "night" && drop && i === 0 && bar % 2 === 0) {
      tone(out, at, hz(spec.root + 19), step * 6, 0.1, "stab");
    }

    if (fill && i >= 12) kick(out, at, 0.35);
  }

  // Soft limiter so the mix sits together.
  let peak = 0.001;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = 0.86 / peak;
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * gain);
  return out;
}

for (const old of ["test-a.wav", "test-b.wav", "test-c.wav"]) {
  const p = dir + old;
  if (existsSync(p)) unlinkSync(p);
}

for (const spec of SET) {
  const samples = render(spec);
  writeWav(dir + spec.file, samples, spec.title);
  console.log(`${spec.file}  ${(samples.length / SR).toFixed(1)}s  ${spec.title}`);
}
