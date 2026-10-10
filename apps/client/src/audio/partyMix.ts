/**
 * The DJ's mix: tracks from /music/setlist.json played back to back with an
 * 8-second blend (equal-power crossfade, bass swapped halfway). The server only
 * says when the party started and how to shuffle; every client works out the same
 * track and position from that, so the house and the viewers hear one mix.
 */

export interface SetlistTrack {
  file: string;
  title: string;
  artist?: string;
  duration: number;
}

const XFADE = 8;
/** Tracks shorter than this can't hold two blends. */
const MIN_TRACK = XFADE * 3;
/** Re-seek a deck when it drifts this far (seconds) from where the mix should be. */
const DRIFT = 0.35;
const BASS_CUT_HZ = 260;
/** An empty WAV: playing it on a tap lets Safari play the decks later without one. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

interface Deck {
  audio: HTMLAudioElement;
  gain: GainNode;
  highpass: BiquadFilterNode;
  track: number;
  pauseTimer: number;
}

export async function loadSetlist(): Promise<SetlistTrack[]> {
  try {
    const res = await fetch("/music/setlist.json", { cache: "no-cache" });
    if (!res.ok) return [];
    const body = (await res.json()) as { tracks?: SetlistTrack[] };
    return (body.tracks ?? []).filter((t) => typeof t.file === "string" && t.duration >= MIN_TRACK);
  } catch {
    return [];
  }
}

export class PartyMix {
  private readonly decks: Deck[];
  private readonly analyser: AnalyserNode;
  private readonly bins: Uint8Array<ArrayBuffer>;
  private order: number[] = [];
  private starts: number[] = [];
  private cycle = 0;
  private startedAt = 0;
  private seed = -1;
  private on = false;
  private clockOffset = 0;
  private clockSamples: number[] = [];
  /** FFT bins covering the kick drum (about 40–150 Hz). */
  private readonly kickBins: [number, number];
  private bassAvg = 0;
  private lastBeatAt = 0;
  private lastUpdate = 0;
  /** 1 on each kick, fading to 0 before the next: what the lights flash with. */
  kick = 0;
  /** Counts kicks heard in the music, for the dance floor pattern. */
  beats = 0;

  constructor(
    private readonly ctx: AudioContext,
    output: AudioNode,
    private readonly tracks: SetlistTrack[],
  ) {
    const bus = ctx.createGain();
    bus.gain.value = 1.35;
    const punch = ctx.createBiquadFilter();
    punch.type = "lowshelf";
    punch.frequency.value = 110;
    punch.gain.value = 3.5;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2800;
    presence.Q.value = 0.85;
    presence.gain.value = 4;
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 6500;
    air.gain.value = 2.5;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -22;
    glue.knee.value = 12;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.008;
    glue.release.value = 0.18;
    const makeup = ctx.createGain();
    makeup.gain.value = 2.4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    const binHz = ctx.sampleRate / this.analyser.fftSize;
    this.kickBins = [Math.max(1, Math.round(40 / binHz)), Math.max(2, Math.round(150 / binHz))];
    bus.connect(punch);
    punch.connect(presence);
    presence.connect(air);
    air.connect(glue);
    glue.connect(makeup);
    makeup.connect(this.analyser);
    this.analyser.connect(output);
    this.decks = [0, 1].map(() => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";
      audio.volume = 1;
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 20;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(highpass);
      highpass.connect(gain);
      gain.connect(bus);
      return { audio, gain, highpass, track: -1, pauseTimer: 0 };
    });
    const unlock = () => {
      for (const deck of this.decks) {
        if (deck.track !== -1) continue;
        deck.audio.src = SILENCE;
        void deck.audio.play().then(() => deck.audio.pause(), () => {});
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
  }

  /** Feed every server time sample; the mix follows the server clock. */
  syncClock(serverTime: number): void {
    // A sample arrives a little after it was taken, so the largest offset is the most accurate.
    this.clockSamples.push(serverTime - Date.now());
    if (this.clockSamples.length > 10) this.clockSamples.shift();
    this.clockOffset = Math.max(...this.clockSamples);
  }

  setParty(on: boolean, startedAt: number, seed: number): void {
    if (on && (seed !== this.seed || startedAt !== this.startedAt)) {
      this.seed = seed;
      this.startedAt = startedAt;
      this.plan(seed);
    }
    if (on === this.on) return;
    this.on = on;
    if (on) void this.ctx.resume();
    else for (const deck of this.decks) this.release(deck, 0.8);
  }

  /** Call a few times a second. */
  update(): void {
    if (this.on) this.schedule();
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastUpdate || now)) / 1000);
    this.lastUpdate = now;
    this.kick *= Math.exp(-dt * 5);
    if (!this.on) return;
    this.analyser.getByteFrequencyData(this.bins);
    const [lo, hi] = this.kickBins;
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.bins[i]!;
    const level = sum / ((hi - lo + 1) * 255);
    // A kick is the low end jumping well above its recent average; 280 ms apart at most (~210 bpm).
    if (level - this.bassAvg > 0.07 && level > 0.3 && now - this.lastBeatAt > 280) {
      this.beats++;
      this.kick = 1;
      this.lastBeatAt = now;
    }
    this.bassAvg += (level - this.bassAvg) * Math.min(1, dt * 4);
  }

  get active(): boolean {
    return this.on;
  }

  /** Title of the track the mix is on right now, or "" when the party is off. */
  nowPlaying(): string {
    if (!this.on || this.cycle <= 0) return "";
    const elapsed = Math.max(0, (Date.now() + this.clockOffset - this.startedAt) / 1000);
    const t = elapsed % this.cycle;
    let k = this.starts.length - 1;
    while (k > 0 && this.starts[k]! > t) k--;
    const track = this.tracks[this.order[k]!];
    if (!track) return "";
    return track.artist ? `${track.title} — ${track.artist}` : track.title;
  }

  private plan(seed: number): void {
    this.order = shuffle(
      this.tracks.map((_, i) => i),
      seed,
    );
    this.starts = [];
    let t = 0;
    for (const i of this.order) {
      this.starts.push(t);
      t += this.tracks[i]!.duration - XFADE;
    }
    this.cycle = t;
  }

  private schedule(): void {
    if (this.cycle <= 0) return;
    const elapsed = Math.max(0, (Date.now() + this.clockOffset - this.startedAt) / 1000);
    const t = elapsed % this.cycle;
    let k = this.starts.length - 1;
    while (k > 0 && this.starts[k]! > t) k--;
    const p = t - this.starts[k]!;
    const want: Array<{ slot: number; pos: number; gain: number; cut: boolean }> = [];
    const x = Math.min(1, p / XFADE);
    const blending = p < XFADE && elapsed >= XFADE;
    want.push({ slot: k, pos: p, gain: blending ? Math.sin((x * Math.PI) / 2) : 1, cut: blending && x < 0.5 });
    if (blending) {
      const prev = (k - 1 + this.order.length) % this.order.length;
      const prevTrack = this.tracks[this.order[prev]!]!;
      if (prev !== k) want.push({ slot: prev, pos: prevTrack.duration - XFADE + p, gain: Math.cos((x * Math.PI) / 2), cut: x >= 0.5 });
    }

    const used = new Set<Deck>();
    for (const w of want) {
      const track = this.order[w.slot]!;
      const deck = this.decks.find((d) => d.track === track && !used.has(d)) ?? this.decks.find((d) => !used.has(d) && !want.some((o) => this.order[o.slot] === d.track))!;
      used.add(deck);
      this.play(deck, track, w.pos);
      const time = this.ctx.currentTime;
      deck.gain.gain.setTargetAtTime(w.gain, time, 0.08);
      deck.highpass.frequency.setTargetAtTime(w.cut ? BASS_CUT_HZ : 20, time, 0.15);
    }
    for (const deck of this.decks) if (!used.has(deck)) this.release(deck, 0.3);
  }

  private play(deck: Deck, track: number, pos: number): void {
    window.clearTimeout(deck.pauseTimer);
    deck.pauseTimer = 0;
    const a = deck.audio;
    if (deck.track !== track) {
      deck.track = track;
      a.src = `/music/${encodeURIComponent(this.tracks[track]!.file)}`;
      a.currentTime = pos;
    } else if (Math.abs(a.currentTime - pos) > DRIFT && !a.seeking) {
      a.currentTime = pos;
    }
    if (a.paused) void a.play().catch(() => {});
  }

  private release(deck: Deck, fade: number): void {
    if (deck.pauseTimer || deck.track === -1) return;
    deck.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    deck.pauseTimer = window.setTimeout(() => {
      deck.pauseTimer = 0;
      deck.audio.pause();
      deck.track = -1;
    }, fade * 1000);
  }
}

/** Same seed, same order on every client. */
function shuffle(list: number[], seed: number): number[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}
