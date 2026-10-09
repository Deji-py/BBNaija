import { VOICE_MAX_DISTANCE, VOICE_REF_DISTANCE } from "@bbn/shared";
import type { Vec3 } from "./VoiceProvider.js";

interface Source {
  element: HTMLAudioElement;
  node: MediaStreamAudioSourceNode;
  panner: PannerNode;
  analyser: AnalyserNode;
}

/**
 * 3D voice playback with the Web Audio API.
 *
 * Each remote voice goes through a PannerNode placed at that player's head.
 * The AudioListener (our "ears") sits at our own head, facing where the camera
 * looks. The browser then works out volume (from distance) and left/right
 * balance (from direction) for us.
 *
 * Distance model "linear": full volume within VOICE_REF_DISTANCE, fading to
 * silence at VOICE_MAX_DISTANCE. Walls are ignored for the MVP.
 */
export class SpatialAudio {
  private readonly sources = new Map<string, Source>();
  private readonly levelBuf = new Float32Array(512);

  constructor(readonly ctx: AudioContext) {}

  attach(id: string, stream: MediaStream): void {
    this.detach(id);
    // Chrome only feeds WebRTC audio into Web Audio if the stream is also attached
    // to a media element. Keep it muted so we don't hear it twice.
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    void element.play().catch(() => {});

    const node = this.ctx.createMediaStreamSource(stream);
    const panner = new PannerNode(this.ctx, {
      panningModel: "HRTF",
      distanceModel: "linear",
      refDistance: VOICE_REF_DISTANCE,
      maxDistance: VOICE_MAX_DISTANCE,
      rolloffFactor: 1,
    });
    const analyser = new AnalyserNode(this.ctx, { fftSize: 512 });
    node.connect(panner).connect(analyser).connect(this.ctx.destination);
    this.sources.set(id, { element, node, panner, analyser });
  }

  detach(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    s.node.disconnect();
    s.panner.disconnect();
    s.analyser.disconnect();
    s.element.srcObject = null;
    this.sources.delete(id);
  }

  setSourcePosition(id: string, p: Vec3): void {
    const panner = this.sources.get(id)?.panner;
    if (!panner) return;
    panner.positionX.value = p.x;
    panner.positionY.value = p.y;
    panner.positionZ.value = p.z;
  }

  /** `yaw` uses the follow camera's convention: the camera looks toward (-sin yaw, -cos yaw). */
  setListener(p: Vec3, yaw: number): void {
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Older Firefox/Safari only have the deprecated setters.
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Loudness (RMS, 0–1) of a voice as we hear it, after distance falloff. Used by dev tooling. */
  heardLevel(id: string): number {
    const a = this.sources.get(id)?.analyser;
    if (!a) return 0;
    a.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.sqrt(sum / this.levelBuf.length);
  }

  close(): void {
    for (const id of [...this.sources.keys()]) this.detach(id);
    void this.ctx.close();
  }
}
