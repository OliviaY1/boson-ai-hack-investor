// Row -> API record mapping, and snapshot assembly from canonical tables.
import type {
  ClaimRecord,
  CollectionName,
  CopilotMessageRecord,
  CoverageRecord,
  DecisionRecord,
  DeliveryRecord,
  DirectiveRecord,
  DocumentRecord,
  EvidenceRecord,
  ExpertRecord,
  FindingRecord,
  HandoffRecord,
  InterviewRecord,
  MemoryRecord,
  MetricRecord,
  PlanRecord,
  ProjectRecord,
  QuestionRecord,
  RankingRecord,
  ReviewRecord,
  Snapshot,
  TurnRecord,
} from "../../../shared/contracts";
import { pj, type DB } from "../db/db";

type Row = Record<string, any>;

export function mapProject(r: Row): ProjectRecord {
  return {
    id: r.id,
    company: r.company,
    objective: r.objective,
    owner: r.owner,
    stateRevision: r.state_revision,
    thesisVersion: r.thesis_version,
    currentPlanId: r.current_plan_id,
    isSynthetic: !!r.is_synthetic,
    lastReviewedRevision: r.last_reviewed_revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDocument(db: DB, r: Row): DocumentRecord {
  const passages = db
    .prepare("SELECT * FROM passages WHERE document_id = ? ORDER BY ordinal")
    .all(r.id)
    .map((p: any) => ({
      id: p.id,
      documentId: p.document_id,
      ordinal: p.ordinal,
      text: p.text,
      startOffset: p.start_offset,
      endOffset: p.end_offset,
    }));
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    thesisVersion: r.thesis_version,
    extractedText: r.extracted_text,
    isCurrent: !!r.is_current,
    createdAt: r.created_at,
    passages,
  };
}

function mapClaim(r: Row): ClaimRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    code: r.code,
    assertion: r.assertion,
    passageIds: pj(r.passage_ids, []),
    priority: r.priority,
    scopeDefinition: r.scope_definition,
    metricDefinition: r.metric_definition,
    missingDefinitions: pj(r.missing_definitions, []),
    evidenceSupporting: r.evidence_supporting,
    evidenceChallenging: r.evidence_challenging,
    assessment: r.assessment,
    assessmentRationale: r.assessment_rationale,
    status: r.status,
    thesisVersion: r.thesis_version,
    gaps: pj(r.gaps, []),
    updatedAt: r.updated_at,
  };
}

function mapExpert(r: Row): ExpertRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    title: r.title,
    organization: r.organization,
    background: r.background,
    source: r.source,
    sourceSystem: r.source_system,
    sourceRecordId: r.source_record_id,
    retrievedAt: r.retrieved_at,
    isSynthetic: !!r.is_synthetic,
    deleted: !!r.deleted,
    createdAt: r.created_at,
  };
}

function mapPlan(r: Row): PlanRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    version: r.version,
    status: r.status,
    producedBy: r.produced_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    gaps: pj(r.gaps, []),
    snapshot: pj(r.snapshot, null),
    thesisVersion: r.thesis_version,
    createdAt: r.created_at,
  };
}

function mapRanking(r: Row): RankingRecord {
  return {
    id: r.id,
    planId: r.plan_id,
    expertId: r.expert_id,
    rank: r.rank,
    score: r.score,
    rationale: r.rationale,
    backgroundQuote: r.background_quote,
    claimIds: pj(r.claim_ids, []),
    recommended: !!r.recommended,
    selected: !!r.selected,
  };
}

function mapQuestion(db: DB, r: Row): QuestionRecord {
  const revisions = db
    .prepare("SELECT * FROM question_revisions WHERE question_id = ? ORDER BY revision")
    .all(r.id)
    .map((v: any) => ({ revision: v.revision, text: v.text, purpose: v.purpose, createdBy: v.created_by, createdAt: v.created_at }));
  const cur = revisions.find((v) => v.revision === r.current_revision) ?? revisions[revisions.length - 1];
  return {
    id: r.id,
    projectId: r.project_id,
    code: r.code,
    currentRevision: r.current_revision,
    text: cur?.text ?? "",
    purpose: cur?.purpose ?? "",
    priority: r.priority,
    claimIds: pj(r.claim_ids, []),
    origin: r.origin,
    isOriginal: !!r.is_original,
    status: r.status,
    fixtureKey: r.fixture_key,
    createdInInterviewId: r.created_in_interview_id,
    revisions,
    createdAt: r.created_at,
  };
}

export function mapInterview(r: Row): InterviewRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    expertId: r.expert_id,
    planId: r.plan_id,
    planVersion: r.plan_version,
    mode: r.mode,
    transport: r.transport,
    lifecycle: r.lifecycle,
    consent: r.consent,
    consentMethod: r.consent_method ?? null,
    consentTurnId: r.consent_turn_id ?? null,
    consentAt: r.consent_at ?? null,
    pauseReason: r.pause_reason,
    terminationReason: r.termination_reason,
    controlRevision: r.control_revision,
    generation: r.generation,
    controllerCursor: r.controller_cursor,
    joinTokenExpiresAt: r.join_token_expires_at,
    localTest: !!r.local_test,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    createdAt: r.created_at,
  };
}

function mapCoverage(r: Row): CoverageRecord {
  return {
    id: `${r.interview_id}:${r.question_id}`,
    interviewId: r.interview_id,
    questionId: r.question_id,
    coverage: r.coverage,
    rationale: r.rationale,
    answerTurnIds: pj(r.answer_turn_ids, []),
    updatedAt: r.updated_at,
  };
}

export function mapDelivery(r: Row): DeliveryRecord {
  return {
    id: r.id,
    interviewId: r.interview_id,
    kind: r.kind,
    questionId: r.question_id,
    questionRevision: r.question_revision,
    authorizedText: r.authorized_text,
    actualTranscript: r.actual_transcript,
    providerResponseId: r.provider_response_id,
    providerItemId: r.provider_item_id,
    generation: r.generation,
    state: r.state,
    playedMs: r.played_ms,
    interruptionDetail: r.interruption_detail,
    decisionId: r.decision_id,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

export function mapTurn(db: DB, r: Row): TurnRecord {
  const versions = db
    .prepare("SELECT * FROM transcript_versions WHERE turn_id = ? ORDER BY version")
    .all(r.id)
    .map((v: any) => ({ version: v.version, text: v.text, reason: v.reason, createdAt: v.created_at }));
  const cur = versions.find((v) => v.version === r.current_version);
  return {
    id: r.id,
    interviewId: r.interview_id,
    seq: r.seq,
    speaker: r.speaker,
    channel: r.channel,
    sourceEventId: r.source_event_id,
    inputItemId: r.input_item_id,
    deliveryId: r.delivery_id,
    contextDeliveryId: r.context_delivery_id,
    finality: r.finality,
    afterEnd: !!r.after_end,
    currentVersion: r.current_version,
    text: cur?.text ?? "",
    versions,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

export function mapEvidence(db: DB, r: Row): EvidenceRecord {
  const links = db
    .prepare("SELECT * FROM evidence_claim_links WHERE evidence_id = ?")
    .all(r.id)
    .map((l: any) => ({
      claimId: l.claim_id,
      relation: l.relation,
      comparability: l.comparability,
      note: l.note,
      disputed: !!l.disputed,
    }));
  return {
    id: r.id,
    projectId: r.project_id,
    interviewId: r.interview_id,
    expertId: r.expert_id,
    turnId: r.turn_id,
    turnVersion: r.turn_version,
    spanStart: r.span_start,
    spanEnd: r.span_end,
    quote: r.quote,
    statement: r.statement,
    basis: r.basis,
    period: r.period,
    population: r.population,
    metric: r.metric,
    unit: r.unit,
    calcBasis: r.calc_basis,
    value: r.value,
    status: r.status,
    supersededBy: r.superseded_by,
    statusReason: r.status_reason,
    links,
    reviewStatus: r.review_status,
    decisionId: r.decision_id,
    createdAt: r.created_at,
  };
}

function mapFinding(r: Row): FindingRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    interviewId: r.interview_id,
    decisionId: r.decision_id,
    kind: r.kind,
    text: r.text,
    claimIds: pj(r.claim_ids, []),
    evidenceIds: pj(r.evidence_ids, []),
    status: r.status,
    reviewNote: r.review_note,
    nextEvidenceNeeded: r.next_evidence_needed,
    createdAt: r.created_at,
  };
}

function mapDecision(r: Row): DecisionRecord {
  return {
    id: r.id,
    interviewId: r.interview_id,
    requestId: r.request_id,
    trigger: r.trigger,
    expectedRevision: r.expected_revision,
    generation: r.generation,
    planVersion: r.plan_version,
    transcriptCursor: r.transcript_cursor,
    provider: r.provider,
    result: r.result,
    rejectionReasons: pj(r.rejection_reasons, []),
    rationale: r.rationale,
    nextAction: r.next_action,
    nextQuestionId: r.next_question_id,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  };
}

function mapReview(r: Row): ReviewRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    targetType: r.target_type,
    targetId: r.target_id,
    action: r.action,
    actor: r.actor,
    rationale: r.rationale,
    priorVersion: pj(r.prior_version, null),
    createdAt: r.created_at,
  };
}

function mapMemory(r: Row): MemoryRecord {
  return { id: r.id, projectId: r.project_id, kind: r.kind, text: r.text, status: r.status, createdBy: r.created_by, createdAt: r.created_at };
}

function mapHandoff(r: Row, currentDigest?: string): HandoffRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    summary: r.summary,
    sourceRevision: r.source_revision,
    evidenceRefs: pj(r.evidence_refs, []),
    unresolved: pj(r.unresolved, []),
    nextSteps: pj(r.next_steps, []),
    stale: currentDigest !== undefined ? currentDigest !== r.dependency_digest : false,
    createdAt: r.created_at,
  };
}

function mapCopilot(r: Row): CopilotMessageRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    channel: r.channel,
    text: r.text,
    toolName: r.tool_name,
    navigation: pj(r.navigation, null),
    provider: r.provider,
    createdAt: r.created_at,
  };
}

function mapDirective(r: Row): DirectiveRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    interviewId: r.interview_id,
    instruction: r.instruction,
    claimIds: pj(r.claim_ids, []),
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function mapMetric(r: Row): MetricRecord {
  return { id: r.id, interviewId: r.interview_id, turnId: r.turn_id, name: r.name, ms: r.ms, createdAt: r.created_at };
}

/** Digest of the records a handoff depends on; a changed digest marks the handoff stale. */
export function handoffDependencyDigest(db: DB, projectId: string): string {
  const q = (sql: string) => (db.prepare(sql).get(projectId) as any)?.v ?? "";
  return [
    q("SELECT group_concat(id || status || review_status, ',') AS v FROM evidence WHERE project_id = ?"),
    q("SELECT group_concat(id || assessment, ',') AS v FROM claims WHERE project_id = ?"),
    q("SELECT group_concat(id || lifecycle, ',') AS v FROM interviews WHERE project_id = ?"),
    q("SELECT group_concat(id || status, ',') AS v FROM findings WHERE project_id = ?"),
    q("SELECT group_concat(id || status, ',') AS v FROM project_memory WHERE project_id = ?"),
  ].join("|");
}

/** Load one record of a collection by id in its API shape (or null if it no longer exists). */
export function loadRecord(db: DB, collection: CollectionName, id: string): any {
  switch (collection) {
    case "documents": {
      const r = db.prepare("SELECT * FROM source_documents WHERE id = ?").get(id) as Row | undefined;
      return r ? mapDocument(db, r) : null;
    }
    case "claims": {
      const r = db.prepare("SELECT * FROM claims WHERE id = ?").get(id) as Row | undefined;
      return r ? mapClaim(r) : null;
    }
    case "experts": {
      const r = db.prepare("SELECT * FROM experts WHERE id = ?").get(id) as Row | undefined;
      return r ? mapExpert(r) : null;
    }
    case "plans": {
      const r = db.prepare("SELECT * FROM research_plans WHERE id = ?").get(id) as Row | undefined;
      return r ? mapPlan(r) : null;
    }
    case "rankings": {
      const r = db.prepare("SELECT * FROM expert_rankings WHERE id = ?").get(id) as Row | undefined;
      return r ? mapRanking(r) : null;
    }
    case "questions": {
      const r = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as Row | undefined;
      return r ? mapQuestion(db, r) : null;
    }
    case "interviews": {
      const r = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id) as Row | undefined;
      return r ? mapInterview(r) : null;
    }
    case "coverage": {
      const [iid, qid] = id.split(":");
      const r = db.prepare("SELECT * FROM interview_question_state WHERE interview_id = ? AND question_id = ?").get(iid, qid) as Row | undefined;
      return r ? mapCoverage(r) : null;
    }
    case "deliveries": {
      const r = db.prepare("SELECT * FROM delivery_attempts WHERE id = ?").get(id) as Row | undefined;
      return r ? mapDelivery(r) : null;
    }
    case "turns": {
      const r = db.prepare("SELECT * FROM transcript_turns WHERE id = ?").get(id) as Row | undefined;
      return r ? mapTurn(db, r) : null;
    }
    case "evidence": {
      const r = db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) as Row | undefined;
      return r ? mapEvidence(db, r) : null;
    }
    case "findings": {
      const r = db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as Row | undefined;
      return r ? mapFinding(r) : null;
    }
    case "decisions": {
      const r = db.prepare("SELECT * FROM controller_decisions WHERE id = ?").get(id) as Row | undefined;
      return r ? mapDecision(r) : null;
    }
    case "reviews": {
      const r = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Row | undefined;
      return r ? mapReview(r) : null;
    }
    case "memory": {
      const r = db.prepare("SELECT * FROM project_memory WHERE id = ?").get(id) as Row | undefined;
      return r ? mapMemory(r) : null;
    }
    case "handoffs": {
      const r = db.prepare("SELECT * FROM session_handoffs WHERE id = ?").get(id) as Row | undefined;
      return r ? mapHandoff(r, handoffDependencyDigest(db, r.project_id)) : null;
    }
    case "copilot": {
      const r = db.prepare("SELECT * FROM copilot_messages WHERE id = ?").get(id) as Row | undefined;
      return r ? mapCopilot(r) : null;
    }
    case "directives": {
      const r = db.prepare("SELECT * FROM consultant_directives WHERE id = ?").get(id) as Row | undefined;
      return r ? mapDirective(r) : null;
    }
    case "metrics": {
      const r = db.prepare("SELECT * FROM latency_metrics WHERE id = ?").get(id) as Row | undefined;
      return r ? mapMetric(r) : null;
    }
  }
}

export function loadProject(db: DB, id: string): ProjectRecord | null {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return r ? mapProject(r) : null;
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const it of items) out[it.id] = it;
  return out;
}

export function buildSnapshot(db: DB, projectId: string): Snapshot | null {
  const project = loadProject(db, projectId);
  if (!project) return null;
  const all = (sql: string) => db.prepare(sql).all(projectId) as Row[];
  const interviewIds = "SELECT id FROM interviews WHERE project_id = ?";
  const digest = handoffDependencyDigest(db, projectId);
  return {
    project,
    documents: byId(all("SELECT * FROM source_documents WHERE project_id = ?").map((r) => mapDocument(db, r))),
    claims: byId(all("SELECT * FROM claims WHERE project_id = ?").map(mapClaim)),
    experts: byId(all("SELECT * FROM experts WHERE project_id = ?").map(mapExpert)),
    plans: byId(all("SELECT * FROM research_plans WHERE project_id = ?").map(mapPlan)),
    rankings: byId(
      all("SELECT r.* FROM expert_rankings r JOIN research_plans p ON p.id = r.plan_id WHERE p.project_id = ?").map(mapRanking),
    ),
    questions: byId(all("SELECT * FROM questions WHERE project_id = ?").map((r) => mapQuestion(db, r))),
    interviews: byId(all("SELECT * FROM interviews WHERE project_id = ?").map(mapInterview)),
    coverage: byId(all(`SELECT * FROM interview_question_state WHERE interview_id IN (${interviewIds})`).map(mapCoverage)),
    deliveries: byId(all(`SELECT * FROM delivery_attempts WHERE interview_id IN (${interviewIds})`).map(mapDelivery)),
    turns: byId(all(`SELECT * FROM transcript_turns WHERE interview_id IN (${interviewIds})`).map((r) => mapTurn(db, r))),
    evidence: byId(all("SELECT * FROM evidence WHERE project_id = ?").map((r) => mapEvidence(db, r))),
    findings: byId(all("SELECT * FROM findings WHERE project_id = ?").map(mapFinding)),
    decisions: byId(all(`SELECT * FROM controller_decisions WHERE interview_id IN (${interviewIds})`).map(mapDecision)),
    reviews: byId(all("SELECT * FROM reviews WHERE project_id = ?").map(mapReview)),
    memory: byId(all("SELECT * FROM project_memory WHERE project_id = ?").map(mapMemory)),
    handoffs: byId(all("SELECT * FROM session_handoffs WHERE project_id = ?").map((r) => mapHandoff(r, digest))),
    copilot: byId(all("SELECT * FROM copilot_messages WHERE project_id = ?").map(mapCopilot)),
    directives: byId(all("SELECT * FROM consultant_directives WHERE project_id = ?").map(mapDirective)),
    metrics: byId(all(`SELECT * FROM latency_metrics WHERE interview_id IN (${interviewIds})`).map(mapMetric)),
  };
}
