// Browser audio path against a SIMULATED Higgs endpoint, with Chromium's fake microphone fed a synthetic
// voice-like WAV (not speech). Exercises the real participant page: mic permission, AudioWorklet capture
// and resampling, energy VAD turn ends, PCM playback with drained reports, barge-in flush, and the closing
// line. It does not verify a real microphone, real speakers, echo, or the real provider.
//   npm run build && npm run test:browser-voice
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startServer } from "../../backend/src/index";
import { SIM_KEY, startSimHiggs } from "./simHiggs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: unknown, what: string) {
  if (!cond) throw new Error(`Browser voice check failed: ${what}`);
  console.log(`ok  ${what}`);
}

/** 1 s silence, 2 s amplitude-modulated harmonic tone, 4 s silence (Chromium loops the file). */
function voiceWav(file: string) {
  const rate = 48000;
  const samples: number[] = [];
  const silence = (s: number) => {
    for (let i = 0; i < Math.round(rate * s); i++) samples.push(0);
  };
  silence(1);
  for (let i = 0; i < rate * 2; i++) {
    const t = i / rate;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    const v = (0.35 * env * (Math.sin(2 * Math.PI * 170 * t) + 0.6 * Math.sin(2 * Math.PI * 340 * t) + 0.3 * Math.sin(2 * Math.PI * 510 * t))) / 1.9;
    samples.push(Math.round(v * 32767));
  }
  silence(4);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "dl-browser-voice-"));
  const wav = path.join(dir, "voice.wav");
  voiceWav(wav);
  const sim = await startSimHiggs({ expertTranscript: "We were about four hygienist positions short across my eleven clinics in mid 2024." });
  const { svc, server, port } = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(dir, "data"),
    anthropicApiKey: undefined,
    bosonApiKey: SIM_KEY,
    bosonRealtimeUrl: sim.url,
    allowLiveVoiceMockReasoning: true,
    accessToken: undefined,
    serveStatic: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const post = async (p: string, b: unknown = {}) => (await (await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json()) as any;
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const { id } = await post("/api/demo/northstar");
    const expertId = (svc.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = 'Dana Whitfield'").get(id) as any).id;
    const iv = await post(`/api/projects/${id}/interviews`, { expertId, mode: "live_voice_mock_reasoning" });
    const { joinPath } = await post(`/api/projects/${id}/interviews/${iv.id}/start`);
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["microphone"], { origin: base });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && errors.push(m.text()));
    await page.goto(base + joinPath);
    await page.getByRole("button", { name: "Join with microphone" }).click();
    await page.getByRole("button", { name: "I agree to participate" }).click({ timeout: 15000 });

    const rows = () => svc.db.prepare("SELECT kind, state, interruption_detail AS detail FROM delivery_attempts WHERE interview_id = ? ORDER BY queued_at").all(iv.id) as any[];
    const lifecycle = () => (svc.db.prepare("SELECT lifecycle FROM interviews WHERE id = ?").get(iv.id) as any).lifecycle;
    const end = Date.now() + 60000;
    while (Date.now() < end && !(lifecycle() === "ended" && rows().every((d) => d.state !== "speaking" && d.state !== "queued"))) await sleep(500);
    const ds = rows();
    const expertTurns = svc.db.prepare("SELECT finality FROM transcript_turns WHERE interview_id = ? AND speaker = 'expert'").all(iv.id) as any[];
    check(expertTurns.length >= 1 && expertTurns.every((t) => t.finality === "final"), `browser VAD committed ${expertTurns.length} expert turn(s), each with a final transcript`);
    check(ds.some((d) => d.kind === "question" && d.state === "completed" && /drained in browser/.test(d.detail ?? "")), "a question completed only after the browser reported playback drained");
    check(ds.some((d) => d.state === "interrupted" && /barge-in/.test(d.detail ?? "")), "speaking over the interviewer interrupted playback (barge-in)");
    check(lifecycle() === "ended" && ds.at(-1)?.kind === "closing" && ds.at(-1)?.state === "completed", "the closing line played to completion before the session closed");
    await page.waitForSelector("text=This interview has ended", { timeout: 10000 });
    check(true, "participant page shows the ended notice, not an invalid-link error");

    // --- Exclusive microphone ownership on one device: a local interview test and private consultant voice.
    const until = async (cond: () => boolean, ms: number, what: string) => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error(`Browser voice check failed: timed out waiting for ${what}`);
        await sleep(200);
      }
    };
    const tomId = (svc.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = 'Tom Becker'").get(id) as any).id;
    const local = await post(`/api/projects/${id}/interviews`, { expertId: tomId, mode: "live_voice_mock_reasoning", localTest: true });
    const started = await post(`/api/projects/${id}/interviews/${local.id}/start`);
    const ivRow = () => svc.db.prepare("SELECT lifecycle, pause_reason FROM interviews WHERE id = ?").get(local.id) as any;
    const expertTurnCount = () => (svc.db.prepare("SELECT COUNT(*) AS n FROM transcript_turns WHERE interview_id = ? AND speaker = 'expert'").get(local.id) as any).n;
    const ctx2 = await browser.newContext();
    await ctx2.grantPermissions(["microphone"], { origin: base });
    const respondent = await ctx2.newPage();
    const consultant = await ctx2.newPage();
    for (const p of [respondent, consultant]) {
      p.on("pageerror", (e) => errors.push(String(e)));
      p.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && errors.push(m.text()));
    }
    await respondent.goto(base + started.joinPath);
    await respondent.getByRole("button", { name: "Join with microphone" }).click();
    await respondent.getByRole("button", { name: "I agree to participate" }).click({ timeout: 15000 });
    await until(() => ivRow().lifecycle === "active" && sim.stats.appends.interview > 0, 30000, "respondent audio reaching the interview session");
    check(true, "local test: the respondent's microphone feeds the interview session");

    await consultant.goto(`${base}/projects/${id}`);
    await consultant.getByRole("button", { name: "Enable voice / Start briefing" }).click();
    await respondent.waitForSelector("text=The microphone is in use by the consultant", { timeout: 15000 });
    await until(() => ivRow().lifecycle === "paused" && ivRow().pause_reason === "consultant_private_voice", 10000, "interview paused for private voice");
    check(true, "private voice claims the microphone: the respondent's capture stops and the interview pauses");
    await sleep(500); // frames already in flight when ownership changed
    const frozenAppends = sim.stats.appends.interview;
    const frozenTurns = expertTurnCount();
    const copilotBefore = sim.stats.appends.copilot;
    const voiceMsgs = () => svc.db.prepare("SELECT role, tool_name AS tool FROM copilot_messages WHERE project_id = ? AND channel = 'voice'").all(id) as any[];
    await until(() => voiceMsgs().some((m) => m.role === "consultant") && voiceMsgs().some((m) => m.tool === "get_handoff"), 30000, "a consultant voice turn and tool call");
    check(sim.stats.appends.copilot > copilotBefore, "the consultant's microphone feeds only the private copilot session");
    check(sim.stats.appends.interview === frozenAppends && expertTurnCount() === frozenTurns, "no consultant audio reached the interview session and no expert turn was created");

    await consultant.getByRole("button", { name: "Stop voice" }).click();
    await until(() => ivRow().lifecycle === "active", 10000, "interview resumed after private voice");
    await respondent.getByRole("button", { name: "Reclaim microphone" }).click();
    await until(() => sim.stats.appends.interview > frozenAppends, 30000, "respondent audio after reclaiming the microphone");
    check(true, "stopping private voice resumes the interview; the respondent reclaims the microphone explicitly");
    await post(`/api/projects/${id}/interviews/${local.id}/stop`, { reason: "test complete" });

    // --- The pitch: open /call, answer, agree out loud, answer a question, and say goodbye.
    sim.queueTranscripts([
      "Yes, sure, happy to help.",
      "My hygiene appointments kept getting cancelled, so I moved my family to another dentist.",
      "Sorry, I have to go now. Bye.",
    ]);
    const ctx3 = await browser.newContext();
    await ctx3.grantPermissions(["microphone"], { origin: base });
    const caller = await ctx3.newPage();
    caller.on("pageerror", (e) => errors.push(String(e)));
    caller.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && errors.push(m.text()));
    await caller.goto(`${base}/call`);
    await caller.getByRole("button", { name: "Answer call" }).click({ timeout: 20000 });
    const callIv = () => svc.db.prepare("SELECT * FROM interviews WHERE local_test = 1 ORDER BY created_at DESC LIMIT 1").get() as any;
    const callDeliveries = () => svc.db.prepare("SELECT kind, state FROM delivery_attempts WHERE interview_id = ? ORDER BY queued_at").all(callIv().id) as any[];
    await until(() => callIv()?.id !== local.id && callIv().lifecycle === "ended" && callDeliveries().every((d) => d.state !== "queued" && d.state !== "speaking"), 120000, "the test call to end");
    const iv3 = callIv();
    check(iv3.consent === "accepted" && iv3.consent_method === "verbal", "test call: the respondent agreed out loud and spoken consent was recorded");
    check(callDeliveries().some((d) => d.kind === "question" && (d.state === "completed" || d.state === "interrupted")), "test call: the AI interviewer asked a research question by voice");
    const closing = callDeliveries().at(-1);
    check(iv3.termination_reason === "participant_ended_call" && closing?.kind === "closing" && closing.state !== "cancelled", "test call: saying goodbye ended the call with a spoken goodbye");
    const diag = (await (await fetch(`${base}/api/calls/${iv3.id}`)).json()) as any;
    check(diag.summary.problems.length === 0 && diag.voice?.ack?.turnDetection === null, `test call: diagnostics report no problems${diag.summary.problems.length ? `: ${diag.summary.problems.join(" | ")}` : ""}`);
    await caller.waitForSelector("text=This interview has ended", { timeout: 15000 });
    check(true, "test call: the call page shows the call has ended");
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    svc.close();
    await sim.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
