// Interview lifecycle, the single-active-interview guard, transcript turns, and delivery attempts.
import { createHash, randomBytes } from "node:crypto";
import type { ConsentMethod, DeliveryState, InterviewMode } from "../../../shared/contracts";
import { j, now, uid } from "../db/db";
import { recomputeClaims } from "./evidence";
import { commit, DomainError, type ChangeSet, type Ctx } from "./events";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function getInterview(ctx: Ctx, interviewId: string): any {
  const r = ctx.db.prepare("SELECT * FROM interviews WHERE id = ?").get(interviewId);
  if (!r) throw new DomainError(404, "Interview not found.", "not_found");
  return r;
}

export function ensureCoverageRows(ctx: Ctx, cs: ChangeSet, interviewId: string, projectId: string) {
  const qs = ctx.db.prepare("SELECT id FROM questions WHERE project_id = ? AND status = 'active'").all(projectId) as any[];
  const ins = ctx.db.prepare("INSERT OR IGNORE INTO interview_question_state (interview_id, question_id, coverage, updated_at) VALUES (?, ?, 'pending', ?)");
  for (const q of qs) {
    const r = ins.run(interviewId, q.id, now());
    if (r.changes) cs.touch("coverage", `${interviewId}:${q.id}`);
  }
}

export function createInterview(ctx: Ctx, projectId: string, expertId: string, mode: InterviewMode, localTest: boolean): string {
  const db = ctx.db;
  const expert = db.prepare("SELECT * FROM experts WHERE id = ? AND project_id = ? AND deleted = 0").get(expertId, projectId) as any;
  if (!expert) throw new DomainError(404, "Expert not found.", "not_found");
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const plan = project.current_plan_id ? (db.prepare("SELECT * FROM research_plans WHERE id = ?").get(project.current_plan_id) as any) : null;
  if (mode !== "fixture" && (!plan || plan.status !== "approved")) {
    throw new DomainError(409, "Approve the research plan before preparing an interview.", "plan_not_approved");
  }
  return commit(ctx, projectId, "interview.created", (cs) => {
    const id = uid("int");
    db.prepare(
      `INSERT INTO interviews (id, project_id, expert_id, plan_id, plan_version, mode, transport, lifecycle, consent, local_test, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', 'pending', ?, ?)`,
    ).run(
      id,
      projectId,
      expertId,
      plan?.id ?? null,
      plan?.version ?? null,
      mode,
      mode === "synthetic" ? "simulated" : mode === "fixture" ? "fixture" : "browser_ws",
      localTest ? 1 : 0,
      now(),
    );
    ensureCoverageRows(ctx, cs, id, projectId);
    cs.touch("interviews", id);
    return id;
  }).result;
}

function issueToken(ctx: Ctx, interviewId: string, ttlMinutes: number): string {
  const token = randomBytes(24).toString("base64url");
  ctx.db
    .prepare("UPDATE interviews SET join_token_hash = ?, join_token_expires_at = ? WHERE id = ?")
    .run(hashToken(token), new Date(Date.now() + ttlMinutes * 60_000).toISOString(), interviewId);
  return token;
}

/** Acquire the deployment-wide single-active-interview guard transactionally (UNIQUE active_slot). */
export function startInterview(ctx: Ctx, interviewId: string, ttlMinutes: number): { joinToken: string | null } {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle !== "ready") throw new DomainError(409, `Interview cannot start from state '${iv.lifecycle}'.`, "invalid_transition");
  return commit(ctx, iv.project_id, "interview.started", (cs) => {
    try {
      ctx.db.prepare("UPDATE interviews SET active_slot = 1 WHERE id = ? AND active_slot IS NULL").run(interviewId);
    } catch (e: any) {
      if (String(e?.code).startsWith("SQLITE_CONSTRAINT")) {
        throw new DomainError(409, "Another expert interview is already active. Only one interview can run at a time.", "interview_already_active");
      }
      throw e;
    }
    const live = iv.transport === "browser_ws";
    ctx.db
      .prepare("UPDATE interviews SET lifecycle = ?, started_at = ?, generation = generation + 1, control_revision = control_revision + 1 WHERE id = ?")
      .run(live ? "awaiting_participant" : "consent_pending", now(), interviewId);
    ensureCoverageRows(ctx, cs, interviewId, iv.project_id);
    const joinToken = issueToken(ctx, interviewId, ttlMinutes);
    cs.touch("interviews", interviewId);
    return { joinToken };
  }).result;
}

export function reissueJoinToken(ctx: Ctx, interviewId: string, ttlMinutes: number): string {
  const iv = getInterview(ctx, interviewId);
  if (!iv.active_slot) throw new DomainError(409, "Only an active interview can issue a join link.", "not_active");
  return commit(ctx, iv.project_id, "interview.join_token", (cs) => {
    cs.touch("interviews", interviewId);
    return issueToken(ctx, interviewId, ttlMinutes);
  }).result;
}

/** Resolve a participant join token. Tokens are interview-scoped and expire; they never authorize consultant APIs. */
export function resolveJoinToken(ctx: Ctx, token: string): any | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const iv = ctx.db.prepare("SELECT * FROM interviews WHERE join_token_hash = ?").get(hashToken(token)) as any;
  if (!iv) return null;
  if (!iv.join_token_expires_at || Date.parse(iv.join_token_expires_at) < Date.now()) return null;
  return iv;
}

export function participantJoined(ctx: Ctx, interviewId: string) {
  const iv = getInterview(ctx, interviewId);
  if (!iv.active_slot) throw new DomainError(409, "This interview is not active.", "not_active");
  if (!["awaiting_participant", "interrupted", "consent_pending", "active", "paused"].includes(iv.lifecycle)) {
    throw new DomainError(409, "This interview has ended.", "ended");
  }
  commit(ctx, iv.project_id, "interview.participant_joined", (cs) => {
    const next = iv.consent === "accepted" ? (iv.pause_reason ? "paused" : "active") : "consent_pending";
    ctx.db.prepare("UPDATE interviews SET lifecycle = ?, control_revision = control_revision + 1 WHERE id = ?").run(next, interviewId);
    cs.touch("interviews", interviewId);
  });
}

export interface ConsentProvenance {
  method: ConsentMethod;
  /** The participant utterance that gave or refused consent, for a spoken answer. */
  turnId?: string | null;
}

export function recordConsent(ctx: Ctx, interviewId: string, accepted: boolean, how: ConsentProvenance = { method: "control" }) {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle !== "consent_pending") throw new DomainError(409, "Consent is not being requested right now.", "invalid_transition");
  if (!accepted) {
    setConsentProvenance(ctx, interviewId, how);
    return endInterview(ctx, interviewId, "consent_declined", "declined");
  }
  commit(ctx, iv.project_id, "interview.consent", (cs) => {
    // The consent answer itself is not research content: the controller starts after it.
    const seq = how.turnId ? ((ctx.db.prepare("SELECT seq FROM transcript_turns WHERE id = ?").get(how.turnId) as any)?.seq ?? null) : null;
    ctx.db
      .prepare(
        `UPDATE interviews SET consent = 'accepted', lifecycle = 'active', consent_method = ?, consent_turn_id = ?, consent_at = ?,
           controller_cursor = MAX(controller_cursor, COALESCE(?, controller_cursor)), control_revision = control_revision + 1 WHERE id = ?`,
      )
      .run(how.method, how.turnId ?? null, now(), seq, interviewId);
    cs.touch("interviews", interviewId);
  });
}

/** Records how a consent decision was made (used before ending on a refusal). */
export function setConsentProvenance(ctx: Ctx, interviewId: string, how: ConsentProvenance) {
  const iv = getInterview(ctx, interviewId);
  commit(ctx, iv.project_id, "interview.consent_provenance", (cs) => {
    // Nothing said before consent is research content, so the controller never reads it.
    const maxSeq = (ctx.db.prepare("SELECT MAX(seq) AS s FROM transcript_turns WHERE interview_id = ?").get(interviewId) as any).s ?? 0;
    ctx.db
      .prepare("UPDATE interviews SET consent_method = ?, consent_turn_id = ?, consent_at = ?, controller_cursor = MAX(controller_cursor, ?) WHERE id = ?")
      .run(how.method, how.turnId ?? null, now(), maxSeq, interviewId);
    cs.touch("interviews", interviewId);
  });
}

export function pauseInterview(ctx: Ctx, interviewId: string, reason: string) {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle !== "active") throw new DomainError(409, "Only an active interview can be paused.", "invalid_transition");
  commit(ctx, iv.project_id, "interview.paused", (cs) => {
    ctx.db.prepare("UPDATE interviews SET lifecycle = 'paused', pause_reason = ?, control_revision = control_revision + 1 WHERE id = ?").run(reason, interviewId);
    // Pause stops new substantive questions: queued (not yet spoken) deliveries are cancelled.
    for (const d of ctx.db.prepare("SELECT id FROM delivery_attempts WHERE interview_id = ? AND state = 'queued'").all(interviewId) as any[]) {
      transitionDelivery(ctx, cs, d.id, "cancelled", { detail: `paused: ${reason}` });
    }
    cs.touch("interviews", interviewId);
  });
}

export function resumeInterview(ctx: Ctx, interviewId: string) {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle !== "paused") throw new DomainError(409, "The interview is not paused.", "invalid_transition");
  commit(ctx, iv.project_id, "interview.resumed", (cs) => {
    ctx.db.prepare("UPDATE interviews SET lifecycle = 'active', pause_reason = NULL, control_revision = control_revision + 1 WHERE id = ?").run(interviewId);
    cs.touch("interviews", interviewId);
  });
}

/**
 * End the interview: release the guard, bump the generation (invalidating in-flight controller work and
 * provider responses), and cancel pending speech. Later transcripts are recorded but never restart it.
 */
export function endInterview(ctx: Ctx, interviewId: string, reason: string, consent?: "declined" | "withdrawn", graceful = false) {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle === "ended") return;
  commit(ctx, iv.project_id, "interview.ended", (cs) => {
    ctx.db
      .prepare(
        "UPDATE interviews SET lifecycle = 'ended', termination_reason = ?, ended_at = ?, active_slot = NULL, generation = generation + 1, control_revision = control_revision + 1, consent = COALESCE(?, consent), join_token_expires_at = ? WHERE id = ?",
      )
      .run(reason, now(), consent ?? null, now(), interviewId);
    // A graceful end (controller completed) keeps the authorized closing line; any other end cancels it.
    cancelOpenDeliveries(ctx, cs, interviewId, `ended: ${reason}`, "interrupted", graceful ? ["closing"] : []);
    cs.touch("interviews", interviewId);
  });
}

function cancelOpenDeliveries(ctx: Ctx, cs: ChangeSet, interviewId: string, detail: string, speakingTo: DeliveryState = "interrupted", keepKinds: string[] = []) {
  for (const d of ctx.db.prepare("SELECT id, state, kind FROM delivery_attempts WHERE interview_id = ? AND state IN ('queued','speaking')").all(interviewId) as any[]) {
    if (keepKinds.includes(d.kind)) continue;
    transitionDelivery(ctx, cs, d.id, d.state === "queued" ? "cancelled" : speakingTo, { detail });
  }
}

/** Transport loss: completed work is persisted; the session is marked interrupted, not presented as live. */
export function markInterrupted(ctx: Ctx, interviewId: string, reason: string, releaseGuard: boolean) {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle === "ended" || iv.lifecycle === "ready") return;
  commit(ctx, iv.project_id, "interview.interrupted", (cs) => {
    ctx.db
      .prepare(
        `UPDATE interviews SET lifecycle = 'interrupted', pause_reason = ?, generation = generation + 1, control_revision = control_revision + 1${releaseGuard ? ", active_slot = NULL" : ""} WHERE id = ?`,
      )
      .run(reason, interviewId);
    // Playback outcome is uncertain after a disconnect: record it as unknown rather than replaying.
    cancelOpenDeliveries(ctx, cs, interviewId, reason, "unknown");
    cs.touch("interviews", interviewId);
  });
}

/** Explicit resume path after an interruption (disconnect or backend restart). */
export function resumeInterrupted(ctx: Ctx, interviewId: string, ttlMinutes: number): { joinToken: string | null } {
  const iv = getInterview(ctx, interviewId);
  if (iv.lifecycle !== "interrupted") throw new DomainError(409, "Only an interrupted interview can be resumed.", "invalid_transition");
  return commit(ctx, iv.project_id, "interview.resumed_after_interruption", (cs) => {
    if (!iv.active_slot) {
      try {
        ctx.db.prepare("UPDATE interviews SET active_slot = 1 WHERE id = ?").run(interviewId);
      } catch (e: any) {
        if (String(e?.code).startsWith("SQLITE_CONSTRAINT")) throw new DomainError(409, "Another expert interview is already active.", "interview_already_active");
        throw e;
      }
    }
    const live = iv.transport === "browser_ws";
    const next = live ? "awaiting_participant" : iv.consent === "accepted" ? "active" : "consent_pending";
    ctx.db.prepare("UPDATE interviews SET lifecycle = ?, pause_reason = NULL, generation = generation + 1, control_revision = control_revision + 1 WHERE id = ?").run(next, interviewId);
    const joinToken = issueToken(ctx, interviewId, ttlMinutes);
    cs.touch("interviews", interviewId);
    return { joinToken };
  }).result;
}

/** Called at startup: sessions that were live when the backend stopped are marked interrupted. */
export function recoverAfterRestart(ctx: Ctx): string[] {
  const rows = ctx.db.prepare("SELECT id FROM interviews WHERE active_slot IS NOT NULL OR lifecycle IN ('awaiting_participant','consent_pending','active','paused')").all() as any[];
  for (const r of rows) markInterrupted(ctx, r.id, "backend_restart", true);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Delivery attempts
// ---------------------------------------------------------------------------

const DELIVERY_TRANSITIONS: Record<DeliveryState, DeliveryState[]> = {
  queued: ["speaking", "cancelled", "failed", "unknown"],
  speaking: ["completed", "interrupted", "failed", "unknown", "cancelled"],
  completed: [],
  interrupted: [],
  cancelled: [],
  failed: [],
  unknown: [],
};

export function createDelivery(
  ctx: Ctx,
  cs: ChangeSet,
  interviewId: string,
  d: { kind: "question" | "intro" | "clarification" | "closing"; questionId: string | null; questionRevision: number | null; text: string; decisionId: string | null },
): string {
  const iv = getInterview(ctx, interviewId);
  const id = uid("dlv");
  ctx.db
    .prepare(
      "INSERT INTO delivery_attempts (id, interview_id, kind, question_id, question_revision, authorized_text, generation, state, decision_id, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
    )
    .run(id, interviewId, d.kind, d.questionId, d.questionRevision, d.text, iv.generation, d.decisionId, now());
  cs.touch("deliveries", id);
  return id;
}

export function transitionDelivery(
  ctx: Ctx,
  cs: ChangeSet,
  deliveryId: string,
  to: DeliveryState,
  opts: { detail?: string; playedMs?: number | null; actualTranscript?: string | null; providerResponseId?: string | null; providerItemId?: string | null } = {},
): boolean {
  const d = ctx.db.prepare("SELECT * FROM delivery_attempts WHERE id = ?").get(deliveryId) as any;
  if (!d) return false;
  if (d.state === to) return false;
  if (!DELIVERY_TRANSITIONS[d.state as DeliveryState].includes(to)) return false;
  const ts = now();
  ctx.db
    .prepare(
      `UPDATE delivery_attempts SET state = ?,
        started_at = CASE WHEN ? = 'speaking' THEN ? ELSE started_at END,
        completed_at = CASE WHEN ? IN ('completed','interrupted','cancelled','failed','unknown') THEN ? ELSE completed_at END,
        interruption_detail = COALESCE(?, interruption_detail),
        played_ms = COALESCE(?, played_ms),
        actual_transcript = COALESCE(?, actual_transcript),
        provider_response_id = COALESCE(?, provider_response_id),
        provider_item_id = COALESCE(?, provider_item_id)
       WHERE id = ?`,
    )
    .run(to, to, ts, to, ts, opts.detail ?? null, opts.playedMs ?? null, opts.actualTranscript ?? null, opts.providerResponseId ?? null, opts.providerItemId ?? null, deliveryId);
  cs.touch("deliveries", deliveryId);
  return true;
}

export function setDeliveryTranscript(ctx: Ctx, cs: ChangeSet, deliveryId: string, text: string) {
  ctx.db.prepare("UPDATE delivery_attempts SET actual_transcript = ? WHERE id = ?").run(text, deliveryId);
  cs.touch("deliveries", deliveryId);
}

// ---------------------------------------------------------------------------
// Transcript turns
// ---------------------------------------------------------------------------

export interface AppendTurnInput {
  interviewId: string;
  speaker: "expert" | "interviewer" | "system";
  text: string | null;
  finality: "final" | "pending" | "missing";
  reason: "asr" | "fixture" | "typed" | "assistant_transcript";
  sourceEventId?: string | null;
  inputItemId?: string | null;
  deliveryId?: string | null;
  contextDeliveryId?: string | null;
  startedAt?: string;
  endedAt?: string | null;
}

/** Appends a transcript turn. Duplicate provider events (same source event id) return the original turn. */
export function appendTurn(ctx: Ctx, cs: ChangeSet, t: AppendTurnInput): { id: string; duplicate: boolean } {
  const db = ctx.db;
  if (t.sourceEventId) {
    const existing = db.prepare("SELECT id FROM transcript_turns WHERE interview_id = ? AND source_event_id = ?").get(t.interviewId, t.sourceEventId) as any;
    if (existing) return { id: existing.id, duplicate: true };
  }
  const iv = getInterview(ctx, t.interviewId);
  const seq = ((db.prepare("SELECT MAX(seq) AS s FROM transcript_turns WHERE interview_id = ?").get(t.interviewId) as any).s ?? 0) + 1;
  const id = uid("trn");
  const ts = now();
  db.prepare(
    `INSERT INTO transcript_turns (id, interview_id, seq, speaker, channel, source_event_id, input_item_id, delivery_id, context_delivery_id, finality, after_end, current_version, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'interview', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.interviewId,
    seq,
    t.speaker,
    t.sourceEventId ?? null,
    t.inputItemId ?? null,
    t.deliveryId ?? null,
    t.contextDeliveryId ?? null,
    t.finality,
    iv.lifecycle === "ended" ? 1 : 0,
    t.text != null ? 1 : 0,
    t.startedAt ?? ts,
    t.endedAt ?? (t.finality === "final" ? ts : null),
  );
  if (t.text != null) db.prepare("INSERT INTO transcript_versions (turn_id, version, text, reason, created_at) VALUES (?, 1, ?, ?, ?)").run(id, t.text, t.reason, ts);
  cs.touch("turns", id);
  return { id, duplicate: false };
}

/** Completes a pending turn with its final transcription (first text version). */
export function finalizeTurn(ctx: Ctx, cs: ChangeSet, turnId: string, text: string | null, finality: "final" | "missing", reason: "asr" | "typed" | "assistant_transcript") {
  const t = ctx.db.prepare("SELECT * FROM transcript_turns WHERE id = ?").get(turnId) as any;
  if (!t || t.finality !== "pending") return false;
  const ts = now();
  if (text != null) {
    ctx.db.prepare("INSERT INTO transcript_versions (turn_id, version, text, reason, created_at) VALUES (?, 1, ?, ?, ?)").run(turnId, text, reason, ts);
    ctx.db.prepare("UPDATE transcript_turns SET finality = ?, current_version = 1, ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(finality, ts, turnId);
  } else ctx.db.prepare("UPDATE transcript_turns SET finality = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(finality, ts, turnId);
  cs.touch("turns", turnId);
  return true;
}

/**
 * Transcription correction: creates a new text version (history is kept). Evidence extracted from earlier
 * versions is invalidated until recomputed against the new version.
 */
export function correctTurn(ctx: Ctx, projectId: string, turnId: string, text: string, actor: string): { interviewId: string } {
  const db = ctx.db;
  const t = db
    .prepare("SELECT t.*, i.project_id FROM transcript_turns t JOIN interviews i ON i.id = t.interview_id WHERE t.id = ?")
    .get(turnId) as any;
  if (!t || t.project_id !== projectId) throw new DomainError(404, "Transcript turn not found.", "not_found");
  if (t.finality === "pending") throw new DomainError(409, "The turn has not been finalized yet.", "invalid_transition");
  const trimmed = text.trim();
  if (!trimmed) throw new DomainError(400, "Corrected text cannot be empty.", "invalid_input");
  commit(ctx, projectId, "transcript.corrected", (cs) => {
    const version = t.current_version + 1;
    db.prepare("INSERT INTO transcript_versions (turn_id, version, text, reason, created_at) VALUES (?, ?, ?, 'correction', ?)").run(turnId, version, trimmed, now());
    db.prepare("UPDATE transcript_turns SET current_version = ?, finality = 'final' WHERE id = ?").run(version, turnId);
    const affectedClaims = new Set<string>();
    for (const e of db.prepare("SELECT id FROM evidence WHERE turn_id = ? AND status = 'active'").all(turnId) as any[]) {
      db.prepare("UPDATE evidence SET status = 'invalidated', status_reason = ? WHERE id = ?").run(`transcript corrected to v${version}; pending re-extraction`, e.id);
      for (const l of db.prepare("SELECT claim_id FROM evidence_claim_links WHERE evidence_id = ?").all(e.id) as any[]) affectedClaims.add(l.claim_id);
      cs.touch("evidence", e.id);
    }
    recomputeClaims(ctx, cs, [...affectedClaims]);
    const rid = uid("rev");
    db.prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, 'turn', ?, 'transcript_correction', ?, '', ?, ?)").run(
      rid,
      projectId,
      turnId,
      actor,
      j({ version: t.current_version }),
      now(),
    );
    db.prepare("UPDATE interviews SET control_revision = control_revision + 1 WHERE id = ?").run(t.interview_id);
    cs.touch("turns", turnId).touch("reviews", rid).touch("interviews", t.interview_id);
  });
  return { interviewId: t.interview_id };
}

export function lastStartedDelivery(ctx: Ctx, interviewId: string): any | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM delivery_attempts WHERE interview_id = ? AND state IN ('speaking','completed','interrupted') ORDER BY started_at DESC, queued_at DESC LIMIT 1")
      .get(interviewId) as any) ?? null
  );
}

export function addMetric(ctx: Ctx, cs: ChangeSet, interviewId: string, turnId: string | null, name: string, ms: number) {
  const id = uid("met");
  ctx.db.prepare("INSERT INTO latency_metrics (id, interview_id, turn_id, name, ms, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, interviewId, turnId, name, Math.max(0, Math.round(ms)), now());
  cs.touch("metrics", id);
}

