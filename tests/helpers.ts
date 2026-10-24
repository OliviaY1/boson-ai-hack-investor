import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, type AppConfig } from "../backend/src/config";
import { getInterview, startInterview, createInterview } from "../backend/src/domain/interviews";
import { buildSnapshot } from "../backend/src/domain/records";
import { MockReasoningProvider } from "../backend/src/providers/mock";
import type { ReasoningProvider } from "../backend/src/providers/types";
import { Services } from "../backend/src/services";

export interface TestEnv {
  svc: Services;
  dir: string;
  cleanup: () => void;
}

export function makeEnv(overrides: Partial<AppConfig> = {}, opts: { real?: ReasoningProvider | null; mock?: MockReasoningProvider } = {}): TestEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "dl-test-"));
  const config = loadConfig({
    dataDir: dir,
    port: 0,
    anthropicApiKey: undefined,
    bosonApiKey: undefined,
    accessToken: undefined,
    providerTimeoutMs: 5000,
    ...overrides,
  });
  const svc = new Services(config, { real: opts.real ?? null, mock: opts.mock });
  return {
    svc,
    dir,
    cleanup: () => {
      try {
        svc.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const snap = (svc: Services, projectId: string) => buildSnapshot(svc.db, projectId)!;

export function expertByName(svc: Services, projectId: string, name: string): string {
  return (svc.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = ?").get(projectId, name) as any).id;
}

export function questionByKey(svc: Services, projectId: string, key: string): any {
  return svc.db.prepare("SELECT * FROM questions WHERE project_id = ? AND fixture_key = ?").get(projectId, key);
}

/** Creates and starts a synthetic interview, accepts consent, and waits for the first question. */
export async function startSynthetic(svc: Services, projectId: string, expertName: string) {
  const expertId = expertByName(svc, projectId, expertName);
  const id = createInterview(svc.ctx, projectId, expertId, "synthetic", false);
  startInterview(svc.ctx, id, 60);
  svc.engine.onStarted(id);
  svc.engine.consent(id, true);
  await svc.engine.whenIdle(id);
  return id;
}

export async function respond(svc: Services, interviewId: string) {
  const r = svc.engine.respondScripted(interviewId);
  await svc.engine.whenIdle(interviewId);
  return r;
}

export async function answer(svc: Services, interviewId: string, text: string) {
  const id = svc.engine.submitTypedTurn(interviewId, text);
  await svc.engine.whenIdle(interviewId);
  return id;
}

export function deliveries(svc: Services, interviewId: string): any[] {
  return svc.db.prepare("SELECT d.*, q.fixture_key FROM delivery_attempts d LEFT JOIN questions q ON q.id = d.question_id WHERE d.interview_id = ? ORDER BY d.queued_at, d.rowid").all(interviewId) as any[];
}

export function askedKeys(svc: Services, interviewId: string): string[] {
  return deliveries(svc, interviewId)
    .filter((d) => d.kind === "question")
    .map((d) => d.fixture_key ?? d.question_id);
}

export function coverage(svc: Services, interviewId: string, questionId: string): string {
  return (svc.db.prepare("SELECT coverage FROM interview_question_state WHERE interview_id = ? AND question_id = ?").get(interviewId, questionId) as any)?.coverage;
}

export const lifecycle = (svc: Services, id: string) => getInterview(svc.ctx, id).lifecycle as string;

export function decisions(svc: Services, interviewId: string): any[] {
  return svc.db.prepare("SELECT * FROM controller_decisions WHERE interview_id = ? ORDER BY created_at, rowid").all(interviewId) as any[];
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean, ms = 3000, label = "condition") {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${label}`);
    await tick(10);
  }
}
