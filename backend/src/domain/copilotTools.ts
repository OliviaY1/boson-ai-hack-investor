// Scoped backend tools for the consultant copilot (text and voice share this registry).
// The project scope comes from backend authorization; model-supplied IDs are checked against it.
import { z } from "zod";
import { ASSESSMENT_LABELS, type NavigationTarget } from "../../../shared/contracts";
import { pj } from "../db/db";
import type { CopilotToolResult, CopilotToolSpec } from "../providers/types";
import type { Ctx } from "./events";
import { DomainError } from "./events";
import { addDirective, currentHandoff, markReviewed, rememberInstruction, retireMemory } from "./memory";
import { addQuestion, editQuestion } from "./planning";

const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const nstr = (description: string) => ({ type: ["string", "null"], description });

export const COPILOT_TOOLS: CopilotToolSpec[] = [
  { name: "get_project_status", description: "Current operational status, coverage, active interview, and claim assessments. Use for status questions.", parameters: obj({}) },
  { name: "get_handoff", description: "The saved session handoff: where the project stands, unresolved items, next steps, with evidence references. Use for 'where were we?'.", parameters: obj({}) },
  { name: "get_changes_since_review", description: "What changed since the consultant last marked the project reviewed.", parameters: obj({}) },
  { name: "list_evidence_gaps", description: "Claims that still lack comparable interview evidence, plus recorded evidence gaps.", parameters: obj({}) },
  {
    name: "search_evidence",
    description: "Find attributed evidence observations by topic. Returns quotes with speaker, interview, turn, and evidence IDs, and navigates to the best match.",
    parameters: obj({ query: str("Topic words, e.g. 'retention', 'staffing at Kanata'.") }),
  },
  {
    name: "open_source",
    description: "Navigate the consultant's workspace to an evidence quote (transcript span), a thesis passage, or a claim.",
    parameters: obj({ evidence_id: nstr("Evidence ID, or null"), passage_id: nstr("Passage ID, or null"), claim_code: nstr("Claim code like C1, or null") }),
  },
  {
    name: "submit_research_directive",
    description:
      "Pass a private research instruction to the interview controller (e.g. 'ask the operator whether cancellations were concentrated in particular locations'). The controller turns it into a neutral question if appropriate. Not expert evidence.",
    parameters: obj({ instruction: str("The consultant's instruction."), claim_ids: { type: "array", items: { type: "string" }, description: "Related claim IDs (may be empty)." } }),
  },
  {
    name: "add_follow_up_question",
    description: "Add a consultant-authored question to the research plan queue.",
    parameters: obj({
      text: str("Neutral question wording."),
      purpose: str("Why it is asked."),
      claim_ids: { type: "array", items: { type: "string" } },
      priority: { type: "integer", description: "1 (highest) to 5." },
    }),
  },
  {
    name: "set_question_priority",
    description: "Change a question's priority (1 highest to 5 lowest).",
    parameters: obj({ question_code: str("Question code like Q3."), priority: { type: "integer" } }),
  },
  {
    name: "remember_instruction",
    description: "Save an explicit project instruction to durable memory, e.g. scope exclusions. Only when the consultant asks to remember something.",
    parameters: obj({ text: str("The instruction to remember.") }),
  },
  { name: "retire_memory", description: "Retire (forget) a saved memory item by ID.", parameters: obj({ memory_id: str("Memory ID.") }) },
  { name: "mark_reviewed", description: "Record that the consultant has reviewed the current project state.", parameters: obj({}) },
];

const SYNONYMS: Record<string, string[]> = {
  retention: ["retention", "churn", "attrition", "leave", "left", "leaving", "lost", "moved", "switch"],
  churn: ["churn", "retention", "attrition", "lost", "leaving"],
  staffing: ["staffing", "hygienist", "hygienists", "vacancy", "vacancies", "positions", "short"],
  cancellation: ["cancellation", "cancellations", "cancelled", "rebooked", "rebooking", "rescheduled"],
  cancellations: ["cancellation", "cancellations", "cancelled", "rebooked", "rescheduled"],
  capacity: ["capacity", "chair", "utilization", "appointments"],
  pricing: ["pricing", "fee", "fees", "reimbursement", "insurer"],
};

function terms(q: string): string[] {
  const base = (q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !["the", "for", "and", "concern", "issue", "show", "source", "about"].includes(w));
  return [...new Set(base.flatMap((w) => SYNONYMS[w] ?? [w]))];
}

export interface CopilotToolHooks {
  onResearchChange: (projectId: string) => void;
}

export function makeToolExecutor(ctx: Ctx, projectId: string, actor: "copilot", hooks: CopilotToolHooks) {
  const db = ctx.db;
  const claimByCode = (code: string) => db.prepare("SELECT * FROM claims WHERE project_id = ? AND code = ? AND status = 'active'").get(projectId, code.toUpperCase()) as any;
  const turnNav = (e: any): NavigationTarget => ({ kind: "turn", interviewId: e.interview_id, turnId: e.turn_id, version: e.turn_version, spanStart: e.span_start, spanEnd: e.span_end });
  const cite = (e: any) => `[${e.id}] ${e.expert_name} (${e.interview_mode === "fixture" ? "fixture interview" : "interview"} ${e.interview_id}, turn ${e.turn_seq} v${e.turn_version}): "${e.quote}"`;
  const evidenceRows = () =>
    db
      .prepare(
        `SELECT e.*, x.name AS expert_name, i.mode AS interview_mode, t.seq AS turn_seq FROM evidence e JOIN experts x ON x.id = e.expert_id
         JOIN interviews i ON i.id = e.interview_id JOIN transcript_turns t ON t.id = e.turn_id WHERE e.project_id = ? AND e.status = 'active'`,
      )
      .all(projectId) as any[];

  const handlers: Record<string, (args: any) => CopilotToolResult> = {
    get_project_status: () => {
      const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
      const plan = p.current_plan_id ? (db.prepare("SELECT * FROM research_plans WHERE id = ?").get(p.current_plan_id) as any) : null;
      const ivs = db.prepare("SELECT i.*, e.name FROM interviews i JOIN experts e ON e.id = i.expert_id WHERE i.project_id = ?").all(projectId) as any[];
      const claims = db.prepare("SELECT code, assertion, assessment FROM claims WHERE project_id = ? AND status = 'active' ORDER BY code").all(projectId) as any[];
      const live = ivs.find((i) => i.active_slot);
      const summary = [
        `Plan: ${plan ? `v${plan.version} (${plan.status})` : "not generated"}. Interviews: ${ivs.filter((i) => i.lifecycle === "ended").length} ended${live ? `, ${live.name} is ${live.lifecycle}` : ", none active"}.`,
        ...claims.map((c) => `${c.code}: ${ASSESSMENT_LABELS[c.assessment as keyof typeof ASSESSMENT_LABELS]} — ${c.assertion}`),
      ].join("\n");
      return { summary, detail: { plan: plan && { version: plan.version, status: plan.status }, liveInterview: live?.id ?? null, claims } };
    },
    get_handoff: () => {
      const h = currentHandoff(ctx, projectId);
      const parts = [`Where we were (handoff ${h.id}${h.rebuilt ? ", rebuilt from current state" : ""}):`, h.summary];
      if (h.unresolved.length) parts.push(`Unresolved: ${h.unresolved.join(" ")}`);
      if (h.nextSteps.length) parts.push(`Next steps: ${h.nextSteps.join(" ")}`);
      const cites = h.evidenceRefs
        .slice(0, 6)
        .map((id) => db.prepare("SELECT e.id, e.quote, e.turn_id, e.turn_version, e.span_start, e.span_end, e.interview_id, x.name, t.seq FROM evidence e JOIN experts x ON x.id = e.expert_id JOIN transcript_turns t ON t.id = e.turn_id WHERE e.id = ? AND e.project_id = ?").get(id, projectId) as any)
        .filter(Boolean);
      if (cites.length) parts.push(`Citations:\n${cites.map((c) => `[${c.id}] ${c.name}, turn ${c.seq} v${c.turn_version}: "${String(c.quote).slice(0, 160)}"`).join("\n")}`);
      const first = cites[0];
      return {
        summary: parts.join("\n"),
        detail: h,
        navigation: first ? { kind: "turn", interviewId: first.interview_id, turnId: first.turn_id, version: first.turn_version, spanStart: first.span_start, spanEnd: first.span_end } : undefined,
      };
    },
    get_changes_since_review: () => {
      const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
      const evs = db.prepare("SELECT type, COUNT(*) AS n FROM state_events WHERE project_id = ? AND revision > ? GROUP BY type ORDER BY MIN(revision)").all(projectId, p.last_reviewed_revision) as any[];
      if (!evs.length) return { summary: "Nothing has changed since your last review." };
      const newEvidence = db
        .prepare("SELECT COUNT(*) AS n FROM evidence WHERE project_id = ? AND created_at > COALESCE((SELECT created_at FROM state_events WHERE project_id = ? AND revision = ?), '')")
        .get(projectId, projectId, p.last_reviewed_revision) as any;
      return {
        summary: `Since your last review (revision ${p.last_reviewed_revision} → ${p.state_revision}): ${evs.map((e) => `${e.n}× ${e.type}`).join(", ")}. ${newEvidence.n} new evidence observation(s). Say "mark reviewed" when you're caught up.`,
        detail: evs,
      };
    },
    list_evidence_gaps: () => {
      const claims = db.prepare("SELECT * FROM claims WHERE project_id = ? AND status = 'active' ORDER BY code").all(projectId) as any[];
      const open = claims.filter((c) => ["unassessed", "inconclusive"].includes(c.assessment) || pj<any[]>(c.gaps, []).length);
      if (!open.length) return { summary: "Every active claim has comparable interview evidence; no gaps are recorded." };
      return {
        summary: open
          .map((c) => {
            const gaps = pj<{ description: string }[]>(c.gaps, []).map((g) => g.description);
            return `${c.code} (${ASSESSMENT_LABELS[c.assessment as keyof typeof ASSESSMENT_LABELS]}): ${c.assertion}${gaps.length ? ` Gap: ${gaps.join(" ")}` : ""}`;
          })
          .join("\n"),
        navigation: { kind: "claim", claimId: open[0].id },
      };
    },
    search_evidence: (a) => {
      const ts = terms(String(a.query ?? ""));
      const rows = evidenceRows();
      const claims = db.prepare("SELECT id, assertion FROM claims WHERE project_id = ?").all(projectId) as any[];
      const links = db.prepare("SELECT evidence_id, claim_id FROM evidence_claim_links").all() as any[];
      const scored = rows
        .map((e) => {
          const claimText = links.filter((l) => l.evidence_id === e.id).map((l) => claims.find((c) => c.id === l.claim_id)?.assertion ?? "").join(" ");
          const hay = `${e.statement} ${e.quote} ${e.metric ?? ""} ${claimText}`.toLowerCase();
          return { e, score: ts.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      if (!scored.length) return { summary: `No attributed evidence matches "${a.query}".` };
      const top = scored.slice(0, 3);
      return {
        summary: `${scored.length} matching observation(s). Top ${top.length}:\n${top.map((x) => cite(x.e)).join("\n")}\nOpening the first source.`,
        detail: top.map((x) => ({ id: x.e.id, statement: x.e.statement, quote: x.e.quote })),
        navigation: turnNav(top[0].e),
      };
    },
    open_source: (a) => {
      if (a.evidence_id) {
        const e = evidenceRows().find((r) => r.id === a.evidence_id) ?? (db.prepare("SELECT e.*, '' AS expert_name, 0 AS turn_seq FROM evidence e WHERE e.id = ? AND e.project_id = ?").get(a.evidence_id, projectId) as any);
        if (!e) return { summary: "That evidence ID is not in this project.", error: "not_found" };
        return { summary: `Opening ${e.id}: "${e.quote}"`, navigation: turnNav(e) };
      }
      if (a.passage_id) {
        const p = db.prepare("SELECT * FROM passages WHERE id = ? AND project_id = ?").get(a.passage_id, projectId) as any;
        if (!p) return { summary: "That passage is not in this project.", error: "not_found" };
        return { summary: `Opening thesis passage ${p.ordinal}: "${p.text}"`, navigation: { kind: "passage", documentId: p.document_id, passageId: p.id } };
      }
      if (a.claim_code) {
        const c = claimByCode(a.claim_code);
        if (!c) return { summary: `No active claim ${a.claim_code}.`, error: "not_found" };
        return { summary: `Opening ${c.code}: ${c.assertion}`, navigation: { kind: "claim", claimId: c.id } };
      }
      return { summary: "Specify an evidence ID, passage ID, or claim code.", error: "invalid_arguments" };
    },
    submit_research_directive: (a) => {
      const claimIds = (a.claim_ids as string[]).filter((c) => db.prepare("SELECT 1 FROM claims WHERE id = ? AND project_id = ?").get(c, projectId));
      const { id, interviewId } = addDirective(ctx, projectId, String(a.instruction), claimIds, actor);
      hooks.onResearchChange(projectId);
      return {
        summary: interviewId
          ? `Directive ${id} passed privately to the interview controller. It will phrase any follow-up neutrally; nothing you said is shared with the expert.`
          : `Directive ${id} saved. No interview is active, so it will be considered when the next interview runs.`,
        navigation: { kind: "page", page: "live" },
      };
    },
    add_follow_up_question: (a) => {
      const claimIds = (a.claim_ids as string[]).filter((c) => db.prepare("SELECT 1 FROM claims WHERE id = ? AND project_id = ?").get(c, projectId));
      const live = db.prepare("SELECT id FROM interviews WHERE project_id = ? AND active_slot IS NOT NULL").get(projectId) as any;
      const id = addQuestion(ctx, projectId, { text: String(a.text), purpose: String(a.purpose ?? ""), priority: Math.min(5, Math.max(1, Number(a.priority) || 2)), claimIds, interviewId: live?.id ?? null }, "copilot");
      hooks.onResearchChange(projectId);
      const q = db.prepare("SELECT code FROM questions WHERE id = ?").get(id) as any;
      return { summary: `Added ${q.code} to the question queue.`, navigation: { kind: "page", page: live ? "live" : "plan" } };
    },
    set_question_priority: (a) => {
      const q = db.prepare("SELECT id, code FROM questions WHERE project_id = ? AND code = ? AND status = 'active'").get(projectId, String(a.question_code).toUpperCase()) as any;
      if (!q) return { summary: `No active question ${a.question_code}.`, error: "not_found" };
      const pr = Number(a.priority);
      if (!Number.isInteger(pr) || pr < 1 || pr > 5) return { summary: "Priority must be 1-5.", error: "invalid_arguments" };
      editQuestion(ctx, projectId, q.id, { priority: pr }, "copilot");
      hooks.onResearchChange(projectId);
      return { summary: `${q.code} priority set to ${pr}.` };
    },
    remember_instruction: (a) => {
      const id = rememberInstruction(ctx, projectId, String(a.text), "copilot");
      return { summary: `Saved to project memory (${id}): "${String(a.text).trim()}". You can correct or retire it in the memory panel.` };
    },
    retire_memory: (a) => {
      retireMemory(ctx, projectId, String(a.memory_id));
      return { summary: `Retired memory item ${a.memory_id}.` };
    },
    mark_reviewed: () => {
      markReviewed(ctx, projectId);
      return { summary: "Marked the current project state as reviewed." };
    },
  };

  const argSchemas: Record<string, z.ZodTypeAny> = {
    search_evidence: z.object({ query: z.string().min(1).max(200) }),
    open_source: z.object({ evidence_id: z.string().nullable(), passage_id: z.string().nullable(), claim_code: z.string().nullable() }),
    submit_research_directive: z.object({ instruction: z.string().min(3).max(1000), claim_ids: z.array(z.string()).max(10) }),
    add_follow_up_question: z.object({ text: z.string().min(5).max(500), purpose: z.string().max(400), claim_ids: z.array(z.string()).max(10), priority: z.number().int() }),
    set_question_priority: z.object({ question_code: z.string().max(10), priority: z.number().int() }),
    remember_instruction: z.object({ text: z.string().min(3).max(1000) }),
    retire_memory: z.object({ memory_id: z.string().max(60) }),
  };

  return async (name: string, args: unknown): Promise<CopilotToolResult> => {
    const h = handlers[name];
    if (!h) return { summary: `Unknown tool ${name}.`, error: "unknown_tool" };
    const schema = argSchemas[name] ?? z.object({}).passthrough();
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) return { summary: `Invalid arguments for ${name}.`, error: "invalid_arguments" };
    try {
      return h(parsed.data);
    } catch (e) {
      // Never throw back into the model loop: return the failure as a result.
      return { summary: e instanceof DomainError ? e.message : `The ${name} tool failed.`, error: "tool_failed" };
    }
  };
}
