// Server-side connection to the Higgs Realtime API. The backend holds BOSON_API_KEY and authenticates
// with a normal Authorization header; the browser never receives the key or an ephemeral credential.
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface ServerEvent {
  type: string;
  event_id?: string;
  [k: string]: unknown;
}

export function describeClose(code: number, reason: string): { message: string; retryable: boolean } {
  switch (code) {
    case 1000:
      return { message: reason ? `Voice session closed: ${reason}` : "Voice session closed.", retryable: true };
    case 1013:
      return { message: "Voice provider at max concurrency (1013). Try again shortly.", retryable: true };
    case 3000:
      return { message: "Voice provider rejected the API key (3000). Check BOSON_API_KEY.", retryable: false };
    case 4429:
      return { message: "Voice provider billing entitlement refused (4429).", retryable: false };
    default:
      return { message: `Voice connection closed (${code})${reason ? `: ${reason}` : ""}.`, retryable: code === 1006 };
  }
}

export class HiggsConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  configured = false;
  resolvedSession: Record<string, unknown> | null = null;

  constructor(
    private url: string,
    private apiKey: string,
  ) {
    super();
  }

  /** Open the socket, send session.update, and resolve once the server acknowledges the configuration. */
  connect(session: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      this.ws = ws;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("Timed out waiting for the voice session acknowledgement.")), timeoutMs);
      ws.on("open", () => this.send({ type: "session.update", session }));
      ws.on("message", (data) => {
        let evt: ServerEvent;
        try {
          evt = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!settled && (evt.type === "session.created" || evt.type === "session.updated")) {
          settled = true;
          clearTimeout(timer);
          this.configured = true;
          this.resolvedSession = (evt.session as Record<string, unknown>) ?? null;
          resolve(this.resolvedSession ?? {});
        }
        if (!settled && evt.type === "error") fail(new Error(`Voice provider rejected the session: ${JSON.stringify((evt as any).error ?? evt).slice(0, 300)}`));
        this.emit("event", evt);
      });
      ws.on("error", (e) => {
        fail(e instanceof Error ? e : new Error(String(e)));
        this.emit("transport_error", e);
      });
      ws.on("close", (code, reason) => {
        fail(new Error(describeClose(code, reason.toString()).message));
        this.emit("closed", { code, reason: reason.toString(), byUs: this.closedByUs, ...describeClose(code, reason.toString()) });
      });
    });
  }

  send(evt: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(evt));
      this.emit("sent", evt);
      return true;
    }
    return false;
  }

  get open() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    this.closedByUs = true;
    try {
      this.ws?.close(1000, "client closing");
    } catch {
      /* ignore */
    }
  }
}

export const AUDIO_RATE = 24000;

export function interviewSessionConfig(model: string, voice: string, transcriptionModel: string, instructions: string) {
  return {
    model,
    instructions,
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: AUDIO_RATE },
        // Application-controlled turns: VAD would auto-generate responses before the controller runs.
        turn_detection: null,
        transcription: { model: transcriptionModel, language: "en" },
      },
      output: { format: { type: "audio/pcm", rate: AUDIO_RATE }, voice },
    },
  };
}

export function copilotSessionConfig(model: string, voice: string, transcriptionModel: string, instructions: string, tools: unknown[]) {
  return {
    model,
    instructions,
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: AUDIO_RATE },
        // Native conversational turns: the server starts a response after each detected turn.
        turn_detection: { type: "server_vad" },
        transcription: { model: transcriptionModel, language: "en" },
      },
      output: { format: { type: "audio/pcm", rate: AUDIO_RATE }, voice },
    },
    tools,
    tool_choice: "auto",
  };
}
