// Gapless playback of 24 kHz PCM16 chunks with an accurate played-position estimate, so the
// backend can truncate provider context at the point the listener actually heard.
import { TARGET_RATE } from "./capture";

interface Segment {
  deliveryId: string;
  node: AudioBufferSourceNode;
  start: number;
  dur: number;
  ended: boolean;
}

export function b64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length - (bin.length % 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private segments: Segment[] = [];
  private nextTime = 0;
  private done = new Set<string>();
  private playedBefore = new Map<string, number>(); // ms of segments already finished and pruned
  private flushedAt = new Map<string, number>();
  current: string | null = null;
  onDrained: (deliveryId: string, playedMs: number) => void = () => undefined;
  onActivity: (playing: boolean) => void = () => undefined;

  /** Must be called from a user gesture at least once (browser audio activation). */
  async activate() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx.state === "running";
  }

  get active() {
    return !!this.ctx && this.ctx.state === "running";
  }

  get playing() {
    return this.segments.some((s) => !s.ended);
  }

  enqueue(deliveryId: string, b64: string) {
    if (!this.ctx) return;
    if (this.flushedAt.has(deliveryId)) return; // audio for a flushed delivery is never resumed
    const pcm = b64ToInt16(b64);
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, TARGET_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.ctx.destination);
    const start = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
    node.start(start);
    this.nextTime = start + buf.duration;
    const seg: Segment = { deliveryId, node, start, dur: buf.duration, ended: false };
    node.onended = () => {
      seg.ended = true;
      this.checkDrained(deliveryId);
    };
    this.segments.push(seg);
    if (this.current !== deliveryId) this.current = deliveryId;
    this.onActivity(true);
  }

  /** The backend says no more audio is coming for this delivery. */
  markDone(deliveryId: string) {
    this.done.add(deliveryId);
    this.checkDrained(deliveryId);
  }

  playedMs(deliveryId: string): number {
    if (this.flushedAt.has(deliveryId)) return this.flushedAt.get(deliveryId)!;
    const now = this.ctx?.currentTime ?? 0;
    let s = this.playedBefore.get(deliveryId) ?? 0;
    for (const seg of this.segments) if (seg.deliveryId === deliveryId) s += Math.max(0, Math.min(seg.dur, now - seg.start)) * 1000;
    return Math.round(s);
  }

  /** Stops and clears all scheduled audio immediately; returns the played position of each delivery. */
  flush(): Map<string, number> {
    const out = new Map<string, number>();
    const ids = new Set(this.segments.map((s) => s.deliveryId));
    for (const id of ids) {
      const ms = this.playedMs(id);
      out.set(id, ms);
      this.flushedAt.set(id, ms);
    }
    for (const seg of this.segments) {
      seg.node.onended = null;
      try {
        seg.node.stop();
      } catch {
        /* not started */
      }
      seg.node.disconnect();
    }
    this.segments = [];
    this.nextTime = 0;
    this.onActivity(false);
    return out;
  }

  private checkDrained(deliveryId: string) {
    const mine = this.segments.filter((s) => s.deliveryId === deliveryId);
    if (mine.some((s) => !s.ended)) return;
    const played = this.playedMs(deliveryId);
    // Prune finished segments for this delivery but remember their duration.
    this.playedBefore.set(deliveryId, played);
    this.segments = this.segments.filter((s) => s.deliveryId !== deliveryId);
    if (!this.playing) this.onActivity(false);
    if (this.done.has(deliveryId)) {
      this.done.delete(deliveryId);
      this.onDrained(deliveryId, played);
    }
  }

  async close() {
    this.flush();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
