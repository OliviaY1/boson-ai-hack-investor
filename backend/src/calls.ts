// One-step test calls: the AI interviewer "calls" a respondent that you play in the browser.
// A test call is an ordinary interview in the fictional Northstar project (created on first use), marked
// as a local browser test, so it runs through exactly the same controller, validation, and voice paths.
import { MODE_LABELS, type InterviewMode } from "../../shared/contracts";
import { DomainError } from "./domain/events";
import { createInterview, getInterview, startInterview } from "./domain/interviews";
import { addExpert } from "./domain/projects";
import { buildSnapshot } from "./domain/records";
import { NORTHSTAR_PROJECT } from "./providers/northstarFixture";
import type { Services } from "./services";

export interface CallPersona {
  id: string;
  name: string;
  title: string;
  organization: string;
  background: string;
  isDefault: boolean;
}

export interface CallModeOption {
  available: boolean;
  mode: InterviewMode | null;
  label: string;
  requirement: string | null;
}

export interface CallStartInput {
  personaId?: string;
  persona?: { name: string; title: string; background: string };
  voice: boolean;
}

const seeding = new WeakMap<Services, Promise<string>>();

/** The synthetic Northstar project with an approved plan, created once and reused for every test call. */
export async function ensureCallProject(svc: Services): Promise<string> {
  const row = svc.db
    .prepare(
      `SELECT p.id FROM projects p JOIN research_plans r ON r.id = p.current_plan_id
       WHERE p.is_synthetic = 1 AND p.company = ? AND r.status = 'approved' ORDER BY p.created_at DESC LIMIT 1`,
    )
    .get(NORTHSTAR_PROJECT.company) as { id: string } | undefined;
  if (row) return row.id;
  let p = seeding.get(svc);
  if (!p) {
    p = svc.seedNorthstar().finally(() => seeding.delete(svc));
    seeding.set(svc, p);
  }
  return p;
}

export function callPersonas(svc: Services, projectId: string): CallPersona[] {
  const rows = svc.db
    .prepare("SELECT id, name, title, organization, background FROM experts WHERE project_id = ? AND deleted = 0 ORDER BY created_at")
    .all(projectId) as Omit<CallPersona, "isDefault">[];
  // Default to playing a customer: the classic diligence reference call.
  const def = rows.find((r) => /patient|customer|client/i.test(`${r.title} ${r.organization}`)) ?? rows[0];
  return rows.map((r) => ({ ...r, isDefault: r.id === def?.id }));
}

/** Which kind of call can run with the current backend configuration, and what is missing otherwise. */
export function callModes(svc: Services): { voice: CallModeOption; typed: CallModeOption } {
  const caps = svc.capabilities();
  const boson = caps.bosonConfigured;
  const real = caps.reasoningProvider === "anthropic";
  let voice: CallModeOption;
  if (boson && real) voice = { available: true, mode: "live_voice", label: MODE_LABELS.live_voice, requirement: null };
  else if (boson && caps.allowLiveVoiceMockReasoning) voice = { available: true, mode: "live_voice_mock_reasoning", label: MODE_LABELS.live_voice_mock_reasoning, requirement: null };
  else
    voice = {
      available: false,
      mode: null,
      label: "Live voice call",
      requirement: !boson
        ? "Set BOSON_API_KEY in .env and restart the backend (plus ANTHROPIC_API_KEY for real reasoning)."
        : "Set ANTHROPIC_API_KEY for real reasoning, or ALLOW_LIVE_VOICE_MOCK_REASONING=true to test the voice with scripted reasoning, then restart the backend.",
    };
  return { voice, typed: { available: true, mode: "synthetic", label: "Typed call (no audio, scripted reasoning)", requirement: null } };
}

function modelsInUse(svc: Services, mode: InterviewMode) {
  const caps = svc.capabilities();
  const voiceCall = mode === "live_voice" || mode === "live_voice_mock_reasoning";
  return {
    voice: voiceCall ? { provider: "boson", model: svc.config.bosonModel, transcription: svc.config.transcriptionModel, voice: svc.config.bosonVoice } : null,
    reasoning:
      mode === "live_voice" ? { provider: "anthropic", model: caps.reasoningModel } : { provider: "mock", model: null, note: "Deterministic scripted reasoning, not a language model." },
  };
}

export async function callSetup(svc: Services) {
  const projectId = await ensureCallProject(svc);
  const modes = callModes(svc);
  const active = svc.db.prepare("SELECT id, project_id, local_test, lifecycle FROM interviews WHERE active_slot IS NOT NULL").get() as any;
  return {
    projectId,
    personas: callPersonas(svc, projectId),
    modes,
    models: modelsInUse(svc, modes.voice.mode ?? "synthetic"),
    activeInterview: active ? { id: active.id, lifecycle: active.lifecycle, replaceable: !!active.local_test } : null,
  };
}

/** Start a call to the chosen persona. A previous local test call is ended first; a real interview is never displaced. */
export async function startCall(svc: Services, input: CallStartInput) {
  const projectId = await ensureCallProject(svc);
  const modes = callModes(svc);
  const option = input.voice ? modes.voice : modes.typed;
  if (!option.available || !option.mode) throw new DomainError(409, `Voice calls are unavailable: ${option.requirement}`, "mode_unavailable");
  const mode = option.mode;

  let expertId: string;
  if (input.persona) {
    const existing = svc.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = ? AND source_system = 'test-call' AND deleted = 0").get(projectId, input.persona.name) as any;
    expertId =
      existing?.id ??
      addExpert(svc.ctx, projectId, {
        name: input.persona.name,
        title: input.persona.title,
        background: input.persona.background,
        phone: "",
        email: "",
        organization: "",
        sourceSystem: "test-call",
        sourceRecordId: "",
        retrievedAt: null,
        isSynthetic: true,
      });
    if (existing) svc.db.prepare("UPDATE experts SET title = ?, background = ? WHERE id = ?").run(input.persona.title, input.persona.background, existing.id);
  } else {
    const personas = callPersonas(svc, projectId);
    const chosen = input.personaId ? personas.find((p) => p.id === input.personaId) : personas.find((p) => p.isDefault);
    if (!chosen) throw new DomainError(404, "That persona is not available for test calls.", "not_found");
    expertId = chosen.id;
  }

  const active = svc.db.prepare("SELECT id, local_test FROM interviews WHERE active_slot IS NOT NULL").get() as any;
  if (active) {
    if (!active.local_test) throw new DomainError(409, "A real participant interview is active. End it in the workspace before starting a test call.", "interview_already_active");
    svc.engine.stop(active.id, "replaced_by_new_test_call");
  }
  const interviewId = createInterview(svc.ctx, projectId, expertId, mode, true);
  const { joinToken } = startInterview(svc.ctx, interviewId, svc.config.joinTokenTtlMinutes);
  svc.engine.onStarted(interviewId);
  const persona = svc.db.prepare("SELECT id, name, title, organization, background FROM experts WHERE id = ?").get(expertId) as any;
  svc.engine.trace(interviewId, `test call started: you are ${persona.name}; mode ${mode}`);
  return {
    interviewId,
    projectId,
    joinToken,
    joinPath: `/join/${joinToken}`,
    statusPath: `/api/calls/${interviewId}`,
    mode,
    modeLabel: MODE_LABELS[mode],
    persona,
    models: modelsInUse(svc, mode),
  };
}

const ms = (a: string | null, b: string | null) => (a && b ? Date.parse(b) - Date.parse(a) : null);

/** Everything needed to tell whether a call worked, in one response: transcript, deliveries, decisions, timings, protocol. */
export function callStatus(svc: Services, interviewId: string) {
  const iv = getInterview(svc.ctx, interviewId);
  const s = buildSnapshot(svc.db, iv.project_id)!;
  const interview = s.interviews[interviewId];
  const expert = s.experts[interview.expertId];
  const qCode = (id: string | null) => (id ? (s.questions[id]?.code ?? null) : null);
  const deliveries = Object.values(s.deliveries)
    .filter((d) => d.interviewId === interviewId)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      question: qCode(d.questionId),
      state: d.state,
      authorizedText: d.authorizedText,
      spokenTranscript: d.actualTranscript,
      detail: d.interruptionDetail,
      playedMs: d.playedMs,
      queuedAt: d.queuedAt,
      speakingAfterMs: ms(d.queuedAt, d.startedAt),
      finishedAfterMs: ms(d.queuedAt, d.completedAt),
    }));
  const turns = Object.values(s.turns)
    .filter((t) => t.interviewId === interviewId)
    .sort((a, b) => a.seq - b.seq)
    .map((t) => ({ seq: t.seq, speaker: t.speaker, text: t.text || null, finality: t.finality, afterEnd: t.afterEnd, at: t.startedAt }));
  const decisions = Object.values(s.decisions)
    .filter((d) => d.interviewId === interviewId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((d) => ({ at: d.createdAt, trigger: d.trigger, provider: d.provider, result: d.result, nextAction: d.nextAction, nextQuestion: qCode(d.nextQuestionId), latencyMs: d.latencyMs, rationale: d.rationale, rejectionReasons: d.rejectionReasons }));
  const byName = new Map<string, number[]>();
  for (const m of Object.values(s.metrics).filter((m) => m.interviewId === interviewId)) byName.set(m.name, [...(byName.get(m.name) ?? []), m.ms]);
  const latency = Object.fromEntries(
    [...byName].map(([name, v]) => [name, { count: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), min: Math.min(...v), max: Math.max(...v) }]),
  );
  const coverage = Object.values(s.coverage)
    .filter((c) => c.interviewId === interviewId && s.questions[c.questionId]?.status === "active")
    .map((c) => ({ question: qCode(c.questionId), text: s.questions[c.questionId].text, coverage: c.coverage }))
    .sort((a, b) => String(a.question).localeCompare(String(b.question), undefined, { numeric: true }));
  const evidence = Object.values(s.evidence)
    .filter((e) => e.interviewId === interviewId)
    .map((e) => ({ id: e.id, quote: e.quote, statement: e.statement, basis: e.basis, status: e.status, claims: e.links.map((l) => `${s.claims[l.claimId]?.code} ${l.relation} (${l.comparability})`) }));
  const voice = svc.engine.voiceLogs.get(interviewId) ?? null;

  // Plain-language problems, so a failed call says where it broke.
  const problems: string[] = [];
  for (const d of deliveries) {
    if (d.state === "failed") problems.push(`${d.kind}${d.question ? ` ${d.question}` : ""} failed: ${d.detail ?? "no detail"}`);
    if (d.state === "unknown") problems.push(`${d.kind}${d.question ? ` ${d.question}` : ""}: playback outcome unknown (${d.detail ?? "no detail"})`);
  }
  const missing = turns.filter((t) => t.speaker === "expert" && t.finality === "missing").length;
  if (missing) problems.push(`${missing} participant turn(s) had no transcription from the provider.`);
  const pending = turns.filter((t) => t.speaker === "expert" && t.finality === "pending").length;
  if (pending) problems.push(`${pending} participant turn(s) are still waiting for transcription.`);
  for (const d of decisions.filter((d) => d.result === "error" || d.result === "rejected_invalid"))
    problems.push(`controller ${d.result === "error" ? "call failed" : "output rejected"} (${d.provider}): ${d.rejectionReasons[0] ?? ""}`);
  if (voice) {
    const unrequested = (voice.counters["in:response.created"] ?? 0) - (voice.counters["out:response.create"] ?? 0);
    if (unrequested > 0) problems.push(`the voice provider started ${unrequested} response(s) the app did not request (cancelled).`);
    for (const e of voice.events.filter((e) => e.dir === "in" && e.type === "error")) problems.push(`voice provider error at ${e.at}`);
  }
  if (interview.mode !== "synthetic" && !voice) problems.push("no participant voice session has connected yet (open the join link and press Join).");
  if (interview.lifecycle === "interrupted") problems.push(`interview interrupted: ${interview.pauseReason}`);

  return {
    interview: {
      id: interviewId,
      lifecycle: interview.lifecycle,
      consent: interview.consent,
      consentMethod: interview.consentMethod,
      mode: interview.mode,
      modeLabel: MODE_LABELS[interview.mode],
      startedAt: interview.startedAt,
      endedAt: interview.endedAt,
      durationSec: interview.startedAt ? Math.round(((interview.endedAt ? Date.parse(interview.endedAt) : Date.now()) - Date.parse(interview.startedAt)) / 1000) : null,
      terminationReason: interview.terminationReason,
    },
    persona: { name: expert?.name, title: expert?.title, background: expert?.background },
    models: modelsInUse(svc, interview.mode),
    summary: {
      questionsSpoken: deliveries.filter((d) => d.kind === "question" && d.state === "completed").length,
      participantTurns: turns.filter((t) => t.speaker === "expert").length,
      observations: evidence.length,
      problems,
    },
    turns,
    deliveries,
    decisions,
    coverage,
    evidence,
    latencyMs: latency,
    voice,
  };
}
