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
