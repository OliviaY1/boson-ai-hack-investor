// Protocol fixture: a local WebSocket server that speaks the subset of the Higgs Realtime protocol
// the backend uses. It acknowledges session.update and lets tests script every other server event.
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

export interface FakeHiggsOptions {
  /** Override the session echoed in session.updated (e.g. to simulate a provider ignoring turn_detection: null). */
  ackSession?: (requested: any) => any;
  /** Close immediately with this code instead of acknowledging. */
  closeWith?: { code: number; reason: string };
}

export class FakeConn {
  received: any[] = [];
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  private seq = 0;
  constructor(
    readonly ws: WebSocket,
    readonly authorization: string | undefined,
  ) {}

  push(m: any) {
    this.received.push(m);
    for (const w of [...this.waiters]) {
      if (w.pred(m)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  }

  send(evt: Record<string, unknown>) {
    this.ws.send(JSON.stringify({ event_id: `evt_${++this.seq}_${Math.random().toString(36).slice(2, 8)}`, ...evt }));
  }

  /** Send the same event twice with the same event_id (duplicate delivery from the provider). */
  sendDuplicate(evt: Record<string, unknown>) {
    const withId = { event_id: `dup_${++this.seq}`, ...evt };
    this.ws.send(JSON.stringify(withId));
    this.ws.send(JSON.stringify(withId));
  }

  types(): string[] {
    return this.received.map((m) => m.type);
  }

  count(type: string): number {
    return this.received.filter((m) => m.type === type).length;
  }

  /** Resolves with the first matching message, already received or arriving within `ms`. */
  waitFor(type: string, pred: (m: any) => boolean = () => true, ms = 3000): Promise<any> {
    const existing = this.received.find((m) => m.type === type && pred(m));
    if (existing) return Promise.resolve(existing);
    const seen: any[] = [];
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`fake higgs: timed out waiting for ${type} (got: ${this.types().join(", ")})`)), ms);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m) && !seen.includes(m),
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  }

  /** Play a scripted response for a response.create: created → item → audio → transcript → done. */
  respond(responseId: string, opts: { chunks?: number; transcript?: string; done?: boolean; itemId?: string } = {}) {
    const itemId = opts.itemId ?? `item_${responseId}`;
    this.send({ type: "response.created", response: { id: responseId, status: "in_progress" } });
    this.send({ type: "response.output_item.added", response_id: responseId, item: { id: itemId, type: "message", role: "assistant" } });
    for (let i = 0; i < (opts.chunks ?? 2); i++) this.audio(responseId, itemId);
    if (opts.done !== false) this.finish(responseId, opts.transcript ?? "Assistant speech.");
  }

  audio(responseId: string, itemId = `item_${responseId}`, samples = 2400) {
    this.send({ type: "response.output_audio.delta", response_id: responseId, item_id: itemId, delta: Buffer.alloc(samples * 2).toString("base64") });
  }

  finish(responseId: string, transcript = "Assistant speech.") {
    this.send({ type: "response.output_audio_transcript.done", response_id: responseId, transcript });
    this.send({ type: "response.done", response: { id: responseId, status: "completed", output: [] } });
  }
}

export class FakeHiggs {
  conns: FakeConn[] = [];
  private connWaiters: ((c: FakeConn) => void)[] = [];
  private constructor(
    private wss: WebSocketServer,
    readonly url: string,
  ) {}

  static async start(opts: FakeHiggsOptions = {}): Promise<FakeHiggs> {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((r) => wss.once("listening", () => r()));
    const port = (wss.address() as AddressInfo).port;
    const fake = new FakeHiggs(wss, `ws://127.0.0.1:${port}/v1/realtime?model=higgs-realtime`);
    wss.on("connection", (ws, req) => {
      const conn = new FakeConn(ws, req.headers.authorization);
      fake.conns.push(conn);
      if (opts.closeWith) {
        fake.connWaiters.splice(0).forEach((w) => w(conn));
        ws.close(opts.closeWith.code, opts.closeWith.reason);
        return;
      }
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        conn.push(m);
        if (m.type === "session.update") conn.send({ type: "session.updated", session: opts.ackSession ? opts.ackSession(m.session) : m.session });
      });
      fake.connWaiters.splice(0).forEach((w) => w(conn));
    });
    return fake;
  }

  nextConn(ms = 3000): Promise<FakeConn> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("fake higgs: no connection")), ms);
      this.connWaiters.push((c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
  }

  async close() {
    for (const c of this.conns) c.ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

/** Participant side of an interview voice session, recording what the browser would receive. */
export class FakeParticipant {
  messages: any[] = [];
  closed = false;
  sendJson = (m: Record<string, unknown>) => {
    this.messages.push(m);
  };
  close = () => {
    this.closed = true;
  };
  of(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
}
