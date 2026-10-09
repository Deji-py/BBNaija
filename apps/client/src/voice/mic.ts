/**
 * Microphone access and a simple "am I speaking?" detector.
 *
 * Browsers only allow the mic on secure origins (https:// or http://localhost),
 * and only after the user agrees to the permission prompt.
 */

export type MicResult = { stream: MediaStream } | { stream: null; reason: string };

/**
 * @param skip resolves if the user chooses to go on without a mic (the browser's
 *   permission prompt can otherwise wait forever if they ignore it).
 */
export async function requestMic(ctx: AudioContext, skip?: Promise<void>): Promise<MicResult> {
  // Dev-only: `?fakeMic` sends a test tone instead of the real mic, so voice can be
  // tested in two tabs on one machine without feedback or a microphone.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("fakeMic")) {
    return { stream: createTestTone(ctx) };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, reason: "Microphone needs HTTPS (or localhost) — you can listen but not talk." };
  }
  try {
    const request = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const skipped = skip?.then(() => null);
    const stream = await (skipped ? Promise.race([request, skipped]) : request);
    if (!stream) {
      // If permission is granted later, release the mic straight away.
      void request.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      return { stream: null, reason: "You chose to continue without a microphone — you can listen but not talk." };
    }
    return { stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const reason =
      name === "NotAllowedError"
        ? "Microphone permission was denied — you can listen but not talk."
        : name === "NotFoundError"
          ? "No microphone found — you can listen but not talk."
          : "Couldn't open the microphone — you can listen but not talk.";
    return { stream: null, reason };
  }
}

function createTestTone(ctx: AudioContext): MediaStream {
  const osc = new OscillatorNode(ctx, { frequency: 440 });
  const gain = new GainNode(ctx, { gain: 0.2 });
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  return dest.stream;
}

/**
 * Measures mic loudness to drive the "speaking" indicator. Uses a short
 * hangover so the icon doesn't flicker between words.
 */
export class SpeakingDetector {
  private readonly analyser: AnalyserNode;
  private readonly buf = new Float32Array(512);
  private lastLoud = -Infinity;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.analyser = new AnalyserNode(ctx, { fftSize: 512 });
    // Analysed only — not connected to the speakers, so you don't hear yourself.
    ctx.createMediaStreamSource(stream).connect(this.analyser);
  }

  /** True while the mic level is above the threshold (or was within the last 300 ms). */
  isSpeaking(now = performance.now()): boolean {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    if (rms > 0.015) this.lastLoud = now;
    return now - this.lastLoud < 300;
  }
}
