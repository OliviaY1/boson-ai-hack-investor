// A small simulated Higgs realtime endpoint for exercising the real browser audio path without credentials.
// It approximates the documented event flow only: session ack, audio responses that can be cancelled,
// commit -> committed -> transcription, truncate ack, and server VAD with one tool call for the copilot.
// Passing against it is "simulated provider" evidence, never a live verification.
import { WebSocketServer, type WebSocket } from "ws";

export const SIM_KEY = "sim-key-not-real";

function tone(ms: number) {
  const n = Math.round(24 * ms);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / 24000)), i * 2);
  return b.toString("base64");
}

/** Audio appends received, by session type: lets a test see which session the browser's microphone feeds. */
export interface SimStats {
  appends: { interview: number; copilot: number };
}

export interface SimHiggs {
  url: string;
  stats: SimStats;
  /** Transcripts for the next interview commits, in order; afterwards `expertTranscript` is used again. */
  queueTranscripts: (lines: string[]) => void;
  close: () => Promise<void>;
}

export function startSimHiggs(opts: { expertTranscript: string; consultantTranscript?: string }): Promise<SimHiggs> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const stats: SimStats = { appends: { interview: 0, copilot: 0 } };
  const queued: string[] = [];
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;
  const chunk = tone(100);
  wss.on("connection", (ws: WebSocket, req) => {
    if (req.headers.authorization !== `Bearer ${SIM_KEY}`) return ws.close(3000, "invalid key");
    let session: any = null;
    let active: { rid: string; cancelled: boolean } | null = null;
    let loudMs = 0;
    let quietMs = 0;
    let speaking = false;
    const send = (e: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event_id: id("evt"), ...e }));
    const respond = (instructions: string, call = false) => {
      const rid = id("resp");
      const item = id("item");
      const r = { rid, cancelled: false };
      active = r;
      send({ type: "response.created", response: { id: rid, status: "in_progress" } });
      if (call) {
        const callId = id("call");
        send({ type: "response.output_item.added", response_id: rid, item: { id: item, type: "function_call", call_id: callId, name: "get_handoff" } });
        send({ type: "response.function_call_arguments.done", response_id: rid, call_id: callId, name: "get_handoff", arguments: "{}" });
        send({ type: "response.done", response: { id: rid, status: "completed", output: [{ type: "function_call", call_id: callId, name: "get_handoff", arguments: "{}" }] } });
        active = null;
        return;
      }
      send({ type: "response.output_item.added", response_id: rid, item: { id: item, type: "message" } });
      const text = /"([^"]+)"/.exec(instructions)?.[1] ?? "Here is a short spoken answer.";
      let left = Math.max(10, Math.round(text.length / 3));
      const tick = () => {
        if (r.cancelled) {
          send({ type: "response.done", response: { id: rid, status: "cancelled", output: [] } });
          active = null;
          return;
        }
        if (left-- > 0) {
          send({ type: "response.output_audio.delta", response_id: rid, item_id: item, delta: chunk });
          setTimeout(tick, 15);
          return;
        }
        send({ type: "response.output_audio_transcript.done", response_id: rid, item_id: item, transcript: text });
        send({ type: "response.done", response: { id: rid, status: "completed", output: [{ type: "message", id: item }] } });
        active = null;
      };
      setTimeout(tick, 30);
    };
    const userTurn = (text: string) => {
      const item = id("input");
      send({ type: "input_audio_buffer.committed", item_id: item });
      setTimeout(() => send({ type: "conversation.item.input_audio_transcription.completed", item_id: item, transcript: text }), 300);
    };
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      switch (e.type) {
        case "session.update":
          session = e.session;
          send({ type: "session.updated", session });
          return;
        case "response.create":
          if (active) return send({ type: "error", error: { type: "invalid_request_error", message: "conversation already has an active response" } });
          return respond(e.response?.instructions ?? "");
        case "response.cancel":
          if (active) active.cancelled = true;
          return;
        case "conversation.item.truncate":
          return send({ type: "conversation.item.truncated", item_id: e.item_id, audio_end_ms: e.audio_end_ms });
        case "input_audio_buffer.commit":
          return userTurn(queued.shift() ?? opts.expertTranscript);
        case "input_audio_buffer.append": {
          const serverVad = session?.audio?.input?.turn_detection?.type === "server_vad";
          stats.appends[serverVad ? "copilot" : "interview"]++;
          if (!serverVad) return;
          const b = Buffer.from(e.audio, "base64");
          let sum = 0;
          for (let i = 0; i + 1 < b.length; i += 2) sum += Math.abs(b.readInt16LE(i));
          const ms = b.length / 48;
          if (sum / (b.length / 2) > 300) {
            loudMs += ms;
            quietMs = 0;
            if (!speaking && loudMs > 100) {
              speaking = true;
              send({ type: "input_audio_buffer.speech_started" });
            }
          } else if (speaking && (quietMs += ms) > 500) {
            speaking = false;
            loudMs = 0;
            send({ type: "input_audio_buffer.speech_stopped" });
            userTurn(opts.consultantTranscript ?? "Where were we?");
            setTimeout(() => respond("", true), 400);
          }
          return;
        }
      }
    });
  });
  return new Promise((resolve) =>
    wss.on("listening", () => {
      const addr = wss.address() as { port: number };
      resolve({ url: `ws://127.0.0.1:${addr.port}`, stats, queueTranscripts: (lines) => queued.push(...lines), close: () => new Promise<void>((r) => wss.close(() => r())) });
    }),
  );
}
