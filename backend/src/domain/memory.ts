// Durable project memory (explicit instructions), derived session handoffs, directives, review cursor,
// and copilot message history. Handoffs are derived deterministically from canonical records.
import { ASSESSMENT_LABELS, type NavigationTarget } from "../../../shared/contracts";
import { j, now, pj, uid } from "../db/db";
import { commit, DomainError, type Ctx } from "./events";
import { handoffDependencyDigest } from "./records";

export function rememberInstruction(ctx: Ctx, projectId: string, text: string, createdBy: string): string {
  const t = text.trim();
  if (!t || t.length > 1000) throw new DomainError(400, "Memory text must be 1-1000 characters.", "invalid_input");
  return commit(ctx, projectId, "memory.added", (cs) => {
    const id = uid("mem");
    ctx.db.prepare("INSERT INTO project_memory (id, project_id, kind, text, status, created_by, created_at) VALUES (?, ?, 'instruction', ?, 'active', ?, ?)").run(id, projectId, t, createdBy, now());
    cs.touch("memory", id);
    return id;
  }).result;
}

export function retireMemory(ctx: Ctx, projectId: string, memoryId: string) {
  const m = ctx.db.prepare("SELECT * FROM project_memory WHERE id = ? AND project_id = ?").get(memoryId, projectId);
  if (!m) throw new DomainError(404, "Memory item not found.", "not_found");
  commit(ctx, projectId, "memory.retired", (cs) => {
    ctx.db.prepare("UPDATE project_memory SET status = 'retired' WHERE id = ?").run(memoryId);
    cs.touch("memory", memoryId);
  });
}

export function editMemory(ctx: Ctx, projectId: string, memoryId: string, text: string) {
  const m = ctx.db.prepare("SELECT * FROM project_memory WHERE id = ? AND project_id = ?").get(memoryId, projectId) as any;
  if (!m) throw new DomainError(404, "Memory item not found.", "not_found");
  if (m.status !== "active") throw new DomainError(409, "Only an active memory item can be corrected.", "invalid_transition");
  const t = text.trim();
  if (!t || t.length > 1000) throw new DomainError(400, "Memory text must be 1-1000 characters.", "invalid_input");
  // Corrections keep history: retire the old item and add the corrected one.
  commit(ctx, projectId, "memory.corrected", (cs) => {
    ctx.db.prepare("UPDATE project_memory SET status = 'retired' WHERE id = ?").run(memoryId);
    const id = uid("mem");
    ctx.db.prepare("INSERT INTO project_memory (id, project_id, kind, text, status, created_by, created_at) VALUES (?, ?, ?, ?, 'active', 'consultant', ?)").run(id, projectId, m.kind, text.trim(), now());
    cs.touch("memory", memoryId).touch("memory", id);
  });
}

export function addDirective(ctx: Ctx, projectId: string, instruction: string, claimIds: string[], createdBy: string): { id: string; interviewId: string | null } {
  const t = instruction.trim();
  if (!t) throw new DomainError(400, "The directive is empty.", "invalid_input");
  const live = ctx.db.prepare("SELECT id FROM interviews WHERE project_id = ? AND active_slot IS NOT NULL").get(projectId) as any;
  return commit(ctx, projectId, "directive.added", (cs) => {
    const id = uid("dir");
    ctx.db.prepare("INSERT INTO consultant_directives (id, project_id, interview_id, instruction, claim_ids, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)").run(
      id,
      projectId,
      live?.id ?? null,
      t.slice(0, 1000),
      j(claimIds),
      createdBy,
      now(),
    );
    if (live) ctx.db.prepare("UPDATE interviews SET control_revision = control_revision + 1 WHERE id = ?").run(live.id);
    cs.touch("directives", id);
    if (live) cs.touch("interviews", live.id);
    return { id, interviewId: live?.id ?? null };
  }).result;
}

export function markReviewed(ctx: Ctx, projectId: string) {
  commit(ctx, projectId, "project.reviewed", () => {
    ctx.db.prepare("UPDATE projects SET last_reviewed_revision = state_revision + 1 WHERE id = ?").run(projectId);
  });
}

export function saveCopilotMessage(
  ctx: Ctx,
  projectId: string,
  m: { role: "consultant" | "assistant" | "tool"; channel: "text" | "voice"; text: string; toolName?: string | null; navigation?: NavigationTarget | null; provider: string },
): string {
  return commit(ctx, projectId, "copilot.message", (cs) => {
    const id = uid("cop");
    ctx.db.prepare("INSERT INTO copilot_messages (id, project_id, role, channel, text, tool_name, navigation, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      projectId,
      m.role,
      m.channel,
      m.text.slice(0, 8000),
      m.toolName ?? null,
      m.navigation ? j(m.navigation) : null,
      m.provider,
      now(),
    );
    cs.touch("copilot", id);
    return id;
  }).result;
}

/** Derived, compact "where were we" summary with references back to canonical records. */
export function buildHandoffContent(ctx: Ctx, projectId: string) {
  const db = ctx.db;
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const interviews = db.prepare("SELECT i.*, e.name FROM interviews i JOIN experts e ON e.id = i.expert_id WHERE i.project_id = ? ORDER BY i.created_at").all(projectId) as any[];
  const claims = db.prepare("SELECT * FROM claims WHERE project_id = ? AND status = 'active' ORDER BY code").all(projectId) as any[];
  const evidence = db.prepare("SELECT id, statement, interview_id FROM evidence WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC").all(projectId) as any[];
  const findings = db.prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY created_at").all(projectId) as any[];
  const memory = db.prepare("SELECT text FROM project_memory WHERE project_id = ? AND status = 'active'").all(projectId) as any[];
  const plan = p.current_plan_id ? (db.prepare("SELECT * FROM research_plans WHERE id = ?").get(p.current_plan_id) as any) : null;
  const done = interviews.filter((i) => i.lifecycle === "ended");
  const live = interviews.find((i) => i.active_slot);
  const lines: string[] = [];
  lines.push(`${p.company}: ${p.objective}`);
  lines.push(
    `Operational status: plan ${plan ? `v${plan.version} ${plan.status}` : "not generated"}; ${done.length} interview(s) ended${live ? `; ${live.name} interview is ${live.lifecycle}` : ""}. Operational progress is not evidence strength.`,
  );
  for (const c of claims) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM evidence_claim_links l JOIN evidence e ON e.id = l.evidence_id WHERE l.claim_id = ? AND e.status = 'active'").get(c.id) as any).n;
    lines.push(`${c.code} (${ASSESSMENT_LABELS[c.assessment as keyof typeof ASSESSMENT_LABELS]}, ${n} observation(s)): ${c.assertion}`);
  }
  const flagged = findings.filter((f) => f.status === "flagged");
  for (const f of findings) lines.push(`Finding [${f.status}] ${f.id}: ${f.text}${f.review_note ? ` — consultant note: ${f.review_note}` : ""}`);
  if (memory.length) lines.push(`Project instructions: ${memory.map((m) => m.text).join(" | ")}`);
  const unresolved: string[] = [];
  for (const c of claims) for (const g of pj<{ description: string }[]>(c.gaps, [])) unresolved.push(`${c.code}: ${g.description}`);
  for (const c of claims.filter((c) => c.assessment === "unassessed" || c.assessment === "inconclusive")) unresolved.push(`${c.code} is ${c.assessment}.`);
  const nextSteps: string[] = [];
  for (const f of flagged) if (f.next_evidence_needed) nextSteps.push(f.next_evidence_needed);
  if (!plan) nextSteps.push("Generate and approve a research plan.");
  else if (plan.status !== "approved") nextSteps.push("Review and approve the research plan.");
  if (!live && plan?.status === "approved") nextSteps.push("Select the next recommended expert and start an interview.");
  return {
    summary: lines.join("\n"),
    // Evidence behind interpretations first, then the most recent observations.
    evidenceRefs: [...new Set([...findings.flatMap((f) => pj<string[]>(f.evidence_ids, [])).filter((id) => evidence.some((e) => e.id === id)), ...evidence.map((e) => e.id)])].slice(0, 12),
    unresolved: unresolved.slice(0, 12),
    nextSteps: nextSteps.slice(0, 8),
    sourceRevision: p.state_revision,
  };
}

export function saveHandoff(ctx: Ctx, projectId: string): string {
  const content = buildHandoffContent(ctx, projectId);
  const digest = handoffDependencyDigest(ctx.db, projectId);
  return commit(ctx, projectId, "handoff.saved", (cs) => {
    const id = uid("hnd");
    ctx.db.prepare(
      "INSERT INTO session_handoffs (id, project_id, summary, source_revision, evidence_refs, unresolved, next_steps, dependency_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, projectId, content.summary, content.sourceRevision, j(content.evidenceRefs), j(content.unresolved), j(content.nextSteps), digest, now());
    cs.touch("handoffs", id);
    return id;
  }).result;
}

/** Return the latest handoff, rebuilding it first if its dependencies changed. */
export function currentHandoff(ctx: Ctx, projectId: string): { id: string; summary: string; unresolved: string[]; nextSteps: string[]; evidenceRefs: string[]; rebuilt: boolean } {
  const latest = ctx.db.prepare("SELECT * FROM session_handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
  const digest = handoffDependencyDigest(ctx.db, projectId);
  let rebuilt = false;
  let row = latest;
  if (!latest || latest.dependency_digest !== digest) {
    const id = saveHandoff(ctx, projectId);
    row = ctx.db.prepare("SELECT * FROM session_handoffs WHERE id = ?").get(id);
    rebuilt = true;
  }
  return { id: row.id, summary: row.summary, unresolved: pj(row.unresolved, []), nextSteps: pj(row.next_steps, []), evidenceRefs: pj(row.evidence_refs, []), rebuilt };
}
