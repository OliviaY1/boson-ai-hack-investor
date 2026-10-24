// Call tracing for local testing: a one-line terminal timeline per call step, and a bounded protocol log
// per interview for GET /api/calls/:id. Transcript text appears only at CALL_TRACE=verbose; audio payloads
// and credentials never appear.

export type TraceLevel = "off" | "on" | "verbose";

export type Tracer = (interviewId: string, message: string, sensitiveDetail?: string) => void;

export function makeTracer(level: TraceLevel): Tracer {
  return (interviewId, message, sensitiveDetail) => {
    if (level === "off") return;
    const detail = level === "verbose" && sensitiveDetail ? ` ${sensitiveDetail}` : "";
    console.log(`[call ${interviewId.slice(-6)}] ${message}${detail}`);
  };
}

/** Provider events that arrive many times per second are counted, not listed. */
const COUNTED = new Set(["response.output_audio.delta", "response.output_audio_transcript.delta", "input_audio_buffer.append"]);
const MAX_EVENTS = 400;

export interface VoiceLog {
  sessionStartedAt: string;
  connected: boolean;
  /** The provider's acknowledgement of the session configuration (turn detection and transcription only). */
  ack: { turnDetection: unknown; transcription: unknown } | null;
  events: { at: string; dir: "in" | "out"; type: string; note?: string }[];
  counters: Record<string, number>;
}

export function newVoiceLog(): VoiceLog {
  return { sessionStartedAt: new Date().toISOString(), connected: false, ack: null, events: [], counters: {} };
}

export function logVoiceEvent(log: VoiceLog, dir: "in" | "out", type: string, note?: string) {
  const key = `${dir}:${type}`;
  log.counters[key] = (log.counters[key] ?? 0) + 1;
  if (COUNTED.has(type)) return;
  log.events.push({ at: new Date().toISOString(), dir, type, ...(note ? { note } : {}) });
  if (log.events.length > MAX_EVENTS) log.events.splice(0, log.events.length - MAX_EVENTS);
}
