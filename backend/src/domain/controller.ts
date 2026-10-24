// Controller envelope construction, semantic validation, and transactional application.
import { ControllerProposalSchema, type ControllerProposal, type Coverage } from "../../../shared/contracts";
import { j, now, pj, uid } from "../db/db";
import type { ControllerEnvelope, EnvelopeTurn } from "../providers/types";
import { addClaimGap, recomputeClaims } from "./evidence";
import { commit, type ChangeSet, type Ctx } from "./events";
import { createDelivery, ensureCoverageRows, getInterview } from "./interviews";
import { insertQuestion } from "./planning";

export const LIMITS = { maxNewQuestionsPerDecision: 3, maxFollowUpsPerInterview: 8, maxRecentTurns: 12 };

export interface ValidationContext {
  interviewId: string;
  mode: "interview" | "extract_only";
  lifecycle: string;
  claimIds: Set<string>;
  questions: Map<string, { coverage: Coverage; revision: number; active: boolean; askedSinceLastExpertTurn: boolean }>;
  eligibleTurns: Map<string, { text: string; version: number }>; // expert, interview channel, final
  interviewTurnIds: Set<string>;
  activeInterviewEvidence: Set<string>;
  activeProjectEvidence: Set<string>;
  pendingDirectives: Set<string>;
  remainingFollowUps: number;
  awaitingAnswer: boolean; // a question was delivered and no expert turn has arrived since
}

const FIXTURE_PREFIX = "fixture:";

function toEnvelopeTurn(r: any, contextQuestionId: string | null): EnvelopeTurn {
  return {
    id: r.id,
    seq: r.seq,
    speaker: r.speaker,
    version: r.current_version,
    text: r.text ?? "",
    contextQuestionId,
    fixtureRef: r.source_event_id?.startsWith(FIXTURE_PREFIX) ? r.source_event_id.slice(FIXTURE_PREFIX.length) : null,
  };
}

export function buildEnvelope(
  ctx: Ctx,
  interviewId: string,
  trigger: string,
  mode: "interview" | "extract_only",
  onlyTurnIds?: string[],
): { envelope: ControllerEnvelope; vctx: ValidationContext } {
  const db = ctx.db;
  const iv = getInterview(ctx, interviewId);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(iv.project_id) as any;
  const expert = db.prepare("SELECT * FROM experts WHERE id = ?").get(iv.expert_id) as any;
  const claims = db.prepare("SELECT * FROM claims WHERE project_id = ? AND status = 'active' ORDER BY code").all(iv.project_id) as any[];
  const turns = db
    .prepare(
      `SELECT t.*, v.text FROM transcript_turns t LEFT JOIN transcript_versions v ON v.turn_id = t.id AND v.version = t.current_version
       WHERE t.interview_id = ? ORDER BY t.seq`,
    )
    .all(interviewId) as any[];
  const deliveries = db.prepare("SELECT * FROM delivery_attempts WHERE interview_id = ? ORDER BY queued_at").all(interviewId) as any[];
  const deliveryQuestion = new Map(deliveries.map((d) => [d.id, d.question_id as string | null]));
  const expertTurns = turns.filter((t) => t.speaker === "expert" && t.finality === "final" && t.channel === "interview");
  const newTurns = (onlyTurnIds ? expertTurns.filter((t) => onlyTurnIds.includes(t.id)) : expertTurns.filter((t) => t.seq > iv.controller_cursor)).map((t) =>
    toEnvelopeTurn(t, t.context_delivery_id ? deliveryQuestion.get(t.context_delivery_id) ?? null : null),
  );
  const lastExpertAt = expertTurns.length ? expertTurns[expertTurns.length - 1].started_at : "";
  const coverageRows = new Map(
    (db.prepare("SELECT * FROM interview_question_state WHERE interview_id = ?").all(interviewId) as any[]).map((r) => [r.question_id, r]),
  );
  const questions = (db.prepare("SELECT q.*, r.text, r.purpose FROM questions q JOIN question_revisions r ON r.question_id = q.id AND r.revision = q.current_revision WHERE q.project_id = ? AND q.status = 'active' ORDER BY q.code").all(iv.project_id) as any[]).map(
    (q) => {
      const ds = deliveries.filter((d) => d.question_id === q.id);
      const last = ds[ds.length - 1];
      const askedSince = ds.some((d) => ["queued", "speaking", "completed"].includes(d.state) && (d.started_at ?? d.queued_at) > lastExpertAt);
      return {
        id: q.id,
        code: q.code,
        revision: q.current_revision,
        text: q.text,
        purpose: q.purpose,
        priority: q.priority,
        claimIds: pj<string[]>(q.claim_ids, []),
        coverage: (coverageRows.get(q.id)?.coverage ?? "pending") as Coverage,
        origin: q.origin,
        fixtureKey: q.fixture_key,
        completedDeliveries: ds.filter((d) => d.state === "completed").length,
        lastDeliveryState: last?.state ?? null,
        askedSinceLastExpertTurn: askedSince,
      };
    },
  );
  const awaiting = [...deliveries].reverse().find((d) => d.kind === "question" && ["queued", "speaking", "completed"].includes(d.state));
  const awaitingAnswerQuestionId = awaiting && (awaiting.started_at ?? awaiting.queued_at) > lastExpertAt ? awaiting.question_id : null;
  const evidence = db
    .prepare(
      `SELECT e.id, e.interview_id, e.turn_id, e.statement, e.status, t.source_event_id FROM evidence e JOIN transcript_turns t ON t.id = e.turn_id
       WHERE e.project_id = ? AND e.status = 'active' ORDER BY e.created_at DESC LIMIT 60`,
    )
    .all(iv.project_id) as any[];
  const links = db.prepare("SELECT evidence_id, claim_id FROM evidence_claim_links").all() as any[];
  const linkMap = new Map<string, string[]>();
  for (const l of links) linkMap.set(l.evidence_id, [...(linkMap.get(l.evidence_id) ?? []), l.claim_id]);
  const directives = db
    .prepare("SELECT * FROM consultant_directives WHERE project_id = ? AND status = 'pending' AND (interview_id IS NULL OR interview_id = ?) ORDER BY created_at")
    .all(iv.project_id, interviewId) as any[];
  const ranking = db
    .prepare(
      "SELECT r.claim_ids FROM expert_rankings r WHERE r.plan_id = ? AND r.expert_id = ?",
    )
    .get(iv.plan_id, iv.expert_id) as any;
  const followUpsSoFar = (db.prepare("SELECT COUNT(*) AS n FROM questions WHERE created_in_interview_id = ? AND origin = 'controller'").get(interviewId) as any).n;
  const memory = (db.prepare("SELECT text FROM project_memory WHERE project_id = ? AND status = 'active' AND kind = 'instruction'").all(iv.project_id) as any[]).map((r) => r.text);
  const recent = turns.filter((t) => t.text != null).slice(-LIMITS.maxRecentTurns).map((t) => toEnvelopeTurn(t, t.context_delivery_id ? deliveryQuestion.get(t.context_delivery_id) ?? null : null));
  const transcriptCursor = turns.length ? turns[turns.length - 1].seq : 0;

  const envelope: ControllerEnvelope = {
    requestId: uid("req"),
    interviewId,
    expectedRevision: iv.control_revision,
    planVersion: iv.plan_version,
    transcriptCursor,
    generation: iv.generation,
    turnVersions: Object.fromEntries(newTurns.map((t) => [t.id, t.version])),
    mode,
    trigger,
    context: {
      project: { company: project.company, objective: project.objective, instructions: memory },
      // Only the background needed for this interview; no other experts' contact details.
      expert: { id: expert.id, name: expert.name, title: expert.title, background: expert.background },
      claims: claims.map((c) => ({
        id: c.id,
        code: c.code,
        assertion: c.assertion,
        metricDefinition: c.metric_definition,
        scopeDefinition: c.scope_definition,
        assessment: c.assessment,
        gaps: pj<{ description: string }[]>(c.gaps, []).map((g) => g.description),
      })),
      questions,
      newTurns,
      recentTurns: recent,
      awaitingAnswerQuestionId,
      existingEvidence: evidence.map((e) => ({
        id: e.id,
        sameInterview: e.interview_id === interviewId,
        turnId: e.turn_id,
        fixtureRef: e.source_event_id?.startsWith(FIXTURE_PREFIX) ? e.source_event_id.slice(FIXTURE_PREFIX.length) : null,
        statement: e.statement,
        claimIds: linkMap.get(e.id) ?? [],
        status: e.status,
      })),
      directives: directives.map((d) => ({ id: d.id, instruction: d.instruction, claimIds: pj<string[]>(d.claim_ids, []) })),
      relevantClaimIds: ranking ? pj<string[]>(ranking.claim_ids, []).filter(Boolean) : [],
      lifecycle: iv.lifecycle,
      limits: { maxNewQuestionsPerDecision: LIMITS.maxNewQuestionsPerDecision, remainingFollowUps: Math.max(0, LIMITS.maxFollowUpsPerInterview - followUpsSoFar) },
    },
  };
  const vctx: ValidationContext = {
    interviewId,
    mode,
    lifecycle: iv.lifecycle,
    claimIds: new Set(claims.map((c) => c.id)),
    questions: new Map(questions.map((q) => [q.id, { coverage: q.coverage, revision: q.revision, active: true, askedSinceLastExpertTurn: q.askedSinceLastExpertTurn }])),
    eligibleTurns: new Map(newTurns.filter((t) => t.speaker === "expert").map((t) => [t.id, { text: t.text, version: t.version }])),
    interviewTurnIds: new Set(turns.filter((t) => t.speaker === "expert").map((t) => t.id)),
    activeInterviewEvidence: new Set(evidence.filter((e) => e.interview_id === interviewId).map((e) => e.id)),
    activeProjectEvidence: new Set(evidence.map((e) => e.id)),
    pendingDirectives: new Set(directives.map((d) => d.id)),
    remainingFollowUps: envelope.context.limits.remainingFollowUps,
    awaitingAnswer: awaitingAnswerQuestionId !== null && newTurns.length === 0,
  };
  // Evidence beyond the 60 most recent can still be referenced for supersession within this interview.
  for (const r of db.prepare("SELECT id FROM evidence WHERE interview_id = ? AND status = 'active'").all(interviewId) as any[]) {
    vctx.activeInterviewEvidence.add(r.id);
    vctx.activeProjectEvidence.add(r.id);
  }
  return { envelope, vctx };
}

const COVERAGE_TRANSITIONS: Record<Coverage, Coverage[]> = {
  pending: ["pending", "partially_answered", "answered", "unable_to_answer", "skipped"],
  partially_answered: ["partially_answered", "answered", "unable_to_answer", "skipped"],
  unable_to_answer: ["unable_to_answer", "partially_answered", "answered"],
  answered: ["answered"],
  skipped: ["skipped"],
};

/** Semantic validation beyond JSON shape. Returns a list of reasons; empty means valid. */
export function validateProposal(p: ControllerProposal, v: ValidationContext): string[] {
  const errors: string[] = [];
  const obsRefs = new Set<string>();
  for (const o of p.observations) {
    if (obsRefs.has(o.ref)) errors.push(`Duplicate observation ref ${o.ref}.`);
    obsRefs.add(o.ref);
    const turn = v.eligibleTurns.get(o.turn_id);
    if (!turn) errors.push(`Observation ${o.ref} cites turn ${o.turn_id}, which is not an eligible new expert utterance in this interview.`);
    else if (!turn.text.includes(o.quote)) errors.push(`Observation ${o.ref} quote is not an exact span of turn ${o.turn_id} v${turn.version}.`);
    for (const l of o.claim_links) if (!v.claimIds.has(l.claim_id)) errors.push(`Observation ${o.ref} links unknown claim ${l.claim_id}.`);
    for (const id of [...o.supersedes_evidence_ids, ...o.retracts_evidence_ids])
      if (!v.activeInterviewEvidence.has(id)) errors.push(`Observation ${o.ref} supersedes/retracts ${id}, which is not active evidence from this interview.`);
  }
  const coverageAfter = new Map([...v.questions].map(([id, q]) => [id, q.coverage]));
  for (const c of p.coverage_updates) {
    const q = v.questions.get(c.question_id);
    if (!q) {
      errors.push(`Coverage update references unknown question ${c.question_id}.`);
      continue;
    }
    if (!COVERAGE_TRANSITIONS[q.coverage].includes(c.coverage)) errors.push(`Coverage transition ${q.coverage} -> ${c.coverage} is not allowed for ${c.question_id}.`);
    for (const t of c.answer_turn_ids) if (!v.interviewTurnIds.has(t)) errors.push(`Coverage update cites turn ${t}, which is not an expert turn in this interview.`);
    coverageAfter.set(c.question_id, c.coverage);
  }
  const newRefs = new Set<string>();
  if (p.new_questions.length > v.remainingFollowUps) errors.push(`Proposal adds ${p.new_questions.length} questions but only ${v.remainingFollowUps} follow-ups remain.`);
  for (const q of p.new_questions) {
    if (newRefs.has(q.ref) || v.questions.has(q.ref)) errors.push(`New question ref ${q.ref} is not unique.`);
    newRefs.add(q.ref);
    for (const c of q.claim_ids) if (!v.claimIds.has(c)) errors.push(`New question ${q.ref} links unknown claim ${c}.`);
  }
  for (const pc of p.priority_changes) if (!v.questions.has(pc.question_id)) errors.push(`Priority change references unknown question ${pc.question_id}.`);
  for (const g of p.evidence_gaps) if (!v.claimIds.has(g.claim_id)) errors.push(`Evidence gap references unknown claim ${g.claim_id}.`);
  for (const f of p.findings) {
    for (const r of f.evidence_refs) if (!obsRefs.has(r) && !v.activeProjectEvidence.has(r)) errors.push(`Finding cites unknown evidence ${r}.`);
    for (const c of f.claim_ids) if (!v.claimIds.has(c)) errors.push(`Finding links unknown claim ${c}.`);
  }
  for (const d of p.consumed_directive_ids) if (!v.pendingDirectives.has(d)) errors.push(`Directive ${d} is not pending.`);
  const a = p.next_action;
  if (v.mode === "extract_only" && a.type !== "wait") errors.push("Extraction-only requests must choose 'wait'.");
  if (a.type === "ask" && v.awaitingAnswer) errors.push("A question is awaiting the expert's answer; only 'wait' or 'end' is allowed.");
  if (a.type === "ask") {
    if (!a.question_ref) errors.push("An ask action requires a question reference.");
    else if (newRefs.has(a.question_ref)) {
      if (a.question_revision !== null) errors.push("A new question must be asked with question_revision null.");
    } else {
      const q = v.questions.get(a.question_ref);
      if (!q) errors.push(`Ask references unknown question ${a.question_ref}.`);
      else {
        if (a.question_revision !== q.revision) errors.push(`Ask references revision ${a.question_revision} of ${a.question_ref}, but the current revision is ${q.revision}.`);
        const cov = coverageAfter.get(a.question_ref)!;
        if (cov === "answered" || cov === "skipped" || cov === "unable_to_answer") errors.push(`Question ${a.question_ref} is already ${cov} in this interview.`);
        if (q.askedSinceLastExpertTurn) errors.push(`Question ${a.question_ref} was already delivered and is awaiting an answer.`);
      }
    }
  }
  return errors;
}

export type ApplyOutcome =
  | { kind: "stale"; decisionId: string; reasons: string[] }
  | { kind: "invalid"; decisionId: string; reasons: string[] }
  | { kind: "applied"; decisionId: string; deliveryId: string | null; held: boolean; nextAction: string; ended: boolean };

/** Record a rejected or failed decision without applying any proposed change. */
export function recordFailedDecision(
  ctx: Ctx,
  env: ControllerEnvelope,
  provider: string,
  result: "rejected_invalid" | "error" | "cancelled",
  reasons: string[],
  latencyMs: number,
  proposal: unknown,
): string {
  const iv = getInterview(ctx, env.interviewId);
  return commit(ctx, iv.project_id, `controller.${result}`, (cs) => insertDecision(ctx, cs, env, provider, result, reasons, "", null, null, latencyMs, proposal)).result;
}

function insertDecision(
  ctx: Ctx,
  cs: ChangeSet,
  env: ControllerEnvelope,
  provider: string,
  result: string,
  reasons: string[],
  rationale: string,
  nextAction: string | null,
  nextQuestionId: string | null,
  latencyMs: number,
  proposal: unknown,
): string {
  const id = uid("dec");
  ctx.db
    .prepare(
      `INSERT INTO controller_decisions (id, interview_id, request_id, trigger, expected_revision, generation, plan_version, transcript_cursor, provider, proposal, result, rejection_reasons, rationale, next_action, next_question_id, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      env.interviewId,
      env.requestId,
      env.trigger,
      env.expectedRevision,
      env.generation,
      env.planVersion,
      env.transcriptCursor,
      provider,
      j(proposal),
      result,
      j(reasons),
      rationale,
      nextAction,
      nextQuestionId,
      Math.round(latencyMs),
      now(),
    );
  cs.touch("decisions", id);
  return id;
}

/**
 * Apply a validated proposal in one transaction, but only if it is still current: same control
 * revision, same generation, same transcript versions, and the interview has not ended.
 */
export function applyProposal(ctx: Ctx, env: ControllerEnvelope, p: ControllerProposal, provider: string, latencyMs: number): ApplyOutcome {
  const db = ctx.db;
  const ivAtStart = getInterview(ctx, env.interviewId);
  return commit(ctx, ivAtStart.project_id, "controller.decision", (cs): ApplyOutcome => {
    const iv = getInterview(ctx, env.interviewId);
    const stale: string[] = [];
    if (iv.control_revision !== env.expectedRevision) stale.push(`control revision moved ${env.expectedRevision} -> ${iv.control_revision} (human edit or new input)`);
    if (iv.generation !== env.generation) stale.push(`response generation moved ${env.generation} -> ${iv.generation}`);
    for (const [tid, ver] of Object.entries(env.turnVersions)) {
      const t = db.prepare("SELECT current_version FROM transcript_turns WHERE id = ?").get(tid) as any;
      if (!t || t.current_version !== ver) stale.push(`turn ${tid} text version changed`);
    }
    if (env.mode === "interview" && iv.lifecycle === "ended") stale.push("interview has ended");
    if (stale.length) {
      const id = insertDecision(ctx, cs, env, provider, "rejected_stale", stale, p.rationale, p.next_action.type, null, latencyMs, p);
      return { kind: "stale", decisionId: id, reasons: stale };
    }
    const decisionId = uid("dec");
    const touchedClaims = new Set<string>();
    ensureCoverageRows(ctx, cs, iv.id, iv.project_id);

    // Observations (deduplicated by exact source span so duplicate/late events never double-count).
    const obsIdByRef = new Map<string, string>();
    for (const o of p.observations) {
      const turnText = (db.prepare("SELECT v.text, t.current_version FROM transcript_turns t JOIN transcript_versions v ON v.turn_id = t.id AND v.version = t.current_version WHERE t.id = ?").get(o.turn_id) as any);
      const start = turnText.text.indexOf(o.quote);
      const end = start + o.quote.length;
      const dedupeKey = `${o.turn_id}:${turnText.current_version}:${start}:${end}`;
      const existing = db.prepare("SELECT id FROM evidence WHERE interview_id = ? AND dedupe_key = ?").get(iv.id, dedupeKey) as any;
      if (existing) {
        obsIdByRef.set(o.ref, existing.id);
        continue;
      }
      const id = uid("evd");
      db.prepare(
        `INSERT INTO evidence (id, project_id, interview_id, expert_id, turn_id, turn_version, span_start, span_end, quote, statement, basis, period, population, metric, unit, calc_basis, value, status, decision_id, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).run(
        id,
        iv.project_id,
        iv.id,
        iv.expert_id,
        o.turn_id,
        turnText.current_version,
        start,
        end,
        o.quote,
        o.statement,
        o.basis,
        o.period,
        o.population,
        o.metric,
        o.unit,
        o.calc_basis,
        o.value,
        decisionId,
        dedupeKey,
        now(),
      );
      for (const l of o.claim_links) {
        db.prepare("INSERT OR IGNORE INTO evidence_claim_links (evidence_id, claim_id, relation, comparability, note) VALUES (?, ?, ?, ?, ?)").run(id, l.claim_id, l.relation, l.comparability, l.note);
        touchedClaims.add(l.claim_id);
      }
      for (const old of o.supersedes_evidence_ids) {
        db.prepare("UPDATE evidence SET status = 'superseded', superseded_by = ?, status_reason = 'superseded by later testimony' WHERE id = ? AND status = 'active'").run(id, old);
        cs.touch("evidence", old);
        for (const l of db.prepare("SELECT claim_id FROM evidence_claim_links WHERE evidence_id = ?").all(old) as any[]) touchedClaims.add(l.claim_id);
      }
      for (const old of o.retracts_evidence_ids) {
        db.prepare("UPDATE evidence SET status = 'retracted', superseded_by = ?, status_reason = 'retracted by the participant' WHERE id = ? AND status = 'active'").run(id, old);
        cs.touch("evidence", old);
        for (const l of db.prepare("SELECT claim_id FROM evidence_claim_links WHERE evidence_id = ?").all(old) as any[]) touchedClaims.add(l.claim_id);
      }
      obsIdByRef.set(o.ref, id);
      cs.touch("evidence", id);
    }

    for (const c of p.coverage_updates) {
      db.prepare("UPDATE interview_question_state SET coverage = ?, rationale = ?, answer_turn_ids = ?, updated_at = ? WHERE interview_id = ? AND question_id = ?").run(
        c.coverage,
        c.rationale,
        j(c.answer_turn_ids),
        now(),
        iv.id,
        c.question_id,
      );
      cs.touch("coverage", `${iv.id}:${c.question_id}`);
    }

    const newQuestionIds = new Map<string, string>();
    for (const q of p.new_questions) {
      const dup = (q.fixture_key
        ? db.prepare("SELECT id FROM questions WHERE project_id = ? AND fixture_key = ? AND status = 'active'").get(iv.project_id, q.fixture_key)
        : db
            .prepare("SELECT q.id FROM questions q JOIN question_revisions r ON r.question_id = q.id AND r.revision = q.current_revision WHERE q.project_id = ? AND r.text = ? AND q.status = 'active'")
            .get(iv.project_id, q.text)) as any;
      if (dup) {
        newQuestionIds.set(q.ref, dup.id);
        continue;
      }
      const id = insertQuestion(ctx, cs, iv.project_id, {
        text: q.text,
        purpose: q.purpose,
        priority: q.priority,
        claimIds: q.claim_ids,
        origin: "controller",
        isOriginal: false,
        fixtureKey: q.fixture_key,
        interviewId: iv.id,
        createdBy: `controller:${provider}`,
      });
      newQuestionIds.set(q.ref, id);
    }
    ensureCoverageRows(ctx, cs, iv.id, iv.project_id);

    for (const pc of p.priority_changes) {
      db.prepare("UPDATE questions SET priority = ? WHERE id = ?").run(pc.priority, pc.question_id);
      cs.touch("questions", pc.question_id);
    }
    for (const g of p.evidence_gaps) addClaimGap(ctx, cs, g.claim_id, g.description, `controller (${iv.id})`);
    for (const f of p.findings) {
      const evidenceIds = f.evidence_refs.map((r) => obsIdByRef.get(r) ?? r);
      const dup = db.prepare("SELECT id FROM findings WHERE project_id = ? AND text = ?").get(iv.project_id, f.text);
      if (dup) continue;
      const id = uid("fnd");
      db.prepare("INSERT INTO findings (id, project_id, interview_id, decision_id, kind, text, claim_ids, evidence_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)").run(
        id,
        iv.project_id,
        iv.id,
        decisionId,
        f.kind,
        f.text,
        j(f.claim_ids),
        j(evidenceIds),
        now(),
      );
      cs.touch("findings", id);
    }
    for (const d of p.consumed_directive_ids) {
      db.prepare("UPDATE consultant_directives SET status = 'consumed' WHERE id = ?").run(d);
      cs.touch("directives", d);
    }
    recomputeClaims(ctx, cs, [...touchedClaims]);
    if (env.mode === "interview" || env.transcriptCursor > iv.controller_cursor) {
      const maxNew = Math.max(iv.controller_cursor, ...Object.keys(env.turnVersions).map((tid) => (db.prepare("SELECT seq FROM transcript_turns WHERE id = ?").get(tid) as any)?.seq ?? 0));
      db.prepare("UPDATE interviews SET controller_cursor = ? WHERE id = ?").run(maxNew, iv.id);
    }

    // Next action: resolve the wording from the persisted question revision, never from model text.
    let deliveryId: string | null = null;
    let held = false;
    let ended = false;
    let nextQuestionId: string | null = null;
    const a = p.next_action;
    if (a.type === "ask" && a.question_ref) {
      nextQuestionId = newQuestionIds.get(a.question_ref) ?? a.question_ref;
      const q = db
        .prepare("SELECT q.current_revision, r.text FROM questions q JOIN question_revisions r ON r.question_id = q.id AND r.revision = q.current_revision WHERE q.id = ?")
        .get(nextQuestionId) as any;
      if (iv.lifecycle === "active") {
        deliveryId = createDelivery(ctx, cs, iv.id, { kind: "question", questionId: nextQuestionId, questionRevision: q.current_revision, text: q.text, decisionId });
      } else held = true; // paused or not yet consented: no question is spoken
    } else if (a.type === "end" && env.mode === "interview" && iv.lifecycle === "active") {
      ended = true;
    }
    // Decision id was pre-allocated so evidence can reference it.
    db.prepare(
      `INSERT INTO controller_decisions (id, interview_id, request_id, trigger, expected_revision, generation, plan_version, transcript_cursor, provider, proposal, result, rejection_reasons, rationale, next_action, next_question_id, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
    ).run(
      decisionId,
      iv.id,
      env.requestId,
      env.trigger,
      env.expectedRevision,
      env.generation,
      env.planVersion,
      env.transcriptCursor,
      provider,
      j(p),
      held ? "applied_held" : "applied",
      p.rationale,
      a.type,
      nextQuestionId,
      Math.round(latencyMs),
      now(),
    );
    cs.touch("decisions", decisionId).touch("interviews", iv.id);
    return { kind: "applied", decisionId, deliveryId, held, nextAction: a.type, ended };
  }).result;
}

export function parseProposal(raw: unknown): { ok: true; proposal: ControllerProposal } | { ok: false; reasons: string[] } {
  const r = ControllerProposalSchema.safeParse(raw);
  if (r.success) return { ok: true, proposal: r.data };
  return { ok: false, reasons: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) };
}
