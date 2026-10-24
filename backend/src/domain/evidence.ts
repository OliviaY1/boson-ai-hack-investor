// Claim assessment from attributed evidence, and consultant review actions.
import type { Assessment } from "../../../shared/contracts";
import { j, now, pj, uid } from "../db/db";
import { commit, DomainError, type ChangeSet, type Ctx } from "./events";

/**
 * Aggregate assessment. Only active, non-disputed links on a comparable basis can make a claim
 * supported or contradicted; incomparable or unclear evidence leaves it inconclusive. Supporting and
 * challenging observations are both kept; together they yield mixed evidence.
 */
export function assessClaim(links: { relation: string; comparability: string; disputed: boolean; interviewId: string }[]): {
  assessment: Assessment;
  rationale: string;
} {
  if (links.length === 0) return { assessment: "unassessed", rationale: "No interview evidence yet." };
  const comparable = links.filter((l) => l.comparability === "comparable" && !l.disputed && l.relation !== "unresolved");
  const s = comparable.filter((l) => l.relation === "supports");
  const c = comparable.filter((l) => l.relation === "challenges");
  const other = links.length - comparable.length;
  const interviews = new Set(links.map((l) => l.interviewId)).size;
  const parts = [
    `${s.length} comparable supporting`,
    `${c.length} comparable challenging`,
    `${other} not comparable, unclear, unresolved, or disputed`,
  ];
  const rationale = `${parts.join("; ")} observation(s) from ${interviews} interview(s). Interview testimony is not independent verification.`;
  if (s.length && c.length) return { assessment: "mixed_evidence", rationale };
  if (s.length) return { assessment: "supported_by_interview", rationale };
  if (c.length) return { assessment: "contradicted_by_interview", rationale };
  return { assessment: "inconclusive", rationale };
}

export function recomputeClaims(ctx: Ctx, cs: ChangeSet, claimIds: string[]) {
  for (const cid of new Set(claimIds)) {
    const links = ctx.db
      .prepare(
        `SELECT l.relation, l.comparability, l.disputed, e.interview_id AS interviewId FROM evidence_claim_links l
         JOIN evidence e ON e.id = l.evidence_id WHERE l.claim_id = ? AND e.status = 'active'`,
      )
      .all(cid) as any[];
    const { assessment, rationale } = assessClaim(links.map((l) => ({ ...l, disputed: !!l.disputed })));
    ctx.db.prepare("UPDATE claims SET assessment = ?, assessment_rationale = ?, updated_at = ? WHERE id = ?").run(assessment, rationale, now(), cid);
    cs.touch("claims", cid);
  }
}

export function addClaimGap(ctx: Ctx, cs: ChangeSet, claimId: string, description: string, source: string) {
  const row = ctx.db.prepare("SELECT gaps FROM claims WHERE id = ?").get(claimId) as any;
  if (!row) return;
  const gaps = pj<{ description: string; source: string; createdAt: string }[]>(row.gaps, []);
  if (gaps.some((g) => g.description === description)) return;
  gaps.push({ description, source, createdAt: now() });
  ctx.db.prepare("UPDATE claims SET gaps = ?, updated_at = ? WHERE id = ?").run(j(gaps), now(), claimId);
  cs.touch("claims", claimId);
}

function review(ctx: Ctx, cs: ChangeSet, projectId: string, targetType: string, targetId: string, action: string, rationale: string, prior: unknown) {
  const id = uid("rev");
  ctx.db
    .prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, ?, ?, ?, 'consultant', ?, ?, ?)")
    .run(id, projectId, targetType, targetId, action, rationale, j(prior), now());
  cs.touch("reviews", id);
}

/** Accepting an extraction records an analyst judgment; it does not make an estimate a verified fact. */
export function reviewEvidence(ctx: Ctx, projectId: string, evidenceId: string, action: "accept" | "flag" | "note", note: string, claimId?: string) {
  const e = ctx.db.prepare("SELECT * FROM evidence WHERE id = ? AND project_id = ?").get(evidenceId, projectId) as any;
  if (!e) throw new DomainError(404, "Evidence not found.", "not_found");
  if (action !== "note" && e.status !== "active") throw new DomainError(409, `Evidence is ${e.status}; it cannot be reviewed.`, "invalid_transition");
  if (action === "note" && !note.trim()) throw new DomainError(400, "A note is required.", "invalid_input");
  commit(ctx, projectId, `evidence.review.${action}`, (cs) => {
    const claims: string[] = [];
    if (action === "accept") ctx.db.prepare("UPDATE evidence SET review_status = 'accepted' WHERE id = ?").run(evidenceId);
    if (action === "flag") {
      ctx.db.prepare("UPDATE evidence SET review_status = 'flagged' WHERE id = ?").run(evidenceId);
      // Flagging an interpretation disputes the claim link(s); the observation itself stays visible.
      const sql = claimId
        ? ctx.db.prepare("UPDATE evidence_claim_links SET disputed = 1 WHERE evidence_id = ? AND claim_id = ?").run(evidenceId, claimId)
        : ctx.db.prepare("UPDATE evidence_claim_links SET disputed = 1 WHERE evidence_id = ?").run(evidenceId);
      void sql;
      for (const l of ctx.db.prepare("SELECT claim_id FROM evidence_claim_links WHERE evidence_id = ?").all(evidenceId) as any[]) claims.push(l.claim_id);
    }
    review(ctx, cs, projectId, "evidence", evidenceId, action, note, { reviewStatus: e.review_status });
    recomputeClaims(ctx, cs, claims);
    cs.touch("evidence", evidenceId);
  });
}

export function reviewFinding(ctx: Ctx, projectId: string, findingId: string, action: "accept" | "flag" | "note", note: string, nextEvidence: string | null) {
  const f = ctx.db.prepare("SELECT * FROM findings WHERE id = ? AND project_id = ?").get(findingId, projectId) as any;
  if (!f) throw new DomainError(404, "Finding not found.", "not_found");
  if (action === "flag" && !note.trim()) throw new DomainError(400, "Explain why the interpretation is flagged.", "invalid_input");
  commit(ctx, projectId, `finding.review.${action}`, (cs) => {
    if (action === "accept") ctx.db.prepare("UPDATE findings SET status = 'accepted', review_note = COALESCE(NULLIF(?, ''), review_note) WHERE id = ?").run(note, findingId);
    if (action === "flag") ctx.db.prepare("UPDATE findings SET status = 'flagged', review_note = ?, next_evidence_needed = COALESCE(?, next_evidence_needed) WHERE id = ?").run(note, nextEvidence, findingId);
    if (action === "note") ctx.db.prepare("UPDATE findings SET review_note = ?, next_evidence_needed = COALESCE(?, next_evidence_needed) WHERE id = ?").run(note, nextEvidence, findingId);
    review(ctx, cs, projectId, "finding", findingId, action, [note, nextEvidence ? `Next evidence needed: ${nextEvidence}` : ""].filter(Boolean).join(" "), {
      status: f.status,
      reviewNote: f.review_note,
    });
    cs.touch("findings", findingId);
  });
}
