// Microphone capture: AudioWorklet resampling to 24 kHz mono PCM16 in 20 ms frames, plus an
// energy-based voice activity detector used for application-controlled expert turns.
export const TARGET_RATE = 24000;
export const FRAME_SAMPLES = 480; // 20 ms at 24 kHz

const WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.pos = 0;
    this.last = 0;
    this.lp = 0;
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.n = 0;
    this.sumsq = 0;
  }
  push(v) {
    const s = Math.max(-1, Math.min(1, v));
    this.frame[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    this.sumsq += s * s;
    if (this.n === ${FRAME_SAMPLES}) {
      const out = this.frame.slice();
      this.port.postMessage({ pcm: out.buffer, rms: Math.sqrt(this.sumsq / ${FRAME_SAMPLES}) }, [out.buffer]);
      this.n = 0;
      this.sumsq = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const N = ch.length;
    // One-pole low-pass before decimation to limit aliasing.
    const a = this.ratio > 1 ? 1 / this.ratio : 1;
    const x = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.lp += a * (ch[i] - this.lp); x[i] = this.lp; }
    let p = this.pos;
    while (p <= N - 1) {
      const i0 = Math.floor(p);
      const f = p - i0;
      const s0 = i0 < 0 ? this.last : x[i0];
      const s1 = i0 + 1 <= N - 1 ? x[i0 + 1] : s0;
      this.push(s0 + (s1 - s0) * f);
      p += this.ratio;
    }
    this.pos = p - N;
    this.last = x[N - 1];
    return true;
  }
}
registerProcessor("dl-capture", CaptureProcessor);
`;

export interface VadOptions {
  /** RMS threshold for speech; raised while assistant audio is playing to resist echo. */
  threshold: number;
  startFrames: number;
  hangoverMs: number;
  preRollFrames: number;
}

export const DEFAULT_VAD: VadOptions = { threshold: 0.02, startFrames: 3, hangoverMs: 800, preRollFrames: 10 };

export interface CaptureCallbacks {
  /** Every frame (continuous streaming, e.g. server VAD). */
  onFrame?: (pcm: ArrayBuffer) => void;
  /** Frames inside a detected utterance, including pre-roll (application-controlled turns). */
  onSpeechFrame?: (pcm: ArrayBuffer) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (hangoverMs: number) => void;
  onLevel?: (rms: number) => void;
}

export class MicCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private speaking = false;
  private loud = 0;
  private silentMs = 0;
  private preRoll: ArrayBuffer[] = [];
  muted = false;
  thresholdBoost = 1;

  constructor(
    private stream: MediaStream,
    private cb: CaptureCallbacks,
    private vad: VadOptions = DEFAULT_VAD,
  ) {}

  async start() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (!ctx.audioWorklet) throw new Error("AudioWorklet is not available in this browser.");
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, "dl-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (ev) => this.onFrame(ev.data.pcm as ArrayBuffer, ev.data.rms as number);
    this.source.connect(this.node);
    if (ctx.state === "suspended") await ctx.resume();
  }

  /** Ends the current utterance immediately (manual "done speaking"). */
  forceEnd() {
    if (!this.speaking) return false;
    this.speaking = false;
    this.loud = 0;
    this.silentMs = 0;
    this.cb.onSpeechEnd?.(0);
    return true;
  }

  get inSpeech() {
    return this.speaking;
  }

  private onFrame(pcm: ArrayBuffer, rms: number) {
    this.cb.onLevel?.(this.muted ? 0 : rms);
    if (this.muted) {
      if (this.speaking) this.forceEnd();
      return;
    }
    this.cb.onFrame?.(pcm);
    const loud = rms > this.vad.threshold * this.thresholdBoost;
    if (!this.speaking) {
      this.preRoll.push(pcm);
      if (this.preRoll.length > this.vad.preRollFrames) this.preRoll.shift();
      this.loud = loud ? this.loud + 1 : 0;
      if (this.loud >= this.vad.startFrames) {
        this.speaking = true;
        this.silentMs = 0;
        this.cb.onSpeechStart?.();
        for (const f of this.preRoll.splice(0)) this.cb.onSpeechFrame?.(f);
      }
      return;
    }
    this.cb.onSpeechFrame?.(pcm);
    this.silentMs = loud ? 0 : this.silentMs + 20;
    if (this.silentMs >= this.vad.hangoverMs) {
      this.speaking = false;
      this.loud = 0;
      this.cb.onSpeechEnd?.(this.silentMs);
      this.silentMs = 0;
    }
  }

  async stop() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      await this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
