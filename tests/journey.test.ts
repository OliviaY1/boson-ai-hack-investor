// End-to-end journey across two backend processes: a crash mid-interview leaves the interview resumable,
// completed questions are not replayed, and "Where were we?" works from saved state in the new process.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const dataDir = mkdtempSync(path.join(tmpdir(), "dl-journey-"));
const children: ChildProcess[] = [];

function launch(): Promise<{ base: string; child: ChildProcess }> {
  const env = { ...process.env, DATA_DIR: dataDir, PORT: "0", HOST: "127.0.0.1", SERVE_STATIC: "false" } as Record<string, string | undefined>;
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_FILE", "BOSON_API_KEY", "BOSON_API_KEY_FILE", "ACCESS_TOKEN"]) delete env[k];
  const child = spawn(process.execPath, ["--import", "tsx", "backend/src/index.ts"], { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20000);
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = out.match(/Diligence Live backend on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ base: m[1], child });
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited ${code}:\n${out}`)));
  });
}

const kill = (c: ChildProcess) => new Promise<void>((r) => (c.exitCode !== null || c.signalCode !== null ? r() : (c.once("exit", () => r()), c.kill("SIGKILL"))));

afterAll(async () => {
  for (const c of children) await kill(c);
  rmSync(dataDir, { recursive: true, force: true });
});

const post = (base: string, p: string, body: unknown = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getSnap = async (base: string, id: string) => ((await (await fetch(`${base}/api/projects/${id}/snapshot`)).json()) as any).snapshot;
const questionsAsked = (s: any, iid: string) =>
  (Object.values(s.deliveries) as any[])
    .filter((d) => d.interviewId === iid && d.kind === "question" && d.state !== "cancelled")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .map((d) => d.authorizedText as string);

describe("restart persistence journey", () => {
  it("survives a crash mid-interview and resumes from saved state", async () => {
    const a = await launch();
    const { id } = (await (await post(a.base, "/api/demo/northstar")).json()) as any;
    let s = await getSnap(a.base, id);
    const dana = (Object.values(s.experts) as any[]).find((e) => e.name === "Dana Whitfield").id;
    const iv = (await (await post(a.base, `/api/projects/${id}/interviews`, { expertId: dana, mode: "synthetic" })).json()) as any;
    const { joinToken } = (await (await post(a.base, `/api/projects/${id}/interviews/${iv.id}/start`)).json()) as any;
    await post(a.base, `/api/participant/${joinToken}/consent`, { accepted: true });
    await fetch(`${a.base}/api/projects/${id}/interviews/${iv.id}/idle`);
    await post(a.base, `/api/projects/${id}/interviews/${iv.id}/respond`);
    await fetch(`${a.base}/api/projects/${id}/interviews/${iv.id}/idle`);
    s = await getSnap(a.base, id);
    const askedBefore = questionsAsked(s, iv.id);
    expect(askedBefore.length).toBe(2);
    const evidenceBefore = Object.keys(s.evidence).length;
    expect(evidenceBefore).toBeGreaterThan(0);
    await kill(a.child); // no graceful shutdown

    const b = await launch();
    s = await getSnap(b.base, id);
    expect(s.interviews[iv.id].lifecycle).toBe("interrupted");
    expect(Object.keys(s.evidence).length).toBe(evidenceBefore);
    const resumed = await post(b.base, `/api/projects/${id}/interviews/${iv.id}/resume-interrupted`);
    expect(resumed.status).toBe(200);
    await fetch(`${b.base}/api/projects/${id}/interviews/${iv.id}/idle`);
    s = await getSnap(b.base, id);
    expect(s.interviews[iv.id].lifecycle).toBe("active");
    const askedAfter = questionsAsked(s, iv.id);
    // The answered staffing question is never asked again.
    expect(askedAfter.filter((t) => t === askedBefore[0]).length).toBe(1);
    await post(b.base, `/api/projects/${id}/interviews/${iv.id}/respond`);
    await fetch(`${b.base}/api/projects/${id}/interviews/${iv.id}/idle`);
    s = await getSnap(b.base, id);
    expect((Object.values(s.turns) as any[]).filter((t) => t.interviewId === iv.id && t.speaker === "expert").length).toBe(2);
    expect(questionsAsked(s, iv.id).length).toBe(3); // the answer after resume moves the interview on
    const where = (await (await post(b.base, `/api/projects/${id}/copilot`, { message: "Where were we?" })).json()) as any;
    expect(where.reply).toMatch(/Citations:/);
    expect(where.navigation).toMatchObject({ kind: "turn" });
    expect(where.provider).toBe("mock");
  }, 60000);
});
