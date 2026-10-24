// Deterministic executive synthesis derived from canonical records (used by the UI and the report).
import { ASSESSMENT_LABELS, type ClaimRecord, type EvidenceRecord, type Snapshot } from "./contracts";

export interface ClaimSynthesis {
  claim: ClaimRecord;
  supporting: EvidenceRecord[];
  challenging: EvidenceRecord[];
  unresolved: EvidenceRecord[];
  inactive: EvidenceRecord[];
  sentence: string;
}

export interface Synthesis {
  headline: string[];
  claims: ClaimSynthesis[];
  limits: string[];
  unresolved: string[];
  operational: string;
}

export function codeSort<T extends { code: string }>(a: T, b: T) {
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

export function buildSynthesis(s: Snapshot): Synthesis {
  const claims = Object.values(s.claims).filter((c) => c.status === "active").sort(codeSort);
  const evidence = Object.values(s.evidence);
  const interviews = Object.values(s.interviews);
  const expertName = (id: string) => s.experts[id]?.name ?? "unknown expert";
  const out: ClaimSynthesis[] = claims.map((claim) => {
    const linked = evidence.filter((e) => e.links.some((l) => l.claimId === claim.id));
    const active = linked.filter((e) => e.status === "active");
    const rel = (e: EvidenceRecord) => e.links.find((l) => l.claimId === claim.id)!;
    const supporting = active.filter((e) => rel(e).relation === "supports");
    const challenging = active.filter((e) => rel(e).relation === "challenges");
    const unresolved = active.filter((e) => rel(e).relation === "unresolved");
    const sources = [...new Set(active.map((e) => expertName(e.expertId)))];
    const sentence = active.length
      ? `${claim.code} — ${ASSESSMENT_LABELS[claim.assessment]}: ${challenging.length} challenging, ${supporting.length} supporting, ${unresolved.length} unresolved observation(s) from ${sources.join(", ")}.`
      : `${claim.code} — ${ASSESSMENT_LABELS[claim.assessment]}: no interview evidence yet.`;
    return { claim, supporting, challenging, unresolved, inactive: linked.filter((e) => e.status !== "active"), sentence };
  });
  const findings = Object.values(s.findings);
  const headline = [
    ...findings.filter((f) => f.status !== "flagged").map((f) => `${f.text}${f.status === "accepted" ? " (accepted by consultant)" : " (proposed; not yet reviewed)"}`),
    ...out.filter((c) => c.claim.assessment !== "unassessed").map((c) => c.sentence),
  ];
  const ended = interviews.filter((i) => i.lifecycle === "ended");
  const estimates = evidence.filter((e) => e.status === "active" && e.basis === "estimate").length;
  const notComparable = evidence.filter((e) => e.status === "active" && e.links.some((l) => l.comparability !== "comparable")).length;
  const limits = [
    `Based on ${ended.length} completed interview(s); testimony is attributable evidence, not independently verified fact.`,
    "Agreement between interviews is not statistical validation, and co-occurrence is not established causation.",
    `${estimates} observation(s) are respondent estimates; ${notComparable} are not comparable or unclear against the claim's metric.`,
  ];
  if (s.project.isSynthetic) limits.unshift("SYNTHETIC DEMONSTRATION: fictional company, contacts, and interviews.");
  const flagged = findings.filter((f) => f.status === "flagged");
  for (const f of flagged) limits.push(`Consultant flagged an interpretation: “${f.text}” — ${f.reviewNote ?? ""}`);
  const unresolved: string[] = [];
  for (const c of out) for (const g of c.claim.gaps) unresolved.push(`${c.claim.code}: ${g.description}`);
  for (const c of out) if (c.claim.assessment === "inconclusive" || c.claim.assessment === "unassessed") unresolved.push(`${c.claim.code} remains ${ASSESSMENT_LABELS[c.claim.assessment].toLowerCase()}.`);
  for (const cov of Object.values(s.coverage).filter((c) => c.coverage === "unable_to_answer")) {
    const q = s.questions[cov.questionId];
    const iv = s.interviews[cov.interviewId];
    if (q && iv) unresolved.push(`${q.code} could not be answered by ${expertName(iv.expertId)}; the research gap remains open.`);
  }
  for (const f of flagged) if (f.nextEvidenceNeeded) unresolved.push(`Next evidence needed: ${f.nextEvidenceNeeded}`);
  const planGaps = s.project.currentPlanId ? s.plans[s.project.currentPlanId]?.gaps ?? [] : [];
  for (const g of planGaps) unresolved.push(`Plan gap: ${g.description}`);
  const operational = `${ended.length} interview(s) completed, ${interviews.filter((i) => i.lifecycle !== "ended" && i.lifecycle !== "ready").length} in progress or interrupted. Operational progress is reported separately from evidence strength.`;
  return { headline, claims: out, limits, unresolved: [...new Set(unresolved)], operational };
}
