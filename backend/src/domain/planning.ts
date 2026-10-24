// Planner application, plan editing, versioned approval.
import { PlannerProposalSchema, type PlannerProposal } from "../../../shared/contracts";
import { j, now, pj, uid } from "../db/db";
import type { ReasoningProvider } from "../providers/types";
import { ProviderError } from "../providers/types";
import { commit, DomainError, type ChangeSet, type Ctx } from "./events";
import { currentPassages, requireProject } from "./projects";

export interface PlannerValidationContext {
  passageIds: Set<string>;
  experts: Map<string, string>; // id -> background
}

export function validatePlannerProposal(p: PlannerProposal, v: PlannerValidationContext): string[] {
  const errors: string[] = [];
  const refs = new Set<string>();
  for (const c of p.claims) {
    if (refs.has(c.ref)) errors.push(`Duplicate claim ref ${c.ref}.`);
    refs.add(c.ref);
    for (const pid of c.passage_ids) if (!v.passageIds.has(pid)) errors.push(`Claim ${c.ref} cites unknown passage ${pid}.`);
  }
  const seenExperts = new Set<string>();
  for (const r of p.expert_rankings) {
    const bg = v.experts.get(r.expert_id);
    if (bg === undefined) errors.push(`Ranking references unknown expert ${r.expert_id}.`);
    else if (!bg.includes(r.background_quote)) errors.push(`Ranking for ${r.expert_id} quotes text not found in the expert's documented background.`);
    if (seenExperts.has(r.expert_id)) errors.push(`Duplicate ranking for ${r.expert_id}.`);
    seenExperts.add(r.expert_id);
    for (const cr of r.claim_refs) if (!refs.has(cr)) errors.push(`Ranking references unknown claim ref ${cr}.`);
  }
  for (const q of p.questions) for (const cr of q.claim_refs) if (!refs.has(cr)) errors.push(`Question references unknown claim ref ${cr}.`);
  for (const g of p.gaps) for (const cr of g.claim_refs) if (!refs.has(cr)) errors.push(`Gap references unknown claim ref ${cr}.`);
  return errors;
}

export async function runPlanner(ctx: Ctx, provider: ReasoningProvider, projectId: string): Promise<string> {
  const project = requireProject(ctx, projectId);
  const passages = currentPassages(ctx, projectId);
  if (passages.length === 0) throw new DomainError(400, "Add a thesis (pasted text or DOCX) before planning.", "no_thesis");
  const experts = ctx.db
    .prepare("SELECT id, name, title, organization, background FROM experts WHERE project_id = ? AND deleted = 0")
    .all(projectId) as { id: string; name: string; title: string; organization: string; background: string }[];
  const instructions = (ctx.db.prepare("SELECT text FROM project_memory WHERE project_id = ? AND status = 'active' AND kind = 'instruction'").all(projectId) as any[]).map(
    (r) => r.text,
  );
  let raw: unknown;
  try {
    raw = await provider.plan({ company: project.company, objective: project.objective, passages, experts, projectInstructions: instructions });
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : (e as Error).message;
    throw new DomainError(502, `Planner provider (${provider.name}) failed: ${msg}. No changes were made.`, "provider_failed");
  }
  const parsed = PlannerProposalSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(502, `Planner output failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`, "invalid_model_output");
  const errors = validatePlannerProposal(parsed.data, {
    passageIds: new Set(passages.map((p) => p.id)),
    experts: new Map(experts.map((e) => [e.id, e.background])),
  });
  if (errors.length) throw new DomainError(502, `Planner output failed semantic validation: ${errors.slice(0, 4).join(" ")}`, "invalid_model_output");
  return applyPlannerProposal(ctx, projectId, parsed.data, provider.name);
}

export function applyPlannerProposal(ctx: Ctx, projectId: string, p: PlannerProposal, producedBy: string): string {
  return commit(ctx, projectId, "plan.generated", (cs) => {
    const db = ctx.db;
    const ts = now();
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
    const version = ((db.prepare("SELECT MAX(version) AS v FROM research_plans WHERE project_id = ?").get(projectId) as any).v ?? 0) + 1;
    for (const old of db.prepare("SELECT id FROM research_plans WHERE project_id = ? AND status = 'draft'").all(projectId) as any[]) {
      db.prepare("UPDATE research_plans SET status = 'superseded' WHERE id = ?").run(old.id);
      cs.touch("plans", old.id);
    }
    // Retire claims and planner questions that never gathered evidence or coverage; keep everything with history.
    for (const c of db.prepare("SELECT id FROM claims WHERE project_id = ? AND status = 'active'").all(projectId) as any[]) {
      const used = db.prepare("SELECT 1 FROM evidence_claim_links WHERE claim_id = ? LIMIT 1").get(c.id);
      if (!used) {
        db.prepare("UPDATE claims SET status = 'retired', updated_at = ? WHERE id = ?").run(ts, c.id);
        cs.touch("claims", c.id);
      }
    }
    for (const q of db.prepare("SELECT id FROM questions WHERE project_id = ? AND status = 'active' AND origin = 'planner'").all(projectId) as any[]) {
      const used = db.prepare("SELECT 1 FROM interview_question_state WHERE question_id = ? LIMIT 1").get(q.id);
      if (!used) {
        db.prepare("UPDATE questions SET status = 'removed' WHERE id = ?").run(q.id);
        cs.touch("questions", q.id);
      }
    }
    // Codes are never reused: a kept claim keeps its code, and a retired code never names a different assertion.
    let claimN = (db.prepare("SELECT MAX(CAST(SUBSTR(code, 2) AS INTEGER)) AS n FROM claims WHERE project_id = ?").get(projectId) as any).n ?? 0;
    const claimIdByRef = new Map<string, string>();
    for (const c of p.claims) {
      const id = uid("clm");
      claimN += 1;
      db.prepare(
        `INSERT INTO claims (id, project_id, code, assertion, passage_ids, priority, scope_definition, metric_definition, missing_definitions, evidence_supporting, evidence_challenging, thesis_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        projectId,
        `C${claimN}`,
        c.assertion,
        j(c.passage_ids),
        c.priority,
        c.scope_definition,
        c.metric_definition,
        j(c.missing_definitions),
        c.evidence_supporting,
        c.evidence_challenging,
        project.thesis_version,
        ts,
        ts,
      );
      claimIdByRef.set(c.ref, id);
      cs.touch("claims", id);
    }
    const planId = uid("pln");
    db.prepare(
      "INSERT INTO research_plans (id, project_id, version, status, produced_by, gaps, thesis_version, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)",
    ).run(
      planId,
      projectId,
      version,
      producedBy,
      j(p.gaps.map((g) => ({ description: g.description, claimIds: g.claim_refs.map((r) => claimIdByRef.get(r)!).filter(Boolean) }))),
      project.thesis_version,
      ts,
    );
    cs.touch("plans", planId);
    const sorted = [...p.expert_rankings].sort((a, b) => b.score - a.score);
    sorted.forEach((r, i) => {
      const id = uid("rnk");
      db.prepare(
        "INSERT INTO expert_rankings (id, plan_id, expert_id, rank, score, rationale, background_quote, claim_ids, recommended, selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, planId, r.expert_id, i + 1, r.score, r.rationale, r.background_quote, j(r.claim_refs.map((x) => claimIdByRef.get(x))), r.recommended ? 1 : 0, r.recommended ? 1 : 0);
      cs.touch("rankings", id);
    });
    let qn = (db.prepare("SELECT COUNT(*) AS n FROM questions WHERE project_id = ?").get(projectId) as any).n;
    for (const q of p.questions) {
      qn += 1;
      insertQuestion(ctx, cs, projectId, {
        code: `Q${qn}`,
        text: q.text,
        purpose: q.purpose,
        priority: q.priority,
        claimIds: q.claim_refs.map((r) => claimIdByRef.get(r)!).filter(Boolean),
        origin: "planner",
        isOriginal: true,
        fixtureKey: q.fixture_key,
        interviewId: null,
        createdBy: producedBy,
      });
    }
    db.prepare("UPDATE projects SET current_plan_id = ? WHERE id = ?").run(planId, projectId);
    return planId;
  }).result;
}

export function insertQuestion(
  ctx: Ctx,
  cs: ChangeSet,
  projectId: string,
  q: {
    code?: string;
    text: string;
    purpose: string;
    priority: number;
    claimIds: string[];
    origin: "planner" | "consultant" | "controller" | "copilot";
    isOriginal: boolean;
    fixtureKey: string | null;
    interviewId: string | null;
    createdBy: string;
  },
): string {
  const id = uid("q");
  const code = q.code ?? `Q${(ctx.db.prepare("SELECT COUNT(*) AS n FROM questions WHERE project_id = ?").get(projectId) as any).n + 1}`;
  const ts = now();
  ctx.db
    .prepare(
      "INSERT INTO questions (id, project_id, code, current_revision, priority, claim_ids, origin, is_original, status, fixture_key, created_in_interview_id, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'active', ?, ?, ?)",
    )
    .run(id, projectId, code, q.priority, j(q.claimIds), q.origin, q.isOriginal ? 1 : 0, q.fixtureKey, q.interviewId, ts);
  ctx.db.prepare("INSERT INTO question_revisions (question_id, revision, text, purpose, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)").run(id, q.text, q.purpose, q.createdBy, ts);
  cs.touch("questions", id);
  return id;
}

/** Bump the control revision of the project's live interview so in-flight controller output becomes stale. */
export function bumpLiveInterviewRevision(ctx: Ctx, cs: ChangeSet, projectId: string) {
  for (const r of ctx.db.prepare("SELECT id FROM interviews WHERE project_id = ? AND active_slot IS NOT NULL").all(projectId) as any[]) {
    ctx.db.prepare("UPDATE interviews SET control_revision = control_revision + 1 WHERE id = ?").run(r.id);
    cs.touch("interviews", r.id);
  }
}

export function editQuestion(
  ctx: Ctx,
  projectId: string,
  questionId: string,
  patch: { text?: string; purpose?: string; priority?: number; claimIds?: string[]; status?: "active" | "removed" },
  actor: string,
) {
  const db = ctx.db;
  const q = db.prepare("SELECT * FROM questions WHERE id = ? AND project_id = ?").get(questionId, projectId) as any;
  if (!q) throw new DomainError(404, "Question not found.", "not_found");
  if (patch.claimIds) {
    for (const c of patch.claimIds) if (!db.prepare("SELECT 1 FROM claims WHERE id = ? AND project_id = ?").get(c, projectId)) throw new DomainError(400, `Unknown claim ${c}.`, "invalid_reference");
  }
  commit(ctx, projectId, "question.edited", (cs) => {
    const cur = db.prepare("SELECT * FROM question_revisions WHERE question_id = ? AND revision = ?").get(questionId, q.current_revision) as any;
    const prior = { ...q, text: cur.text, purpose: cur.purpose };
    if ((patch.text !== undefined && patch.text !== cur.text) || (patch.purpose !== undefined && patch.purpose !== cur.purpose)) {
      const rev = q.current_revision + 1;
      db.prepare("INSERT INTO question_revisions (question_id, revision, text, purpose, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        questionId,
        rev,
        patch.text ?? cur.text,
        patch.purpose ?? cur.purpose,
        actor,
        now(),
      );
      db.prepare("UPDATE questions SET current_revision = ? WHERE id = ?").run(rev, questionId);
    }
    if (patch.priority !== undefined) db.prepare("UPDATE questions SET priority = ? WHERE id = ?").run(patch.priority, questionId);
    if (patch.claimIds !== undefined) db.prepare("UPDATE questions SET claim_ids = ? WHERE id = ?").run(j(patch.claimIds), questionId);
    if (patch.status !== undefined) db.prepare("UPDATE questions SET status = ? WHERE id = ?").run(patch.status, questionId);
    const rid = uid("rev");
    db.prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, 'question', ?, 'edit', ?, '', ?, ?)").run(
      rid,
      projectId,
      questionId,
      actor,
      j(prior),
      now(),
    );
    cs.touch("reviews", rid).touch("questions", questionId);
    bumpLiveInterviewRevision(ctx, cs, projectId);
  });
}

export function addQuestion(
  ctx: Ctx,
  projectId: string,
  input: { text: string; purpose: string; priority: number; claimIds: string[]; interviewId: string | null },
  origin: "consultant" | "copilot",
): string {
  const db = ctx.db;
  requireProject(ctx, projectId);
  for (const c of input.claimIds) if (!db.prepare("SELECT 1 FROM claims WHERE id = ? AND project_id = ?").get(c, projectId)) throw new DomainError(400, `Unknown claim ${c}.`, "invalid_reference");
  if (input.interviewId && !db.prepare("SELECT 1 FROM interviews WHERE id = ? AND project_id = ?").get(input.interviewId, projectId)) throw new DomainError(400, "Unknown interview.", "invalid_reference");
  return commit(ctx, projectId, "question.added", (cs) => {
    const id = insertQuestion(ctx, cs, projectId, { ...input, origin, isOriginal: false, fixtureKey: null, createdBy: origin });
    bumpLiveInterviewRevision(ctx, cs, projectId);
    return id;
  }).result;
}

export function setRankingSelected(ctx: Ctx, projectId: string, rankingId: string, selected: boolean) {
  const r = ctx.db
    .prepare("SELECT r.id FROM expert_rankings r JOIN research_plans p ON p.id = r.plan_id WHERE r.id = ? AND p.project_id = ?")
    .get(rankingId, projectId);
  if (!r) throw new DomainError(404, "Ranking not found.", "not_found");
  commit(ctx, projectId, "plan.expert_selection", (cs) => {
    ctx.db.prepare("UPDATE expert_rankings SET selected = ? WHERE id = ?").run(selected ? 1 : 0, rankingId);
    cs.touch("rankings", rankingId);
  });
}

function currentQuestionSnapshot(ctx: Ctx, projectId: string) {
  return (ctx.db.prepare("SELECT id, current_revision, priority FROM questions WHERE project_id = ? AND status = 'active' ORDER BY code").all(projectId) as any[]).map((q) => ({
    questionId: q.id,
    revision: q.current_revision,
    priority: q.priority,
  }));
}

export function planHasUnapprovedChanges(ctx: Ctx, projectId: string): boolean {
  const p = ctx.db.prepare("SELECT * FROM research_plans WHERE id = (SELECT current_plan_id FROM projects WHERE id = ?)").get(projectId) as any;
  if (!p) return false;
  if (p.status !== "approved") return true;
  return JSON.stringify(pj(p.snapshot, [])) !== JSON.stringify(currentQuestionSnapshot(ctx, projectId));
}

export function approvePlan(ctx: Ctx, projectId: string, actor: string, rationale = ""): string {
  const db = ctx.db;
  const project = requireProject(ctx, projectId);
  if (!project.current_plan_id) throw new DomainError(400, "Generate a research plan before approval.", "no_plan");
  const snapshot = currentQuestionSnapshot(ctx, projectId);
  if (snapshot.length === 0) throw new DomainError(400, "The plan has no active questions.", "empty_plan");
  return commit(ctx, projectId, "plan.approved", (cs) => {
    const cur = db.prepare("SELECT * FROM research_plans WHERE id = ?").get(project.current_plan_id) as any;
    let planId = cur.id;
    const ts = now();
    if (cur.status === "approved") {
      // Approving changes to an approved plan records a new plan version; the old one stays as history.
      planId = uid("pln");
      const version = ((db.prepare("SELECT MAX(version) AS v FROM research_plans WHERE project_id = ?").get(projectId) as any).v ?? 0) + 1;
      db.prepare(
        "INSERT INTO research_plans (id, project_id, version, status, produced_by, gaps, thesis_version, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)",
      ).run(planId, projectId, version, `revision of v${cur.version}`, cur.gaps, cur.thesis_version, ts);
      for (const r of db.prepare("SELECT * FROM expert_rankings WHERE plan_id = ?").all(cur.id) as any[]) {
        const nid = uid("rnk");
        db.prepare(
          "INSERT INTO expert_rankings (id, plan_id, expert_id, rank, score, rationale, background_quote, claim_ids, recommended, selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(nid, planId, r.expert_id, r.rank, r.score, r.rationale, r.background_quote, r.claim_ids, r.recommended, r.selected);
        cs.touch("rankings", nid);
      }
    }
    for (const old of db.prepare("SELECT id FROM research_plans WHERE project_id = ? AND status = 'approved' AND id != ?").all(projectId, planId) as any[]) {
      db.prepare("UPDATE research_plans SET status = 'superseded' WHERE id = ?").run(old.id);
      cs.touch("plans", old.id);
    }
    db.prepare("UPDATE research_plans SET status = 'approved', approved_by = ?, approved_at = ?, snapshot = ? WHERE id = ?").run(actor, ts, j(snapshot), planId);
    db.prepare("UPDATE projects SET current_plan_id = ? WHERE id = ?").run(planId, projectId);
    const rid = uid("rev");
    db.prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, 'plan', ?, 'approve', ?, ?, NULL, ?)").run(
      rid,
      projectId,
      planId,
      actor,
      rationale,
      ts,
    );
    cs.touch("plans", planId).touch("reviews", rid);
    return planId;
  }).result;
}

export function editClaim(ctx: Ctx, projectId: string, claimId: string, patch: { assertion?: string; priority?: number; scopeDefinition?: string; metricDefinition?: string }) {
  const c = ctx.db.prepare("SELECT * FROM claims WHERE id = ? AND project_id = ?").get(claimId, projectId) as any;
  if (!c) throw new DomainError(404, "Claim not found.", "not_found");
  commit(ctx, projectId, "claim.edited", (cs) => {
    const map: [string, unknown][] = [
      ["assertion", patch.assertion],
      ["priority", patch.priority],
      ["scope_definition", patch.scopeDefinition],
      ["metric_definition", patch.metricDefinition],
    ];
    for (const [k, v] of map) if (v !== undefined) ctx.db.prepare(`UPDATE claims SET ${k} = ?, updated_at = ? WHERE id = ?`).run(v, now(), claimId);
    const rid = uid("rev");
    ctx.db.prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, 'claim', ?, 'edit', 'consultant', '', ?, ?)").run(
      rid,
      projectId,
      claimId,
      j(c),
      now(),
    );
    cs.touch("claims", claimId).touch("reviews", rid);
    bumpLiveInterviewRevision(ctx, cs, projectId);
  });
}
