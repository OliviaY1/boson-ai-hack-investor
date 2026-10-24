// Live provider probe: runs the real Higgs adapters end to end against the configured endpoint.
//
//   BOSON_API_KEY=... npm run probe:live            # writes artifacts/live-probe/live-probe.json
//   npm run probe:live -- --out path/to/result.json --require-key
//
// The backend runs in-process on a temporary data directory. Expert and consultant speech is synthesized by a
// separate Higgs session (reading fixed lines), then streamed into the app exactly as the browser would:
// participant WebSocket for a live_voice_mock_reasoning interview (application-controlled turns, barge-in), and
// the copilot WebSocket (server VAD, tool loop). Reasoning stays on the deterministic mock unless
// ANTHROPIC_API_KEY is also set, in which case one real planner call is checked as well.
// Nothing written or printed contains the API key; error text is scrubbed before it is recorded.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config";
import { runPlanner } from "../src/domain/planning";
import { startServer } from "../src/index";
import { fixedUtteranceInstructions } from "../src/providers/prompts";
import { AUDIO_RATE, HiggsConnection } from "../src/voice/higgs";

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outPath = path.resolve(argValue("--out") ?? "artifacts/live-probe/live-probe.json");
const requireKey = args.includes("--require-key");

const base = loadConfig();
const KEY = base.bosonApiKey;
const scrub = (s: string) => (KEY ? s.split(KEY).join("[redacted]") : s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status = "pass" | "fail" | "skipped";
interface Check {
  name: string;
  status: Status;
  detail: string;
  ms?: number;
  data?: Record<string, unknown>;
}
const checks: Check[] = [];
const record = (c: Check) => {
  c.detail = scrub(c.detail);
  checks.push(c);
  console.log(`${c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "SKIP"}  ${c.name}${c.ms !== undefined ? ` (${c.ms} ms)` : ""}: ${c.detail}`);
};

// --- protocol log: every Higgs connection the app opens, by role, without payloads -----------------
interface ConnLog {
  id: number;
  role: string;
  sent: string[];
  received: string[];
  ackTurnDetection?: unknown;
  ackTranscription?: unknown;
  errors: string[];
}
const conns = new Map<HiggsConnection, ConnLog>();
let connSeq = 0;
let nextRole = "unknown";
const logFor = (c: HiggsConnection) => {
  let l = conns.get(c);
  if (!l) {
    l = { id: ++connSeq, role: nextRole, sent: [], received: [], errors: [] };
    conns.set(c, l);
  }
  return l;
};
const origSend = HiggsConnection.prototype.send;
HiggsConnection.prototype.send = function (this: HiggsConnection, evt: Record<string, unknown>) {
  logFor(this).sent.push(String(evt.type));
  return origSend.call(this, evt);
};
const origEmit = HiggsConnection.prototype.emit;
HiggsConnection.prototype.emit = function (this: HiggsConnection, name: string | symbol, ...rest: unknown[]) {
  if (name === "event") {
    const e = rest[0] as any;
    const l = logFor(this);
    l.received.push(String(e?.type));
    if (e?.type === "session.updated" || e?.type === "session.created") {
      const input = e.session?.audio?.input;
      l.ackTurnDetection = input && "turn_detection" in input ? input.turn_detection : e.session && "turn_detection" in e.session ? e.session.turn_detection : "(absent)";
      l.ackTranscription = e.session?.audio?.input?.transcription?.model ?? "(absent)";
    }
    if (e?.type === "error") l.errors.push(scrub(JSON.stringify(e.error ?? e).slice(0, 300)));
  }
  return origEmit.call(this, name, ...rest);
};

// --- speech synthesis through Higgs (fixed lines) -------------------------------------------------
async function synthesize(line: string): Promise<{ pcm: Buffer; transcript: string; ms: number }> {
  nextRole = "tts";
  const conn = new HiggsConnection(base.bosonRealtimeUrl, KEY!);
  const t0 = Date.now();
  await conn.connect({
    model: base.bosonModel,
    instructions: "You read lines aloud exactly as written, in a natural speaking voice. Never add words.",
    output_modalities: ["audio"],
    audio: {
      input: { format: { type: "audio/pcm", rate: AUDIO_RATE }, turn_detection: null },
      output: { format: { type: "audio/pcm", rate: AUDIO_RATE }, voice: base.bosonVoice },
    },
  });
  const chunks: Buffer[] = [];
  let transcript = "";
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("speech synthesis timed out")), 30000);
    conn.on("event", (e: any) => {
      if (e.type === "response.output_audio.delta") chunks.push(Buffer.from(String(e.delta ?? ""), "base64"));
      if (e.type === "response.output_audio_transcript.done") transcript = String(e.transcript ?? "");
      if (e.type === "response.done") {
        clearTimeout(timer);
        resolve();
      }
      if (e.type === "error") {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(e.error ?? e).slice(0, 300)));
      }
    });
  });
  conn.send({ type: "response.create", response: { instructions: fixedUtteranceInstructions(line), output_modalities: ["audio"] } });
  await done;
  conn.close();
  return { pcm: Buffer.concat(chunks), transcript, ms: Date.now() - t0 };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
function wordRecall(expected: string, heard: string) {
  const h = new Set(words(heard));
  const e = words(expected);
  return e.length ? e.filter((w) => h.has(w)).length / e.length : 0;
}

/** Stream PCM16 to a socket in 40 ms frames at real-time pace (what the browser capture worklet does). */
async function stream(ws: WebSocket, pcm: Buffer, trailingSilenceMs = 0) {
  const frame = Math.round(AUDIO_RATE * 0.04) * 2;
  const all = Buffer.concat([pcm, Buffer.alloc(Math.round((AUDIO_RATE * trailingSilenceMs) / 1000) * 2)]);
  for (let i = 0; i < all.length; i += frame) {
    ws.send(all.subarray(i, i + frame));
    await sleep(40);
  }
}

class Client {
  messages: { at: number; m: any }[] = [];
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(data.toString());
      this.messages.push({ at: Date.now(), m });
      for (const w of [...this.waiters]) if (w.pred(m)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(m);
      }
    });
  }
  static open(url: string) {
    return new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new Client(ws);
      ws.once("open", () => resolve(c));
      ws.once("error", reject);
      ws.once("unexpected-response", (_q, res) => reject(new Error(`upgrade refused: HTTP ${res.statusCode}`)));
    });
  }
  send(m: Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }
  /** Resolves with the first matching message after index `from` (default: any, including past ones). */
  wait(pred: (m: any) => boolean, timeoutMs: number, what: string, from = 0): Promise<any> {
    const past = this.messages.slice(from).find((x) => pred(x.m));
    if (past) return Promise.resolve(past.m);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x.resolve !== done);
        const err = this.messages.filter((x) => x.m.type === "error").map((x) => x.m.message);
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}${err.length ? `; errors: ${err.join(" | ")}` : ""}`));
      }, timeoutMs);
      const done = (m: any) => {
        clearTimeout(t);
        resolve(m);
      };
      this.waiters.push({ pred, resolve: done });
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const endpoint = (() => {
    try {
      const u = new URL(base.bosonRealtimeUrl);
      return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    } catch {
      return "(invalid URL)";
    }
  })();
  if (!KEY) {
    record({ name: "credentials", status: requireKey ? "fail" : "skipped", detail: "BOSON_API_KEY is not set; no live check was run." });
    return finish(startedAt, endpoint);
  }
  record({ name: "credentials", status: "pass", detail: "BOSON_API_KEY is present (value not logged)." });

  // 1. Speech fixtures from Higgs itself.
  const expertLine = "In mid twenty twenty four we were about four hygienist positions short across my eleven clinics, so some chairs sat empty most weeks.";
  const consultantLine = "Where were we on this project?";
  const consentLine = "Yes, I'm happy to take part.";
  let expert: Awaited<ReturnType<typeof synthesize>>;
  let consultant: Awaited<ReturnType<typeof synthesize>>;
  let consentSpeech: Awaited<ReturnType<typeof synthesize>>;
  try {
    expert = await synthesize(expertLine);
    consultant = await synthesize(consultantLine);
    consentSpeech = await synthesize(consentLine);
    const ok = expert.pcm.length > AUDIO_RATE && consultant.pcm.length > AUDIO_RATE / 2;
    record({
      name: "higgs_speech_output",
      status: ok ? "pass" : "fail",
      ms: expert.ms,
      detail: `Synthesized ${(expert.pcm.length / 2 / AUDIO_RATE).toFixed(1)} s and ${(consultant.pcm.length / 2 / AUDIO_RATE).toFixed(1)} s of 24 kHz PCM16 speech.`,
      data: { expertTranscript: expert.transcript, consultantTranscript: consultant.transcript },
    });
    if (!ok) return finish(startedAt, endpoint);
  } catch (e) {
    record({ name: "higgs_speech_output", status: "fail", detail: (e as Error).message });
    return finish(startedAt, endpoint);
  }

  // 2. The application, in-process, with live voice and deterministic reasoning.
  const dataDir = mkdtempSync(path.join(tmpdir(), "dl-live-probe-"));
  const { svc, server, port } = await startServer({ host: "127.0.0.1", port: 0, dataDir, allowLiveVoiceMockReasoning: true, serveStatic: false, accessToken: undefined });
  const http = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}`;
  const post = async (p: string, body: unknown = {}) => {
    const r = await fetch(http + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(`${p} -> ${r.status} ${j?.error ?? ""}`);
    return j;
  };
  try {
    const { id: projectId } = await post("/api/demo/northstar");
    const expertId = (svc.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = 'Dana Whitfield'").get(projectId) as any).id;
    await interviewChecks(svc, post, ws, projectId, expertId, expert, expertLine, consentSpeech);
    await copilotChecks(svc, ws, projectId, consultant, consultantLine);
    if (svc.capabilities().reasoningProvider === "anthropic") {
      const t0 = Date.now();
      try {
        const real = (svc as any).real ?? (svc.engine as any).providers.real;
        const planId = await runPlanner(svc.ctx, real, projectId);
        record({ name: "anthropic_planner", status: planId ? "pass" : "fail", ms: Date.now() - t0, detail: "Real planner proposal passed validation and was applied." });
      } catch (e) {
        record({ name: "anthropic_planner", status: "fail", ms: Date.now() - t0, detail: (e as Error).message });
      }
    } else record({ name: "anthropic_planner", status: "skipped", detail: "ANTHROPIC_API_KEY is not set; reasoning used the deterministic mock." });
  } catch (e) {
    record({ name: "probe_runtime", status: "fail", detail: (e as Error).stack ?? String(e) });
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    svc.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  return finish(startedAt, endpoint);
}

async function interviewChecks(
  svc: any,
  post: (p: string, b?: unknown) => Promise<any>,
  ws: string,
  projectId: string,
  expertId: string,
  expert: { pcm: Buffer },
  expertLine: string,
  consentSpeech: { pcm: Buffer },
) {
  const db = svc.db;
  const { id: iid } = await post(`/api/projects/${projectId}/interviews`, { expertId, mode: "live_voice_mock_reasoning" });
  const { joinToken } = await post(`/api/projects/${projectId}/interviews/${iid}/start`);
  nextRole = "interview";
  const c = await Client.open(`${ws}/ws/participant?token=${encodeURIComponent(joinToken)}`);
  const audioFor = new Map<string, number>();
  c.ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(data.toString());
    if (m.type === "audio") audioFor.set(m.deliveryId, (audioFor.get(m.deliveryId) ?? 0) + 1);
    // Behave like the browser player: report drained once the server says no more audio is coming.
    if (m.type === "audio_done") c.send({ type: "playback", event: "drained", deliveryId: m.deliveryId });
    if (m.type === "flush") c.send({ type: "playback", event: "flushed", deliveryId: m.deliveryId, playedMs: 120 });
  });
  const interviewConn = () => [...conns.values()].filter((l) => l.role === "interview").at(-1);
  try {
    const t0 = Date.now();
    await c.wait((m) => m.type === "state" && m.transport === "ready", 15000, "voice session ready");
    const ack = interviewConn();
    record({
      name: "interview_session_ack",
      // Absent is tolerated here (the app does the same) and verified behaviourally below; any other value fails.
      status: ack && (ack.ackTurnDetection === null || ack.ackTurnDetection === "(absent)") ? "pass" : "fail",
      ms: Date.now() - t0,
      detail: `session acknowledged; turn_detection=${JSON.stringify(ack?.ackTurnDetection)}; transcription=${JSON.stringify(ack?.ackTranscription)}`,
    });
    const intro = await c.wait((m) => m.type === "audio_done", 30000, "intro audio");
    const introDelivery = db.prepare("SELECT kind FROM delivery_attempts WHERE id = ?").get(intro.deliveryId) as any;
    record({ name: "interview_intro_audio", status: introDelivery?.kind === "intro" && (audioFor.get(intro.deliveryId) ?? 0) > 0 ? "pass" : "fail", ms: Date.now() - t0, detail: `intro delivered with ${audioFor.get(intro.deliveryId) ?? 0} audio chunks` });
    // Spoken consent, as on a phone call: the participant answers the participation request out loud.
    await sleep(300);
    const tConsent = Date.now();
    c.send({ type: "speech_start" });
    await stream(c.ws, consentSpeech.pcm, 200);
    c.send({ type: "speech_end", vadHangoverMs: 500 });
    const consented = await waitDb(() => (db.prepare("SELECT consent FROM interviews WHERE id = ?").get(iid) as any)?.consent === "accepted", 20000);
    const civ = db.prepare("SELECT consent, consent_method, consent_turn_id FROM interviews WHERE id = ?").get(iid) as any;
    const heard = civ?.consent_turn_id
      ? (db.prepare("SELECT v.text FROM transcript_versions v JOIN transcript_turns t ON t.id = v.turn_id AND v.version = t.current_version WHERE t.id = ?").get(civ.consent_turn_id) as any)?.text
      : (db.prepare("SELECT v.text FROM transcript_turns t JOIN transcript_versions v ON v.turn_id = t.id AND v.version = t.current_version WHERE t.interview_id = ? AND t.speaker = 'expert' ORDER BY t.seq DESC LIMIT 1").get(iid) as any)?.text;
    record({
      name: "interview_spoken_consent",
      status: consented && civ.consent_method === "verbal" ? "pass" : "fail",
      ms: Date.now() - tConsent,
      detail: consented ? `consent accepted from the spoken answer "${heard ?? ""}"` : `no consent after the spoken answer (heard: ${JSON.stringify(heard ?? null)}); continuing with the on-screen control`,
    });
    if (!consented) c.send({ type: "consent", accepted: true });
    const q1 = await c.wait((m) => m.type === "audio_done" && m.deliveryId !== intro.deliveryId, 30000, "first question audio");
    await waitDb(() => (db.prepare("SELECT state FROM delivery_attempts WHERE id = ?").get(q1.deliveryId) as any)?.state === "completed", 5000);
    const q1row = db.prepare("SELECT d.state, d.authorized_text, d.actual_transcript, q.fixture_key FROM delivery_attempts d LEFT JOIN questions q ON q.id = d.question_id WHERE d.id = ?").get(q1.deliveryId) as any;
    record({
      name: "interview_authorized_question_spoken",
      status: q1row?.state === "completed" && (audioFor.get(q1.deliveryId) ?? 0) > 0 ? "pass" : "fail",
      detail: `question ${q1row?.fixture_key} ${q1row?.state}; spoken transcript recall of authorized text ${wordRecall(q1row?.authorized_text ?? "", q1row?.actual_transcript ?? "").toFixed(2)}`,
      data: { authorized: q1row?.authorized_text, spoken: q1row?.actual_transcript },
    });

    // Expert answers; the app commits the turn and waits for the final transcription before reasoning.
    const before = c.messages.length;
    const tSpeech = Date.now();
    c.send({ type: "speech_start" });
    await stream(c.ws, expert.pcm, 200);
    c.send({ type: "speech_end", vadHangoverMs: 500 });
    const committed = await c.wait((m) => m.type === "turn_committed", 5000, "turn committed", before);
    const tCommit = Date.now();
    await waitDb(() => (db.prepare("SELECT finality FROM transcript_turns WHERE id = ?").get(committed.turnId) as any)?.finality !== "pending", 20000);
    const turn = db.prepare("SELECT t.finality, v.text FROM transcript_turns t LEFT JOIN transcript_versions v ON v.turn_id = t.id AND v.version = t.current_version WHERE t.id = ?").get(committed.turnId) as any;
    const recall = wordRecall(expertLine, turn?.text ?? "");
    record({
      name: "interview_final_transcription",
      status: turn?.finality === "final" && recall >= 0.6 ? "pass" : "fail",
      ms: Date.now() - tCommit,
      detail: `finality=${turn?.finality}; word recall ${recall.toFixed(2)} after ${((tCommit - tSpeech) / 1000).toFixed(1)} s of streamed speech`,
      data: { heard: turn?.text ?? null },
    });
    const decided = await waitDb(() => (db.prepare("SELECT COUNT(*) AS n FROM controller_decisions WHERE interview_id = ? AND trigger LIKE 'expert_turn%'").get(iid) as any).n > 0, 20000);
    const decision = db.prepare("SELECT result, trigger FROM controller_decisions WHERE interview_id = ? ORDER BY created_at DESC LIMIT 1").get(iid) as any;
    record({ name: "interview_controller_after_final_transcript", status: decided ? "pass" : "fail", detail: `controller decision ${decision?.result ?? "none"} (${decision?.trigger ?? ""})` });

    // Barge-in on the next authorized question: cancel, flush, truncate, interrupted delivery, no stale audio.
    const sentBefore = interviewConn()!.sent.length;
    const next = await c.wait((m) => m.type === "audio" && m.deliveryId !== q1.deliveryId && m.deliveryId !== intro.deliveryId, 30000, "next question audio", before);
    c.send({ type: "speech_start", playedMs: 120 });
    const flushAt = Date.now();
    await c.wait((m) => m.type === "flush" && m.deliveryId === next.deliveryId, 5000, "flush", before);
    await waitDb(() => (db.prepare("SELECT state FROM delivery_attempts WHERE id = ?").get(next.deliveryId) as any)?.state === "interrupted", 5000);
    await sleep(1500);
    const lateAudio = c.messages.filter((x) => x.at > flushAt + 50 && x.m.type === "audio" && x.m.deliveryId === next.deliveryId).length;
    const sentAfter = interviewConn()!.sent.slice(sentBefore);
    const nd = db.prepare("SELECT state, played_ms, interruption_detail FROM delivery_attempts WHERE id = ?").get(next.deliveryId) as any;
    const cancelSent = sentAfter.includes("response.cancel");
    record({
      name: "interview_barge_in",
      status: nd?.state === "interrupted" && sentAfter.includes("conversation.item.truncate") && lateAudio === 0 ? "pass" : "fail",
      detail: `delivery ${nd?.state} at ${nd?.played_ms} ms; response.cancel ${cancelSent ? "sent" : "not needed (generation had finished)"}; truncate ${sentAfter.includes("conversation.item.truncate") ? "sent" : "missing"}; ${lateAudio} audio chunk(s) forwarded after flush`,
      data: { sentAfterBargeIn: sentAfter, providerTruncateAck: interviewConn()!.received.includes("conversation.item.truncated") },
    });
    // Finish the barge-in turn so the transcript stays complete, then end gracefully.
    await stream(c.ws, expert.pcm.subarray(0, Math.min(expert.pcm.length, AUDIO_RATE * 2 * 2)), 200);
    c.send({ type: "speech_end", vadHangoverMs: 500 });
    await sleep(500);
    await post(`/api/projects/${projectId}/interviews/${iid}/stop`, { reason: "consultant_ended" });
    await c.wait((m) => m.type === "ended", 15000, "ended", before);
    // Application-controlled turns: the provider must never start a response the app did not request.
    const log = interviewConn()!;
    const requested = log.sent.filter((t) => t === "response.create").length;
    const created = log.received.filter((t) => t === "response.created").length;
    record({
      name: "interview_no_provider_initiated_responses",
      status: created <= requested ? "pass" : "fail",
      detail: `${requested} response.create sent, ${created} response.created received${log.ackTurnDetection === "(absent)" ? "; the ack did not echo turn_detection, so this behavioural check is the evidence" : ""}`,
    });
    const metrics = db.prepare("SELECT name, ms FROM latency_metrics WHERE interview_id = ? ORDER BY created_at").all(iid) as any[];
    record({
      name: "interview_end_and_metrics",
      status: "pass",
      detail: `ended; metrics: ${metrics.map((m) => `${m.name}=${m.ms}`).join(", ")}`,
      data: { metrics },
    });
  } catch (e) {
    record({ name: "interview_flow", status: "fail", detail: (e as Error).message });
  } finally {
    c.close();
  }
}

async function copilotChecks(svc: any, ws: string, projectId: string, consultant: { pcm: Buffer }, consultantLine: string) {
  const db = svc.db;
  nextRole = "copilot";
  let c: Client;
  try {
    c = await Client.open(`${ws}/ws/copilot?project=${encodeURIComponent(projectId)}`);
  } catch (e) {
    record({ name: "copilot_connect", status: "fail", detail: (e as Error).message });
    return;
  }
  c.ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(data.toString());
    if (m.type === "flush") c.send({ type: "playback", event: "flushed", responseId: m.responseId, playedMs: 0 });
  });
  const conn = () => [...conns.values()].filter((l) => l.role === "copilot").at(-1)!;
  try {
    const t0 = Date.now();
    await c.wait((m) => m.type === "ready", 15000, "copilot ready");
    const ack = conn();
    const td = ack.ackTurnDetection as any;
    record({ name: "copilot_session_ack", status: td && td.type === "server_vad" ? "pass" : "fail", ms: Date.now() - t0, detail: `turn_detection=${JSON.stringify(td)}` });
    c.send({ type: "start_briefing" });
    const briefing = await c.wait((m) => m.type === "assistant_text", 30000, "spoken briefing");
    const audioChunks = c.messages.filter((x) => x.m.type === "audio").length;
    record({ name: "copilot_briefing", status: audioChunks > 0 && ack.sent.filter((t) => t === "response.create").length === 1 ? "pass" : "fail", ms: Date.now() - t0, detail: `${audioChunks} audio chunks; one explicit response.create`, data: { text: briefing.text } });
    await sleep(800);

    const before = c.messages.length;
    const sentBefore = conn().sent.length;
    const tSpeak = Date.now();
    await stream(c.ws, consultant.pcm, 1500);
    const user = await c.wait((m) => m.type === "user_text", 20000, "consultant transcription", before);
    record({ name: "copilot_transcription", status: wordRecall(consultantLine, user.text) >= 0.5 ? "pass" : "fail", ms: Date.now() - tSpeak, detail: `heard "${user.text}"` });
    await waitDb(() => (db.prepare("SELECT COUNT(*) AS n FROM copilot_messages WHERE project_id = ? AND role = 'tool'").get(projectId) as any).n > 0, 30000);
    const tool = db.prepare("SELECT tool_name, text FROM copilot_messages WHERE project_id = ? AND role = 'tool' ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
    const answer = await c.wait((m) => m.type === "assistant_text", 30000, "answer after tool output", before).catch(() => null);
    await sleep(1000);
    const sent = conn().sent.slice(sentBefore);
    const outputs = sent.filter((t) => t === "conversation.item.create").length;
    const continuations = sent.filter((t) => t === "response.create").length;
    record({
      name: "copilot_tool_loop",
      status: tool && outputs >= 1 && continuations === 1 && answer ? "pass" : "fail",
      ms: Date.now() - tSpeak,
      detail: `tool ${tool?.tool_name ?? "none"}; ${outputs} function_call_output(s) then ${continuations} response.create; spoken answer ${answer ? "received" : "missing"}`,
      data: { answer: answer?.text ?? null, navigated: c.messages.some((x) => x.m.type === "navigate") },
    });
  } catch (e) {
    record({ name: "copilot_flow", status: "fail", detail: (e as Error).message });
  } finally {
    c.close();
  }
}

async function waitDb(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(100);
  }
  return pred();
}

function finish(startedAt: string, endpoint: string) {
  const failed = checks.filter((c) => c.status === "fail").length;
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    endpoint,
    model: base.bosonModel,
    transcriptionModel: base.transcriptionModel,
    summary: { pass: checks.filter((c) => c.status === "pass").length, fail: failed, skipped: checks.filter((c) => c.status === "skipped").length },
    checks,
    connections: [...conns.values()].map((l) => ({ ...l, sent: tally(l.sent), received: tally(l.received) })),
  };
  const text = scrub(JSON.stringify(result, null, 2));
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, text + "\n");
  console.log(`\n${result.summary.pass} passed, ${failed} failed, ${result.summary.skipped} skipped. Results: ${path.relative(process.cwd(), outPath)}`);
  process.exit(failed ? 1 : 0);
}

function tally(types: string[]) {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

main().catch((e) => {
  record({ name: "probe_runtime", status: "fail", detail: (e as Error).stack ?? String(e) });
  finish(new Date().toISOString(), "(unknown)");
});
