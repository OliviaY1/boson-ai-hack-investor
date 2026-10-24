// Voice protocol fixtures (verification gate 2): the real session classes run against a local fake
// Higgs server. These prove ordering and isolation rules; they are not live provider checks.
import { afterEach, describe, expect, it } from "vitest";
import { createInterview, getInterview, recordConsent, participantJoined, startInterview } from "../backend/src/domain/interviews";
import { MockReasoningProvider } from "../backend/src/providers/mock";
import { OPERATOR_SCRIPT } from "../backend/src/providers/northstarFixture";
import { CLARIFY_TEXT, INTRO_TEXT } from "../backend/src/providers/prompts";
import { CopilotVoiceSession } from "../backend/src/voice/copilotVoice";
import { describeClose } from "../backend/src/voice/higgs";
import { InterviewVoiceSession, type VoiceSettings } from "../backend/src/voice/interviewVoice";
import { FakeConn, FakeHiggs, FakeParticipant, type FakeHiggsOptions } from "./fakeHiggs";
import { expertByName, makeEnv, tick, waitFor, type TestEnv } from "./helpers";

let cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function voiceSetup(fakeOpts: FakeHiggsOptions = {}, localTest = false) {
  const fake = await FakeHiggs.start(fakeOpts);
  const mock = new MockReasoningProvider();
  const env: TestEnv = makeEnv({ bosonApiKey: "test-key", bosonRealtimeUrl: fake.url, allowLiveVoiceMockReasoning: true, transcriptionTimeoutMs: 300 }, { mock });
  cleanups.push(() => fake.close(), () => env.cleanup());
  const { svc } = env;
  const projectId = await svc.seedNorthstar();
  const interviewId = createInterview(svc.ctx, projectId, expertByName(svc, projectId, "Dana Whitfield"), "live_voice_mock_reasoning", localTest);
  startInterview(svc.ctx, interviewId, 60);
  return { fake, mock, svc, projectId, interviewId };
}

async function joinVoice(s: Awaited<ReturnType<typeof voiceSetup>>, extra: Partial<VoiceSettings> = {}) {
  const part = new FakeParticipant();
  const session = new InterviewVoiceSession(s.svc.ctx, s.svc.engine, s.interviewId, part, { ...s.svc.voiceSettings()!, ackTimeoutMs: 2000, ...extra });
  cleanups.push(() => session.onParticipantClosed());
  const connP = s.fake.nextConn();
  await session.start();
  const conn = await connP;
  return { part, session, conn };
}

/** Play the pending response.create and report browser playback drained. */
async function playNext(conn: FakeConn, part: FakeParticipant, session: InterviewVoiceSession, rid: string, nth: number) {
  await waitFor(() => conn.count("response.create") >= nth, 3000, `response.create #${nth}`);
  const before = part.of("audio_done").length;
  conn.respond(rid, { transcript: `spoken ${rid}` });
  await waitFor(() => part.of("audio_done").length > before, 3000, "audio_done");
  const done = part.of("audio_done").at(-1)!;
  await session.onMessage({ type: "playback", event: "drained", deliveryId: done.deliveryId, playedMs: 200 });
  return done.deliveryId as string;
}

function deliveryState(svc: any, id: string) {
  return (svc.db.prepare("SELECT state FROM delivery_attempts WHERE id = ?").get(id) as any).state;
}

async function expertSpeaks(session: InterviewVoiceSession, conn: FakeConn, itemId: string) {
  await session.onMessage({ type: "speech_start" });
  session.onAudio(Buffer.alloc(9600)); // 200 ms of PCM16 at 24 kHz
  const commits = conn.count("input_audio_buffer.commit");
  await session.onMessage({ type: "speech_end", vadHangoverMs: 700 });
  await waitFor(() => conn.count("input_audio_buffer.commit") > commits, 2000, "commit");
  conn.send({ type: "input_audio_buffer.committed", item_id: itemId });
}

describe("expert interview voice session (application-controlled turns)", () => {
  it("configures turn_detection null, authenticates server-side, and speaks only after a committed controller decision", async () => {
    const s = await voiceSetup();
    let releaseHook!: () => void;
    let hookCalls = 0;
    s.mock.controlHook = async (_env, p) => {
      hookCalls++;
      if (hookCalls === 1) await new Promise<void>((r) => (releaseHook = r));
      return p;
    };
    const { part, session, conn } = await joinVoice(s);
    const upd = conn.received.find((m) => m.type === "session.update");
    expect(upd.session.audio.input.turn_detection).toBeNull();
    expect(upd.session.audio.input.transcription.model).toBe("higgs-stt-3.1");
    expect(conn.authorization).toBe("Bearer test-key");
    expect(part.messages.some((m) => JSON.stringify(m).includes("test-key"))).toBe(false);

    // Intro: a fixed, authorized utterance with AI identification and the consent request.
    const intro = await conn.waitFor("response.create");
    expect(intro.response.instructions).toContain(INTRO_TEXT.slice(0, 40));
    await playNext(conn, part, session, "r_intro", 1);

    // No audio is forwarded to Higgs before consent.
    session.onAudio(Buffer.alloc(4800));
    expect(conn.count("input_audio_buffer.append")).toBe(0);

    await session.onMessage({ type: "consent", accepted: true });
    await waitFor(() => hookCalls === 1, 2000, "controller call");
    await tick(100);
    // Controller is still reasoning: no question may be spoken yet.
    expect(conn.count("response.create")).toBe(1);
    releaseHook();
    await s.svc.engine.whenIdle(s.interviewId);
    const q1 = await conn.waitFor("response.create", (m) => m !== intro);
    const applied = s.svc.db.prepare("SELECT COUNT(*) AS n FROM controller_decisions WHERE interview_id = ? AND result = 'applied'").get(s.interviewId) as any;
    expect(applied.n).toBeGreaterThan(0);
    const staffing = OPERATOR_SCRIPT.q_staffing; // the scripted answer text
    const authorized = s.svc.db.prepare("SELECT authorized_text FROM delivery_attempts WHERE interview_id = ? AND kind = 'question' ORDER BY queued_at DESC LIMIT 1").get(s.interviewId) as any;
    expect(q1.response.instructions).toContain(authorized.authorized_text);
    const d1 = await playNext(conn, part, session, "r_q1", 2);
    expect(deliveryState(s.svc, d1)).toBe("completed");

    // Expert turn: commit → committed → (no speech until transcription + decision) → next question.
    await expertSpeaks(session, conn, "item_u1");
    expect(conn.count("input_audio_buffer.append")).toBeGreaterThan(0);
    await tick(150);
    expect(conn.count("response.create")).toBe(2);
    // Duplicate provider delivery of the same transcription event is ignored.
    conn.sendDuplicate({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_u1", transcript: staffing.text });
    await waitFor(() => conn.count("response.create") === 3, 3000, "next question");
    await s.svc.engine.whenIdle(s.interviewId);
    await tick(100);
    expect(conn.count("response.create")).toBe(3);
    const expertTurns = s.svc.db.prepare("SELECT COUNT(*) AS n FROM transcript_turns WHERE interview_id = ? AND speaker = 'expert'").get(s.interviewId) as any;
    expect(expertTurns.n).toBe(1);
    const turnDecisions = s.svc.db.prepare("SELECT COUNT(*) AS n FROM controller_decisions WHERE interview_id = ? AND trigger = 'expert_turn'").get(s.interviewId) as any;
    expect(turnDecisions.n).toBe(1);
    const metrics = (s.svc.db.prepare("SELECT name FROM latency_metrics WHERE interview_id = ?").all(s.interviewId) as any[]).map((m) => m.name);
    for (const n of ["turn_end_detection_ms", "final_transcription_ms", "controller_ms", "validation_commit_ms", "response_start_ms", "first_audio_forwarded_ms"]) expect(metrics).toContain(n);
  });

  it("drops stale audio and, on barge-in, cancels, flushes playback, truncates at the played position, and never marks the question delivered", async () => {
    const s = await voiceSetup();
    const { part, session, conn } = await joinVoice(s);
    await playNext(conn, part, session, "r_intro", 1);
    await session.onMessage({ type: "consent", accepted: true });
    await waitFor(() => conn.count("response.create") === 2, 3000, "first question");
    conn.respond("r_q1", { chunks: 2, done: false });
    await waitFor(() => part.of("audio").length === 4, 2000, "question audio");
    const deliveryId = part.of("audio").at(-1)!.deliveryId;

    conn.audio("r_unrelated");
    await tick(50);
    expect(part.of("audio").length).toBe(4);
    expect(session.droppedAudio).toBe(1);

    await session.onMessage({ type: "speech_start", playedMs: 120 });
    const trunc = await conn.waitFor("conversation.item.truncate");
    expect(conn.count("response.cancel")).toBe(1);
    expect(trunc.item_id).toBe("item_r_q1");
    expect(trunc.audio_end_ms).toBe(120);
    expect(part.of("flush").some((m) => m.deliveryId === deliveryId)).toBe(true);
    conn.audio("r_q1");
    conn.finish("r_q1");
    await tick(80);
    expect(part.of("audio").length).toBe(4);
    const d = s.svc.db.prepare("SELECT state, played_ms FROM delivery_attempts WHERE id = ?").get(deliveryId) as any;
    expect(d.state).toBe("interrupted");
    expect(d.played_ms).toBe(120);
    const coverage = s.svc.db.prepare("SELECT coverage FROM interview_question_state s JOIN delivery_attempts d ON d.question_id = s.question_id AND d.interview_id = s.interview_id WHERE d.id = ?").get(deliveryId) as any;
    expect(coverage.coverage).toBe("pending");
  });

  it("waits, then asks for clarification when a transcription never arrives, and never invents an answer; a late transcription completes the record", async () => {
    const s = await voiceSetup();
    const { part, session, conn } = await joinVoice(s);
    await playNext(conn, part, session, "r_intro", 1);
    await session.onMessage({ type: "consent", accepted: true });
    await playNext(conn, part, session, "r_q1", 2);
    await expertSpeaks(session, conn, "item_silent");
    const turn = () => s.svc.db.prepare("SELECT * FROM transcript_turns WHERE interview_id = ? AND speaker = 'expert'").get(s.interviewId) as any;
    await waitFor(() => turn()?.finality === "missing", 2000, "missing transcription");
    const clar = await conn.waitFor("response.create", (m) => String(m.response?.instructions).includes(CLARIFY_TEXT.slice(0, 30)));
    expect(clar).toBeTruthy();
    expect((s.svc.db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE turn_id = ?").get(turn().id) as any).n).toBe(0);
    conn.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_silent", transcript: "Late words." });
    await waitFor(() => turn().finality === "final", 2000, "late transcript");
  });

  it("opt-out ends immediately; pending work is cancelled and late transcripts never restart speech", async () => {
    const s = await voiceSetup();
    const { part, session, conn } = await joinVoice(s);
    await playNext(conn, part, session, "r_intro", 1);
    await session.onMessage({ type: "consent", accepted: true });
    await waitFor(() => conn.count("response.create") === 2, 3000, "first question");
    conn.respond("r_q1", { done: false });
    await waitFor(() => part.of("speaking").length === 2, 2000, "question speaking");
    const speaks = expertSpeaks(session, conn, "item_u9");
    // Barge-in cancels the question; the provider confirms with response.done before the commit is sent.
    await conn.waitFor("response.cancel");
    conn.send({ type: "response.done", response: { id: "r_q1", status: "cancelled", output: [] } });
    await speaks;
    s.svc.engine.optOut(s.interviewId);
    expect(getInterview(s.svc.ctx, s.interviewId).lifecycle).toBe("ended");
    expect(getInterview(s.svc.ctx, s.interviewId).consent).toBe("withdrawn");
    await waitFor(() => conn.count("response.cancel") >= 1, 2000, "cancel");
    expect(part.of("ended").length).toBe(1);
    const creates = conn.count("response.create");
    s.svc.engine.onExpertTurnFinal(s.interviewId);
    await s.svc.engine.whenIdle(s.interviewId);
    await tick(50);
    expect(conn.count("response.create")).toBe(creates);
    expect(getInterview(s.svc.ctx, s.interviewId).active_slot).toBeNull();
  });

  it("withdraws a question the provider has not started when the expert speaks, and never gives its late response to the next delivery", async () => {
    const s = await voiceSetup();
    const { part, session, conn } = await joinVoice(s);
    await playNext(conn, part, session, "r_intro", 1);
    await session.onMessage({ type: "consent", accepted: true });
    await waitFor(() => conn.count("response.create") === 2, 3000, "first question requested");
    const q1 = s.svc.db.prepare("SELECT id FROM delivery_attempts WHERE interview_id = ? AND kind = 'question'").get(s.interviewId) as any;

    // The expert starts talking before response.created arrives.
    const barge = session.onMessage({ type: "speech_start" });
    await session.onMessage({ type: "playback", event: "flushed", playedMs: 0 });
    await barge;
    expect(deliveryState(s.svc, q1.id)).toBe("cancelled");
    await waitFor(() => conn.count("response.cancel") === 1, 2000, "early cancel");
    session.onAudio(Buffer.alloc(9600));
    await session.onMessage({ type: "speech_end", vadHangoverMs: 700 });
    await tick(50);
    // The cancelled request may still become an active generation, so the commit waits.
    expect(conn.count("input_audio_buffer.commit")).toBe(0);

    // The late response.created belongs to the withdrawn question: cancelled, its audio dropped.
    conn.send({ type: "response.created", response: { id: "r_late", status: "in_progress" } });
    conn.audio("r_late");
    await waitFor(() => conn.count("response.cancel") === 2, 2000, "late response cancelled");
    expect(part.of("audio").filter((m) => m.deliveryId === q1.id).length).toBe(0);
    conn.send({ type: "response.done", response: { id: "r_late", status: "cancelled", output: [] } });
    await waitFor(() => conn.count("input_audio_buffer.commit") === 1, 2000, "deferred commit");
    conn.send({ type: "input_audio_buffer.committed", item_id: "item_u1" });
    conn.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_u1", transcript: OPERATOR_SCRIPT.q_staffing.text });

    // The next question gets its own response; the withdrawn one is never marked delivered.
    const d2 = await playNext(conn, part, session, "r_q2", 3);
    const row = s.svc.db.prepare("SELECT state, provider_response_id FROM delivery_attempts WHERE id = ?").get(d2) as any;
    expect(row).toEqual({ state: "completed", provider_response_id: "r_q2" });
    expect(deliveryState(s.svc, q1.id)).toBe("cancelled");
    expect(session.droppedAudio).toBeGreaterThan(0);
  });

  it("cancels a provider-initiated response, never forwards it, and holds new speech until it has finished", async () => {
    const s = await voiceSetup();
    const { part, session, conn } = await joinVoice(s);
    await playNext(conn, part, session, "r_intro", 1);
    await session.onMessage({ type: "consent", accepted: true });
    await playNext(conn, part, session, "r_q1", 2);
    await expertSpeaks(session, conn, "item_u1");
    const audioBefore = part.of("audio").length;

    // The provider starts a reply on its own after the commit (application-controlled turns should prevent this).
    conn.send({ type: "response.created", response: { id: "r_auto", status: "in_progress" } });
    conn.audio("r_auto");
    await waitFor(() => conn.count("response.cancel") === 1, 2000, "unrequested response cancelled");
    expect(session.unrequestedResponseCount).toBe(1);
    expect(part.of("audio").length).toBe(audioBefore);

    conn.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_u1", transcript: OPERATOR_SCRIPT.q_staffing.text });
    await s.svc.engine.whenIdle(s.interviewId);
    await tick(100);
    // The controller has authorized the next question, but nothing is requested while r_auto is active.
    expect(conn.count("response.create")).toBe(2);
    conn.send({ type: "response.done", response: { id: "r_auto", status: "cancelled", output: [] } });
    const d = await playNext(conn, part, session, "r_q2", 3);
    expect(deliveryState(s.svc, d)).toBe("completed");
    const fromAuto = s.svc.db.prepare("SELECT COUNT(*) AS n FROM delivery_attempts WHERE provider_response_id = 'r_auto'").get() as any;
    expect(fromAuto.n).toBe(0);
  });

  it("treats a provider that never starts a response as unresponsive: the delivery fails and the interview becomes resumable", async () => {
    const s = await voiceSetup();
    const { part, conn } = await joinVoice(s, { responseStartTimeoutMs: 300 });
    await conn.waitFor("response.create");
    await waitFor(() => getInterview(s.svc.ctx, s.interviewId).lifecycle === "interrupted", 3000, "interrupted");
    const intro = s.svc.db.prepare("SELECT state, interruption_detail FROM delivery_attempts WHERE interview_id = ? AND kind = 'intro'").get(s.interviewId) as any;
    expect(intro.state).toBe("failed");
    expect(intro.interruption_detail).toMatch(/did not start/);
    expect(part.of("error").at(-1)?.message).toMatch(/resume/);
    expect(getInterview(s.svc.ctx, s.interviewId).pause_reason).toBe("provider_unresponsive");
    expect(conn.count("response.create")).toBe(1); // nothing retried blindly
  });

  it("lets a rejoin supersede the previous participant session without interrupting the interview", async () => {
    const s = await voiceSetup();
    const first = await joinVoice(s);
    await playNext(first.conn, first.part, first.session, "r_intro", 1);
    await first.session.onMessage({ type: "consent", accepted: true });
    await waitFor(() => first.conn.count("response.create") === 2, 3000, "first question");
    first.conn.respond("r_q1", { done: false });
    await waitFor(() => first.part.of("speaking").length === 2, 2000, "question speaking");
    const q1 = s.svc.db.prepare("SELECT id FROM delivery_attempts WHERE interview_id = ? AND kind = 'question'").get(s.interviewId) as any;

    const second = await joinVoice(s);
    expect(first.session.isSuperseded).toBe(true);
    expect(first.part.of("error").at(-1)?.message).toMatch(/another window/);
    await waitFor(() => first.part.closed, 1000, "old participant closed");
    expect(deliveryState(s.svc, q1.id)).toBe("unknown"); // audio may have reached the old window; not replayed as delivered
    // The old socket's close arriving late changes nothing.
    first.session.onParticipantClosed();
    expect(getInterview(s.svc.ctx, s.interviewId).lifecycle).toBe("active");
    expect(s.svc.engine.transportFor(s.interviewId)).toBe(second.session);
    expect(second.conn.received.some((m) => m.type === "session.update")).toBe(true);
  });

  it("refuses a provider session that does not accept application-controlled turns", async () => {
    const s = await voiceSetup({ ackSession: (req) => ({ ...req, audio: { ...req.audio, input: { ...req.audio.input, turn_detection: { type: "server_vad" } } } }) });
    const { part } = await joinVoice(s);
    expect(part.of("error")[0]?.message).toMatch(/application-controlled turns/);
    expect(getInterview(s.svc.ctx, s.interviewId).lifecycle).toBe("interrupted");
  });

  it("explains provider close codes without leaking the key", async () => {
    const s = await voiceSetup({ closeWith: { code: 3000, reason: "invalid key" } });
    const { part } = await joinVoice(s);
    expect(part.of("error")[0]?.message).toMatch(/API key/);
    expect(describeClose(1013, "").message).toMatch(/concurrency/);
    expect(describeClose(4429, "").retryable).toBe(false);
  });
});

describe("consultant copilot voice session (server VAD)", () => {
  async function copilotSetup(localTest = false) {
    const s = await voiceSetup({}, localTest);
    const client = new FakeParticipant();
    const session = new CopilotVoiceSession(s.svc.ctx, s.svc.engine, s.projectId, client, { ...s.svc.voiceSettings()!, ackTimeoutMs: 2000 });
    cleanups.push(() => session.close());
    return { ...s, client, session };
  }

  it("uses server VAD with scoped tools, sends one briefing response, and never duplicates automatic responses", async () => {
    const s = await copilotSetup();
    const connP = s.fake.nextConn();
    await s.session.start(false);
    const conn = await connP;
    const upd = conn.received.find((m) => m.type === "session.update");
    expect(upd.session.audio.input.turn_detection).toEqual({ type: "server_vad" });
    expect(upd.session.tools.map((t: any) => t.name)).toContain("get_handoff");
    expect(conn.count("response.create")).toBe(0);
    s.session.onMessage({ type: "start_briefing" });
    s.session.onMessage({ type: "start_briefing" });
    await waitFor(() => conn.count("response.create") === 1, 2000, "briefing");
    await tick(50);
    expect(conn.count("response.create")).toBe(1);
    conn.respond("r_brief", { transcript: "Here is the briefing." });
    await waitFor(() => s.client.of("assistant_text").length === 1);

    // Ordinary consultant turn: the server responds automatically; the client must not add response.create.
    conn.send({ type: "input_audio_buffer.speech_started" });
    conn.send({ type: "input_audio_buffer.speech_stopped" });
    conn.send({ type: "input_audio_buffer.committed", item_id: "u1" });
    conn.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "What changed since yesterday?" });
    conn.respond("r_auto", { transcript: "Two interviews ended." });
    await waitFor(() => s.client.of("assistant_text").length === 2);
    await tick(50);
    expect(conn.count("response.create")).toBe(1);

    // Tool call: one output per call id (deduplicated), then exactly one continuation.
    conn.send({ type: "response.created", response: { id: "r_tool" } });
    conn.send({ type: "response.function_call_arguments.done", response_id: "r_tool", call_id: "call_1", name: "get_project_status", arguments: "{}" });
    conn.send({ type: "response.done", response: { id: "r_tool", status: "completed", output: [{ type: "function_call", call_id: "call_1", name: "get_project_status", arguments: "{}" }] } });
    await waitFor(() => conn.count("response.create") === 2, 2000, "tool continuation");
    const outputs = conn.received.filter((m) => m.type === "conversation.item.create" && m.item?.type === "function_call_output");
    expect(outputs.map((o) => o.item.call_id)).toEqual(["call_1"]);
    expect(JSON.parse(outputs[0].item.output).summary).toMatch(/Plan: v1/);
    conn.send({ type: "response.done", response: { id: "r_tool_dup", status: "completed", output: [{ type: "function_call", call_id: "call_1", name: "get_project_status", arguments: "{}" }] } });
    await tick(80);
    expect(conn.count("response.create")).toBe(2);
  });

  it("barge-in cancels and flushes the current answer, drops its remaining audio, and truncates at the played position", async () => {
    const s = await copilotSetup();
    const connP = s.fake.nextConn();
    await s.session.start(false);
    const conn = await connP;
    s.session.onMessage({ type: "start_briefing" });
    conn.respond("r_b", { done: false, chunks: 2 });
    await waitFor(() => s.client.of("audio").length === 2);
    conn.send({ type: "input_audio_buffer.speech_started" });
    await waitFor(() => s.client.of("flush").length === 1);
    expect(conn.count("response.cancel")).toBe(1);
    conn.audio("r_b");
    await tick(50);
    expect(s.client.of("audio").length).toBe(2);
    s.session.onMessage({ type: "playback", event: "flushed", playedMs: 180 });
    const trunc = await conn.waitFor("conversation.item.truncate");
    expect(trunc.audio_end_ms).toBe(180);
  });

  it("keeps private consultant speech out of the interview and pauses a local interview test while active", async () => {
    const s = await copilotSetup(true);
    participantJoined(s.svc.ctx, s.interviewId);
    recordConsent(s.svc.ctx, s.interviewId, true);
    const connP = s.fake.nextConn();
    await s.session.start(true);
    const conn = await connP;
    expect(getInterview(s.svc.ctx, s.interviewId).lifecycle).toBe("paused");
    expect(getInterview(s.svc.ctx, s.interviewId).pause_reason).toBe("consultant_private_voice");
    conn.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "I think the operator is overstating the staffing problem." });
    await waitFor(() => (s.svc.db.prepare("SELECT COUNT(*) AS n FROM copilot_messages WHERE project_id = ? AND channel = 'voice'").get(s.projectId) as any).n === 1);
    expect((s.svc.db.prepare("SELECT COUNT(*) AS n FROM transcript_turns WHERE interview_id = ?").get(s.interviewId) as any).n).toBe(0);
    expect((s.svc.db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE interview_id = ?").get(s.interviewId) as any).n).toBe(0);
    s.session.close();
    expect(getInterview(s.svc.ctx, s.interviewId).lifecycle).toBe("active");
  });
});
