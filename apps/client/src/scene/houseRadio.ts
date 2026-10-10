import { TV_STATIONS, tvStation, type TvStationId } from "@bbn/shared";

/**
 * Sound for the home theater beside the TV. Stations are short original patterns;
 * an uploaded song is one shared file. Only one of those plays at a time.
 */
export class HouseRadio {
  private readonly bus: GainNode;
  private readonly patternGain: GainNode;
  private station: TvStationId | "" = "";
  private playing = false;
  private nextTime = 0;
  private step = 0;
  private timer = 0;
  private file: HTMLAudioElement | null = null;
  private fileSource: MediaElementAudioSourceNode | null = null;
  private sharedUrl = "";
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    at: { x: number; y: number; z: number },
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.35;
    this.patternGain = ctx.createGain();
    this.patternGain.connect(this.bus);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2;
    panner.maxDistance = 22;
    panner.rolloffFactor = 1.2;
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
    this.bus.connect(panner);
    panner.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  setStation(id: string): void {
    const next = tvStation(id) ?? "";
    if (next === this.station) return;
    this.station = next;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    if (this.playing && !this.file) this.ensureLoop();
    if (this.playing && this.file) void this.file.play().catch(() => {});
  }

  setPlaying(on: boolean): void {
    this.playing = on;
    if (!on) {
      if (this.file) this.file.pause();
      this.stopLoop();
      return;
    }
    void this.ctx.resume();
    if (this.file) void this.file.play().catch(() => {});
    else this.ensureLoop();
  }

  /** Shared uploaded song. Every client loads the same URL and seeks to the same start. */
  setSharedTrack(url: string, startedAt: number): void {
    if (!url) {
      this.sharedUrl = "";
      this.stopFile();
      return;
    }
    if (url === this.sharedUrl && this.file) {
      this.seekShared(this.file, startedAt);
      return;
    }
    this.stopFile();
    this.sharedUrl = url;
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.loop = true;
    audio.src = url;
    this.file = audio;
    this.fileSource = this.ctx.createMediaElementSource(audio);
    this.fileSource.connect(this.bus);
    this.patternGain.gain.value = 0;
    const start = () => {
      this.seekShared(audio, startedAt);
      if (this.playing) void audio.play().catch(() => {});
    };
    if (audio.readyState >= 1) start();
    else audio.addEventListener("loadedmetadata", start, { once: true });
  }

  private seekShared(audio: HTMLAudioElement, startedAt: number): void {
    if (!startedAt || !audio.duration || !Number.isFinite(audio.duration)) return;
    const pos = ((Date.now() - startedAt) / 1000) % audio.duration;
    if (Math.abs(audio.currentTime - pos) > 0.45 && !audio.seeking) audio.currentTime = pos;
  }

  stopFile(): void {
    if (this.file) {
      this.file.pause();
      if (this.file.src.startsWith("blob:")) URL.revokeObjectURL(this.file.src);
      this.file = null;
    }
    this.fileSource?.disconnect();
    this.fileSource = null;
    this.sharedUrl = "";
    this.patternGain.gain.value = 1;
    if (this.playing) this.ensureLoop();
  }

  get playingFile(): boolean {
    return this.file !== null;
  }

  private ensureLoop(): void {
    if (this.timer || !this.station) return;
    this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.05);
    const tick = () => {
      if (!this.playing || !this.station || this.file) {
        this.timer = 0;
        return;
      }
      const bpm = this.station === "highlife" ? 96 : this.station === "drums" ? 112 : 104;
      const eighth = 60 / bpm / 2;
      const horizon = this.ctx.currentTime + 0.25;
      while (this.nextTime < horizon) {
        this.hit(this.station, this.step % 16, this.nextTime);
        this.step++;
        this.nextTime += eighth;
      }
      this.timer = window.setTimeout(tick, 80);
    };
    tick();
  }

  private stopLoop(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
  }

  private hit(station: TvStationId, step: number, time: number): void {
    const dest = this.patternGain;
    if (station === "groove") {
      if (step % 4 === 0 || step === 10) this.tone(time, 58, 0.12, "sine", 0.5, dest);
      if (step === 4 || step === 12) this.noiseHit(time, 0.08, 0.18);
      if (step % 2 === 1) this.noiseHit(time, 0.03, 0.05);
      const bass = [110, 110, 164.81, 110, 146.83, 110, 196, 164.81];
      if (step % 2 === 0) this.tone(time, bass[step / 2] ?? 110, 0.18, "triangle", 0.16, dest);
    } else if (station === "highlife") {
      if (step % 2 === 0) this.tone(time, 70, 0.08, "sine", 0.22, dest);
      if (step % 4 === 2) {
        for (const f of [196, 246.94, 293.66]) this.tone(time, f, 0.22, "triangle", 0.06, dest);
      }
      if (step % 2 === 1) this.noiseHit(time, 0.04, 0.04);
    } else {
      if (step % 3 === 0) this.tone(time, 62, 0.1, "sine", 0.45, dest);
      if (step === 4 || step === 12) {
        this.tone(time, 180, 0.2, "sine", 0.12, dest);
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(160, time);
        o.frequency.exponentialRampToValueAtTime(step === 4 ? 320 : 220, time + 0.18);
        g.gain.setValueAtTime(0.12, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
        o.connect(g);
        g.connect(dest);
        o.start(time);
        o.stop(time + 0.24);
      }
    }
  }

  private tone(time: number, freq: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(dest);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  private noiseHit(time: number, dur: number, gain: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.patternGain);
    src.start(time);
    src.stop(time + dur);
  }
}

export const TV_STATION_LIST = TV_STATIONS;
