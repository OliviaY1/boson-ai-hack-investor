// HTTP and WebSocket boundary tests against a real listening server (deterministic mock providers).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AppConfig } from "../backend/src/config";
import { startServer } from "../backend/src/index";

type Running = Awaited<ReturnType<typeof startServer>> & { base: string; dir: string };
const running: Running[] = [];

async function boot(overrides: Partial<AppConfig> = {}): Promise<Running> {
  const dir = mkdtempSync(path.join(tmpdir(), "dl-http-"));
  const r = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: dir,
    anthropicApiKey: undefined,
    bosonApiKey: undefined,
    accessToken: undefined,
    serveStatic: false,
    providerTimeoutMs: 5000,
    callTrace: "off",
    ...overrides,
  });
  const out = { ...r, base: `http://127.0.0.1:${r.port}`, dir };
  running.push(out);
  return out;
}

afterEach(async () => {
  for (const r of running.splice(0)) {
    r.server.closeAllConnections?.();
    await new Promise((res) => r.server.close(res));
    r.svc.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function seeded(r: Running, headers: Record<string, string> = {}) {
  const res = await fetch(`${r.base}/api/demo/northstar`, { method: "POST", headers });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as any;
  const snap = ((await (await fetch(`${r.base}/api/projects/${id}/snapshot`, { headers })).json()) as any).snapshot;
  const expert = (name: string) => (Object.values(snap.experts) as any[]).find((e) => e.name === name).id;
  return { id, snap, expert };
}

function upload(file: Buffer, name: string) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(file)]), name);
  return fd;
}

describe("consultant access control", () => {
  it("requires the access token for consultant APIs and accepts it as a header or login cookie", async () => {
    const r = await boot({ accessToken: "test-access-token-123" });
    expect((await fetch(`${r.base}/api/config`)).status).toBe(200);
    expect((await fetch(`${r.base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${r.base}/api/login`, json({ token: "wrong" }))).status).toBe(401);
    const login = await fetch(`${r.base}/api/login`, json({ token: "test-access-token-123" }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect((await fetch(`${r.base}/api/projects`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${r.base}/api/projects`, { headers: { "x-access-token": "test-access-token-123" } })).status).toBe(200);
  });

  it("scopes participant links to one interview and never exposes consultant data", async () => {
    const r = await boot({ accessToken: "tok-abc" });
    const h = { "x-access-token": "tok-abc" };
    const { id, expert } = await seeded(r, h);
    const iv = (await (await fetch(`${r.base}/api/projects/${id}/interviews`, json({ expertId: expert("Dana Whitfield"), mode: "synthetic" }, h))).json()) as any;
    const started = (await (await fetch(`${r.base}/api/projects/${id}/interviews/${iv.id}/start`, json({}, h))).json()) as any;
    expect(started.joinToken).toMatch(/.{20,}/);
    const info = await fetch(`${r.base}/api/participant/${started.joinToken}`);
    expect(info.status).toBe(200);
    const body = await info.text();
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(
      ["audioRecording", "consent", "interviewId", "intro", "lifecycle", "localTest", "mode", "participantName", "transcript", "transport", "voiceAvailable"].sort(),
    );
    for (const secret of ["Northstar Dental Partners", "C1", "claims", "thesis", "Priya"]) expect(body).not.toContain(secret);
    // The participant token is not a consultant credential.
    expect((await fetch(`${r.base}/api/projects/${id}/snapshot`, { headers: { "x-access-token": started.joinToken } })).status).toBe(401);
    expect((await fetch(`${r.base}/api/participant/not-a-real-token`)).status).toBe(404);
    // Typed answers flow through the participant endpoint after consent.
    expect((await fetch(`${r.base}/api/participant/${started.joinToken}/consent`, json({ accepted: true }))).status).toBe(200);
    expect((await fetch(`${r.base}/api/participant/${started.joinToken}/answer`, json({ text: "We were short four hygienists." }))).status).toBe(200);
    await fetch(`${r.base}/api/projects/${id}/interviews/${iv.id}/idle`, { headers: h });
    const after = JSON.parse(await (await fetch(`${r.base}/api/participant/${started.joinToken}`)).text());
    expect(after.transcript.map((t: any) => t.speaker)).toContain("expert");
  });

  it("rejects cross-origin WebSocket upgrades and unauthenticated copilot sockets", async () => {
    const r = await boot({ accessToken: "tok-ws", bosonApiKey: "fake-key-for-ws-gate-only", bosonRealtimeUrl: "ws://127.0.0.1:9/never" });
    const status = (url: string, headers: Record<string, string> = {}) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, { headers });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => {
          ws.close();
          resolve(101);
        });
        ws.on("error", () => resolve(-1));
      });
    const wsBase = r.base.replace("http", "ws");
    expect(await status(`${wsBase}/ws/copilot?project=x`, { origin: "https://evil.example" })).toBe(403);
    expect(await status(`${wsBase}/ws/copilot?project=x`)).toBe(401);
    expect(await status(`${wsBase}/ws/participant?token=nope`)).toBe(404);
  });
});

describe("uploads, exports, and concurrency over HTTP", () => {
  it("rejects oversized uploads with 413 and malformed DOCX/CSV with readable 400s", async () => {
    const r = await boot({ maxUploadBytes: 4096 });
    const created = await fetch(`${r.base}/api/projects`, json({ company: "Acme Logistics", objective: "Test growth claims." }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as any;
    const big = await fetch(`${r.base}/api/projects/${id}/thesis/docx`, { method: "POST", body: upload(Buffer.alloc(10_000, 65), "big.docx") });
    expect(big.status).toBe(413);
    expect(((await big.json()) as any).code).toBe("upload_too_large");
    const bad = await fetch(`${r.base}/api/projects/${id}/thesis/docx`, { method: "POST", body: upload(Buffer.from("not a zip at all"), "bad.docx") });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/DOCX|Word|read/i);
    const wrongType = await fetch(`${r.base}/api/projects/${id}/thesis/docx`, { method: "POST", body: upload(Buffer.from("x"), "thesis.pdf") });
    expect(wrongType.status).toBe(400);
    const csv = await fetch(`${r.base}/api/projects/${id}/experts/import`, { method: "POST", body: upload(Buffer.from("full_name,email\nA,a@b.c\n"), "pool.csv") });
    expect(csv.status).toBe(400);
    const partial = await fetch(`${r.base}/api/projects/${id}/experts/import`, { method: "POST", body: upload(Buffer.from("name,background\nNew Person,Former clinic manager\n,no name\n"), "pool.csv") });
    expect(partial.status).toBe(201);
    expect(await partial.json()).toMatchObject({ imported: 1, errors: [{ row: 3 }] });
    const invalid = await fetch(`${r.base}/api/projects/${id}/directives`, json({ instruction: "" }));
    expect(invalid.status).toBe(400);
  });

  it("runs the credential-free planning gate from uploaded sample files", async () => {
    const r = await boot();
    const created = await fetch(`${r.base}/api/projects`, json({ company: "Northstar Dental Group (fictional)", objective: "Test the churn, capacity, and staffing claims." }));
    const { id } = (await created.json()) as any;
    const fx = path.resolve(__dirname, "../fixtures/northstar");
    const doc = await fetch(`${r.base}/api/projects/${id}/thesis/docx`, { method: "POST", body: upload(readFileSync(path.join(fx, "northstar_thesis.docx")), "northstar_thesis.docx") });
    expect(doc.status).toBe(201);
    const csv = await fetch(`${r.base}/api/projects/${id}/experts/import`, { method: "POST", body: upload(readFileSync(path.join(fx, "contacts.csv")), "contacts.csv") });
    expect(await csv.json()).toMatchObject({ imported: 6, errors: [] });
    const gen = await fetch(`${r.base}/api/projects/${id}/plan/generate`, json({}));
    expect(gen.status).toBe(201);
    let s = ((await (await fetch(`${r.base}/api/projects/${id}/snapshot`)).json()) as any).snapshot;
    const claims = Object.values(s.claims) as any[];
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(c.passageIds.length).toBeGreaterThan(0);
    expect((Object.values(s.rankings) as any[]).filter((x) => x.recommended).length).toBe(3);
    const q = Object.values(s.questions)[0] as any;
    expect((await fetch(`${r.base}/api/projects/${id}/questions/${q.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Edited by the consultant: how were vacancies tracked?" }) })).status).toBe(200);
    expect((await fetch(`${r.base}/api/projects/${id}/plan/approve`, json({ rationale: "ready" }))).status).toBe(200);
    s = ((await (await fetch(`${r.base}/api/projects/${id}/snapshot`)).json()) as any).snapshot;
    expect(s.plans[s.project.currentPlanId].status).toBe("approved");
    const zip = await JSZip.loadAsync(Buffer.from(await (await fetch(`${r.base}/api/projects/${id}/plan.docx`)).arrayBuffer()));
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Edited by the consultant: how were vacancies tracked?");
  });

  it("serves the plan DOCX and the HTML report", async () => {
    const r = await boot();
    const { id } = await seeded(r);
    const docx = await fetch(`${r.base}/api/projects/${id}/plan.docx`);
    expect(docx.headers.get("content-type")).toMatch(/wordprocessingml/);
    const zip = await JSZip.loadAsync(Buffer.from(await docx.arrayBuffer()));
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Northstar");
    const report = await fetch(`${r.base}/api/projects/${id}/report.html`);
    expect(report.headers.get("content-type")).toMatch(/text\/html/);
    expect(await report.text()).toMatch(/SYNTHETIC/);
  });

  it("starts only one interview when two start requests race", async () => {
    const r = await boot();
    const { id, expert } = await seeded(r);
    const mk = async (name: string) => ((await (await fetch(`${r.base}/api/projects/${id}/interviews`, json({ expertId: expert(name), mode: "synthetic" }))).json()) as any).id;
    const [a, b] = [await mk("Dana Whitfield"), await mk("Tom Becker")];
    const statuses = await Promise.all([a, b].map(async (iid) => (await fetch(`${r.base}/api/projects/${id}/interviews/${iid}/start`, json({}))).status));
    expect(statuses.sort()).toEqual([200, 409]);
    const live = await fetch(`${r.base}/api/projects/${id}/interviews`, json({ expertId: expert("Dana Whitfield"), mode: "live_voice" }));
    expect(live.status).toBe(409);
    expect(await live.json()).toMatchObject({ code: "mode_unavailable", error: expect.stringMatching(/BOSON_API_KEY/) });
  });

  it("streams ordered state events after a cursor over SSE", async () => {
    const r = await boot();
    const { id, snap } = await seeded(r);
    const cursor = snap.project.stateRevision;
    const ctrl = new AbortController();
    const res = await fetch(`${r.base}/api/projects/${id}/events?after=${cursor}`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    await fetch(`${r.base}/api/projects/${id}/memory`, json({ text: "Treat the CIM's churn figure as company-reported." }));
    await fetch(`${r.base}/api/projects/${id}/reviewed`, json({}));
    let buf = "";
    const dec = new TextDecoder();
    while ((buf.match(/^id: /gm) ?? []).length < 2) buf += dec.decode((await reader.read()).value);
    ctrl.abort();
    const ids = [...buf.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(cursor + 1);
    expect(ids[1]).toBe(cursor + 2);
    expect(buf).toContain("memory.added");
  });

  it("corrects a project instruction by retiring the old item, and rejects empty or stale corrections", async () => {
    const r = await boot();
    const { id } = await seeded(r);
    const patch = (mid: string, text: string) => fetch(`${r.base}/api/projects/${id}/memory/${mid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const { id: mid } = (await (await fetch(`${r.base}/api/projects/${id}/memory`, json({ text: "Exclude clinics acquired after 2024." }))).json()) as any;
    expect((await patch(mid, "   ")).status).toBe(400);
    expect((await patch(mid, "Exclude clinics acquired after June 2024.")).status).toBe(200);
    const items = Object.values(((await (await fetch(`${r.base}/api/projects/${id}/snapshot`)).json()) as any).snapshot.memory) as any[];
    expect(items.find((m) => m.id === mid).status).toBe("retired");
    expect(items.filter((m) => m.status === "active").map((m) => m.text)).toContain("Exclude clinics acquired after June 2024.");
    expect((await patch(mid, "A correction of a retired item.")).status).toBe(409);
  });
});

describe("test calls (POST /api/calls)", () => {
  const getJson = async (r: Running, path: string) => (await (await fetch(r.base + path)).json()) as any;
  const postJson = async (r: Running, path: string, body: unknown = {}) => {
    const res = await fetch(r.base + path, json(body));
    return { status: res.status, body: (await res.json()) as any };
  };

  it("prepares a call in one step, explains missing voice keys, and runs a typed call from consent to goodbye", async () => {
    const r = await boot();
    const setup = await getJson(r, "/api/calls/setup");
    const def = setup.personas.find((p: any) => p.isDefault);
    expect(def.name).toBe("Priya Raman"); // a customer by default
    expect(setup.modes.voice).toMatchObject({ available: false, requirement: expect.stringMatching(/BOSON_API_KEY/) });
    expect((await getJson(r, "/api/calls/setup")).projectId).toBe(setup.projectId); // the demo project is reused, not reseeded

    const voice = await postJson(r, "/api/calls", { voice: true });
    expect(voice.status).toBe(409);
    expect(voice.body.error).toMatch(/BOSON_API_KEY/);

    const call = await postJson(r, "/api/calls", { voice: false });
    expect(call.status).toBe(201);
    expect(call.body).toMatchObject({ mode: "synthetic", persona: { name: "Priya Raman" }, joinPath: expect.stringMatching(/^\/join\//) });
    const token = call.body.joinToken;
    const status = () => getJson(r, call.body.statusPath);
    expect((await status()).turns[0]).toMatchObject({ speaker: "interviewer", text: expect.stringMatching(/^Hi Priya, this is an AI interviewer/) });

    // Typed replies follow the same path as spoken ones.
    await fetch(`${r.base}/api/participant/${token}/answer`, json({ text: "Yes, go ahead." }));
    await fetch(`${r.base}/api/projects/${call.body.projectId}/interviews/${call.body.interviewId}/idle`);
    let st = await status();
    expect(st.interview).toMatchObject({ consent: "accepted", consentMethod: "verbal", lifecycle: "active" });
    expect(st.summary.questionsSpoken).toBe(1);
    await fetch(`${r.base}/api/participant/${token}/answer`, json({ text: "The clinic cancelled my hygiene appointments three times, so I moved my family elsewhere." }));
    await fetch(`${r.base}/api/projects/${call.body.projectId}/interviews/${call.body.interviewId}/idle`);
    await fetch(`${r.base}/api/participant/${token}/answer`, json({ text: "Sorry, I have to go now. Bye." }));
    st = await status();
    expect(st.interview).toMatchObject({ lifecycle: "ended", terminationReason: "participant_ended_call" });
    expect(st.deliveries.at(-1)).toMatchObject({ kind: "closing", state: "completed" });
    expect(st.summary.observations).toBeGreaterThan(0);
    expect(st.summary.problems).toEqual([]);
    expect(st.decisions.length).toBeGreaterThan(0);
    expect(st.models.reasoning.provider).toBe("mock");
  });

  it("replaces a previous test call but never displaces a real participant interview", async () => {
    const r = await boot();
    const first = await postJson(r, "/api/calls", { voice: false });
    const second = await postJson(r, "/api/calls", { voice: false });
    expect(second.status).toBe(201);
    expect((await getJson(r, first.body.statusPath)).interview).toMatchObject({ lifecycle: "ended", terminationReason: "replaced_by_new_test_call" });
    await fetch(`${r.base}/api/projects/${second.body.projectId}/interviews/${second.body.interviewId}/stop`, json({}));

    const projectId = second.body.projectId;
    const snap = (await getJson(r, `/api/projects/${projectId}/snapshot`)).snapshot;
    const dana = (Object.values(snap.experts) as any[]).find((e) => e.name === "Dana Whitfield").id;
    const real = (await postJson(r, `/api/projects/${projectId}/interviews`, { expertId: dana, mode: "synthetic", localTest: false })).body.id;
    await postJson(r, `/api/projects/${projectId}/interviews/${real}/start`);
    const blocked = await postJson(r, "/api/calls", { voice: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("interview_already_active");
  });

  it("lets you play someone else and reuses that persona on the next call", async () => {
    const r = await boot();
    const persona = { name: "Sam Patel", title: "Patient at the Ottawa clinic", background: "Patient at the Northstar Ottawa clinic since 2020; two children." };
    const a = await postJson(r, "/api/calls", { voice: false, persona });
    expect(a.body.persona).toMatchObject({ name: "Sam Patel", title: "Patient at the Ottawa clinic" });
    const b = await postJson(r, "/api/calls", { voice: false, persona });
    expect(b.body.persona.id).toBe(a.body.persona.id);
    expect((await postJson(r, "/api/calls", { voice: false, persona: { name: "", background: "x" } })).status).toBe(400);
  });
});
