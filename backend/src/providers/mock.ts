// Deterministic reasoning substitute. It returns proposals in exactly the shape the real provider
// returns; the backend validates and applies them through the same code path. Fixture utterances get
// scripted, source-referenced extractions; any other content gets clearly labelled heuristic output.
import type { ControllerProposal, PlannerProposal } from "../../../shared/contracts";
import {
  FOLLOWUPS,
  NORTHSTAR_CLAIMS,
  NORTHSTAR_EXPERTS,
  NORTHSTAR_GAPS,
  NORTHSTAR_MARKER,
  NORTHSTAR_QUESTIONS,
  NORTHSTAR_RANKINGS,
} from "./northstarFixture";
import type {
  ControllerEnvelope,
  CopilotToolSpec,
  CopilotTurnInput,
  CopilotTurnOutput,
  PlannerInput,
  ReasoningProvider,
  ToolExecutor,
} from "./types";

type Obs = ControllerProposal["observations"][number];

const STOP = new Set(
  "the and for with that this from have has are was were will can into over than then they them their there about which while would could should also been being more most such only other some what when where your yours ours ourselves across without within".split(
    " ",
  ),
);
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w));

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

function northstarPlan(input: PlannerInput): PlannerProposal | null {
  if (!input.passages.some((p) => p.text.includes(NORTHSTAR_MARKER))) return null;
  const claims: PlannerProposal["claims"] = [];
  for (const c of NORTHSTAR_CLAIMS) {
    const passage = input.passages.find((p) => p.text.includes(c.passageMatch));
    if (!passage) continue; // never invent a source passage
    claims.push({
      ref: c.ref,
      assertion: c.assertion,
      passage_ids: [passage.id],
      priority: c.priority,
      scope_definition: c.scope,
      metric_definition: c.metric,
      missing_definitions: c.missing,
      evidence_supporting: c.supporting,
      evidence_challenging: c.challenging,
    });
  }
  if (claims.length === 0) return null;
  const refs = new Set(claims.map((c) => c.ref));
  const rankings: PlannerProposal["expert_rankings"] = [];
  for (const r of NORTHSTAR_RANKINGS) {
    const fx = NORTHSTAR_EXPERTS.find((e) => e.key === r.expert)!;
    const expert = input.experts.find((e) => e.name === fx.name && e.background.includes(r.quote));
    if (!expert) continue;
    rankings.push({
      expert_id: expert.id,
      score: r.score,
      rationale: r.rationale,
      background_quote: r.quote,
      claim_refs: r.claims.filter((x) => refs.has(x)),
      recommended: r.recommended,
    });
  }
  const covered = new Set(rankings.map((r) => r.expert_id));
  rankings.push(...heuristicRankings(input, claims).filter((r) => !covered.has(r.expert_id)));
  return {
    claims,
    expert_rankings: rankings,
    questions: NORTHSTAR_QUESTIONS.map((q) => ({
      text: q.text,
      purpose: q.purpose,
      claim_refs: q.claims.filter((x) => refs.has(x)),
      priority: q.priority,
      fixture_key: q.key,
    })).filter((q) => q.claim_refs.length > 0),
    gaps: NORTHSTAR_GAPS.map((g) => ({ description: g.description, claim_refs: g.claims })),
  };
}

const ASSERTIVE = /\b(is|are|has|have|can|will|grow|grows|reduce|reduced|increase|increased|strong|stable|below|above|exceed|exceeds|leading|outperform|margin|churn|retention|revenue|growth|share)\b/i;

function heuristicRankings(input: PlannerInput, claims: PlannerProposal["claims"]): PlannerProposal["expert_rankings"] {
  const claimWords = claims.map((c) => ({ ref: c.ref, words: new Set(words(c.assertion)) }));
  const scored = input.experts.map((e) => {
    const sentences = e.background.split(/(?<=[.;])\s+/).filter((s) => s.trim().length >= 3);
    let best = { sentence: sentences[0] ?? e.background, overlap: [] as string[] };
    const claimRefs = new Set<string>();
    const terms = new Set<string>();
    for (const s of sentences) {
      const sw = new Set(words(s));
      const overlap = [...sw].filter((w) => claimWords.some((c) => c.words.has(w)));
      if (overlap.length > best.overlap.length) best = { sentence: s, overlap };
      for (const c of claimWords) {
        const hit = [...sw].filter((w) => c.words.has(w));
        if (hit.length) {
          claimRefs.add(c.ref);
          hit.forEach((h) => terms.add(h));
        }
      }
    }
    const score = Math.min(100, terms.size * 12 + claimRefs.size * 6);
    return {
      expert_id: e.id,
      score,
      rationale: terms.size
        ? `Deterministic keyword match (mock planner): documented background mentions ${[...terms].slice(0, 6).map((t) => `"${t}"`).join(", ")}.`
        : "Deterministic keyword match (mock planner): no documented background terms overlap the claims.",
      background_quote: best.sentence.trim().slice(0, 400),
      claim_refs: [...claimRefs],
      recommended: false,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.recommended = i < 3 && s.score > 0));
  return scored;
}

function heuristicPlan(input: PlannerInput): PlannerProposal {
  const candidates = input.passages.filter((p) => p.text.split(/\s+/).length >= 6 && (ASSERTIVE.test(p.text) || /\d/.test(p.text)));
  const chosen = (candidates.length ? candidates : input.passages.filter((p) => p.text.split(/\s+/).length >= 4)).slice(0, 8);
  const claims: PlannerProposal["claims"] = chosen.map((p, i) => {
    const numeric = /\d/.test(p.text);
    return {
      ref: `C${i + 1}`,
      assertion: p.text.slice(0, 600),
      passage_ids: [p.id],
      priority: numeric ? 1 : 2,
      scope_definition: "To be defined by the consultant (deterministic mock planner).",
      metric_definition: numeric ? "Figure stated in source; definition, period, and basis to be confirmed." : "",
      missing_definitions: numeric ? ["Measurement period", "Population or cohort", "Calculation basis"] : ["Definition of key terms", "Time period"],
      evidence_supporting: "First-hand accounts or records consistent with the statement on a comparable basis.",
      evidence_challenging: "First-hand accounts or records inconsistent with the statement on a comparable basis.",
    };
  });
  const rankings = heuristicRankings(input, claims);
  const questions: PlannerProposal["questions"] = claims.map((c) => ({
    text: `What have you observed that bears on the following statement, and how do you know: "${c.assertion.slice(0, 300)}"?`,
    purpose: `Collect attributable evidence for or against ${c.ref} (deterministic mock wording; review before approval).`,
    claim_refs: [c.ref],
    priority: c.priority,
    fixture_key: null,
  }));
  const coveredRefs = new Set(rankings.filter((r) => r.score > 0).flatMap((r) => r.claim_refs));
  const gaps = claims
    .filter((c) => !coveredRefs.has(c.ref))
    .map((c) => ({ description: `No available expert's documented background addresses ${c.ref}.`, claim_refs: [c.ref] }));
  if (input.experts.length === 0) gaps.unshift({ description: "The expert pool is empty; add or import contacts to rank experts.", claim_refs: [] });
  return { claims, expert_rankings: rankings, questions, gaps };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

interface ScriptedExtraction {
  observations: (Omit<Obs, "turn_id" | "claim_links" | "supersedes_evidence_ids" | "retracts_evidence_ids"> & {
    links: { claim: string; relation: Obs["claim_links"][number]["relation"]; comparability: Obs["claim_links"][number]["comparability"]; note: string }[];
  })[];
  coverage: { key: string; coverage: ControllerProposal["coverage_updates"][number]["coverage"]; rationale: string }[];
  gaps?: { claim: string; description: string }[];
  findings?: { kind: ControllerProposal["findings"][number]["kind"]; text: string; claims: string[]; obsRefs: string[]; evidenceFrom?: string[] }[];
  followUp?: keyof typeof FOLLOWUPS;
}

const nul = { period: null, population: null, metric: null, unit: null, calc_basis: null, value: null };

const SCRIPTED: Record<string, ScriptedExtraction> = {
  "customer:1": {
    observations: [
      {
        ref: "o1",
        quote: "three of my hygiene appointments were cancelled by the clinic, usually a day or two before",
        statement: "Patient reports three clinic-initiated hygiene cancellations at the Kanata clinic in their final year as a patient.",
        basis: "direct_observation",
        ...nul,
        period: "2024 to early 2025",
        population: "One patient household, Kanata clinic",
        metric: "Clinic-initiated cancellations",
        unit: "appointments",
        value: "3",
        links: [{ claim: "C3", relation: "challenges", comparability: "unclear", note: "Single-patient experience; not a network cancellation rate." }],
      },
    ],
    coverage: [{ key: "q_cancellations", coverage: "answered", rationale: "Describes frequency and initiator of cancellations." }],
  },
  "customer:2": {
    observations: [
      {
        ref: "o1",
        quote: "After the third cancellation I moved my family of four to an independent practice near my office.",
        statement: "Patient moved a family of four to another provider after repeated cancellations.",
        basis: "direct_observation",
        ...nul,
        period: "early 2025",
        population: "One household (4 patients), Kanata clinic",
        metric: "Patients leaving",
        unit: "patients",
        value: "4",
        links: [{ claim: "C1", relation: "challenges", comparability: "not_comparable", note: "Individual departure; not comparable with an annual company-wide churn rate." }],
      },
      {
        ref: "o2",
        quote: "The rebooking dates were six to eight weeks out.",
        statement: "Rebooking lead time after cancellation was six to eight weeks.",
        basis: "direct_observation",
        ...nul,
        population: "One patient, Kanata clinic",
        metric: "Rebooking lead time",
        unit: "weeks",
        value: "6-8",
        links: [{ claim: "C2", relation: "challenges", comparability: "unclear", note: "Long lead times can indicate constrained capacity at one clinic." }],
      },
    ],
    coverage: [{ key: "q_patient_decision", coverage: "answered", rationale: "Explains the decision to change providers." }],
  },
  "customer:3": {
    observations: [
      {
        ref: "o1",
        quote: "The front desk said they were short on hygienists.",
        statement: "Patient was told by front-desk staff that the clinic was short on hygienists (second-hand).",
        basis: "secondhand_report",
        ...nul,
        population: "Kanata clinic",
        links: [{ claim: "C5", relation: "challenges", comparability: "unclear", note: "Second-hand report; not a turnover measure." }],
      },
    ],
    coverage: [{ key: "q_staffing", coverage: "partially_answered", rationale: "Second-hand account only." }],
  },
  "operator:1": {
    observations: [
      {
        ref: "o1",
        quote: "From mid-2024 we were running about four hygienist positions short across my eleven clinics, and two clinics, Kanata and Orléans, lost their senior hygienists.",
        statement: "Operator reports about four unfilled hygienist positions across 11 Eastern Ontario clinics from mid-2024, including loss of senior hygienists at Kanata and Orléans.",
        basis: "direct_observation",
        ...nul,
        period: "mid-2024 onward",
        population: "11 Eastern Ontario clinics",
        metric: "Unfilled hygienist positions",
        unit: "positions",
        value: "4",
        links: [
          {
            claim: "C5",
            relation: "challenges",
            comparability: "unclear",
            note: "Persistent vacancies in one region (11 of 42 clinics) challenge 'staffing is stable' there, but this is a vacancy count, not a turnover rate against the Ontario average, and does not cover the network.",
          },
        ],
      },
      {
        ref: "o2",
        quote: "At those two sites we were at maybe seventy percent of normal hygiene capacity for a couple of quarters.",
        statement: "Operator estimates hygiene capacity at Kanata and Orléans fell to about 70% of normal for about two quarters.",
        basis: "estimate",
        ...nul,
        period: "about two quarters from mid-2024",
        population: "Kanata and Orléans clinics",
        metric: "Hygiene capacity vs normal",
        unit: "percent",
        value: "70",
        calc_basis: "Operator recollection",
        links: [{ claim: "C2", relation: "challenges", comparability: "unclear", note: "Two-site estimate; network-wide capacity not established." }],
      },
    ],
    coverage: [
      { key: "q_staffing", coverage: "answered", rationale: "Describes vacancies and their duration." },
      { key: "q_capacity", coverage: "answered", rationale: "Answered indirectly: capacity at two sites fell to ~70%." },
    ],
    gaps: [
      {
        claim: "C3",
        description:
          "Evidence gap: no evidence yet connects the staffing shortfall with appointment disruption (locations, periods, and records have not been matched to the customer's reported cancellations).",
      },
    ],
  },
  "operator:1b": {
    observations: [],
    coverage: [{ key: "q_capacity", coverage: "partially_answered", rationale: "General statement without figures." }],
  },
  "operator:2": {
    observations: [
      {
        ref: "o1",
        quote: "It was mostly Kanata and Orléans, from about July 2024 through March 2025.",
        statement: "Disruption was concentrated at Kanata and Orléans from about July 2024 to March 2025.",
        basis: "direct_observation",
        ...nul,
        period: "Jul 2024 - Mar 2025",
        population: "Kanata and Orléans clinics",
        links: [{ claim: "C3", relation: "challenges", comparability: "unclear", note: "Two-site concentration; network trend not established." }],
      },
      {
        ref: "o2",
        quote: "at those two sites they roughly doubled over that period",
        statement: "Clinic-initiated cancellations roughly doubled at Kanata and Orléans (operator's reading of scheduling reports).",
        basis: "estimate",
        ...nul,
        period: "Jul 2024 - Mar 2025",
        population: "Kanata and Orléans clinics",
        metric: "Clinic-initiated cancellations",
        unit: "relative change",
        value: "~2x",
        calc_basis: "Scheduling-system reports as recalled by operator",
        links: [{ claim: "C3", relation: "challenges", comparability: "unclear", note: "Clinic-initiated only, two sites; not a network rate." }],
      },
      {
        ref: "o3",
        quote: "I haven't seen an analysis tying each cancellation to a vacancy.",
        statement: "No analysis linking individual cancellations to specific vacancies is known to the operator.",
        basis: "direct_observation",
        ...nul,
        links: [{ claim: "C3", relation: "unresolved", comparability: "unclear", note: "The staffing-cancellation link is not evidenced by records." }],
      },
    ],
    coverage: [{ key: "f_locations", coverage: "answered", rationale: "Locations, period, and available records were described." }],
    findings: [
      {
        kind: "possible_constraint",
        text: "Possible operational constraint: hygienist vacancies at Kanata and Orléans coincided with reduced hygiene capacity and more clinic-initiated cancellations (Jul 2024 - Mar 2025). The link is reported, not yet established by records.",
        claims: ["C3", "C5", "C2"],
        obsRefs: ["o1", "o2", "o3"],
        evidenceFrom: ["operator:1", "customer:1", "customer:3"],
      },
    ],
    followUp: "f_disruption_types",
  },
  "operator:3": {
    observations: [
      {
        ref: "o1",
        quote: "Most clinic-initiated cancellations were rebooked, maybe two-thirds.",
        statement: "Operator estimates about two-thirds of clinic-initiated cancellations were rebooked.",
        basis: "estimate",
        ...nul,
        population: "Kanata and Orléans clinics",
        metric: "Share of cancellations rebooked",
        unit: "fraction",
        value: "~2/3",
        links: [{ claim: "C3", relation: "unresolved", comparability: "unclear", note: "Distinguishes rescheduling from loss." }],
      },
      {
        ref: "o2",
        quote: "at Kanata I'd estimate we lost around twelve percent of active hygiene patients over those three quarters",
        statement: "Operator estimates ~12% of active hygiene patients at Kanata were lost over three quarters (from recall lists, unaudited).",
        basis: "estimate",
        ...nul,
        period: "Jul 2024 - Mar 2025 (three quarters)",
        population: "Active hygiene patients, Kanata clinic only",
        metric: "Patients lost",
        unit: "percent",
        value: "12",
        calc_basis: "Recall lists, operator estimate, not audited",
        links: [
          {
            claim: "C1",
            relation: "challenges",
            comparability: "not_comparable",
            note: "Single clinic, hygiene patients, three quarters vs company-wide annual churn: not comparable until definitions are aligned.",
          },
        ],
      },
    ],
    coverage: [{ key: "f_disruption_types", coverage: "partially_answered", rationale: "Rebooking and patient loss estimated; outright cancellations versus reduced capacity not separated." }],
    findings: [
      {
        kind: "possible_consequence",
        text: "Hygienist shortages caused the cancellations that drove patients to leave Kanata.",
        claims: ["C1", "C3"],
        obsRefs: ["o2"],
        evidenceFrom: ["customer:2", "operator:2"],
      },
    ],
  },
  "operator:4": {
    observations: [],
    coverage: [{ key: "q_retention", coverage: "unable_to_answer", rationale: "Operator does not have company-wide retention data." }],
  },
  "operator:5": {
    observations: [],
    coverage: [{ key: "q_cancellations", coverage: "unable_to_answer", rationale: "Operator saw only regional reports; cannot speak to network trend." }],
    // The network trend is unknown, so narrow to what the operator saw directly (skipped if a directive already added it).
    followUp: "f_locations",
  },
  "operator:6": {
    observations: [],
    coverage: [{ key: "q_pricing", coverage: "unable_to_answer", rationale: "Pricing set centrally; no insurer knowledge." }],
  },
};

const UNKNOWN_RE = /\b(i\s+don'?t\s+know|not\s+sure|no\s+idea|can'?t\s+(speak|say|confirm)|not\s+able\s+to|unable\s+to)\b/i;

function mockControl(env: ControllerEnvelope): ControllerProposal {
  const ctx = env.context;
  const claimByCode = new Map(ctx.claims.map((c) => [c.code, c.id]));
  const qByKey = new Map(ctx.questions.filter((q) => q.fixtureKey).map((q) => [q.fixtureKey!, q]));
  const out: ControllerProposal = {
    observations: [],
    coverage_updates: [],
    new_questions: [],
    priority_changes: [],
    evidence_gaps: [],
    findings: [],
    consumed_directive_ids: [],
    rationale: "",
    next_action: { type: "wait", question_ref: null, question_revision: null, delivery_directive: null },
  };
  const notes: string[] = [];
  const expertTurns = ctx.newTurns.filter((t) => t.speaker === "expert");
  let followUpKey: keyof typeof FOLLOWUPS | null = null;
  let refN = 0;
  for (const turn of expertTurns) {
    const script = turn.fixtureRef ? SCRIPTED[turn.fixtureRef] : undefined;
    if (script) {
      const localRefs = new Map<string, string>();
      for (const o of script.observations) {
        if (!turn.text.includes(o.quote)) continue; // corrected transcript no longer supports this quote
        const ref = `o${++refN}`;
        localRefs.set(o.ref, ref);
        out.observations.push({
          ref,
          turn_id: turn.id,
          quote: o.quote,
          statement: o.statement,
          basis: o.basis,
          period: o.period,
          population: o.population,
          metric: o.metric,
          unit: o.unit,
          calc_basis: o.calc_basis,
          value: o.value,
          claim_links: o.links
            .filter((l) => claimByCode.has(l.claim))
            .map((l) => ({ claim_id: claimByCode.get(l.claim)!, relation: l.relation, comparability: l.comparability, note: l.note })),
          supersedes_evidence_ids: [],
          retracts_evidence_ids: [],
        });
      }
      for (const c of script.coverage) {
        const q = qByKey.get(c.key);
        if (q && q.coverage !== "answered" && q.coverage !== "skipped") {
          out.coverage_updates.push({ question_id: q.id, coverage: c.coverage, rationale: c.rationale, answer_turn_ids: [turn.id] });
        }
      }
      for (const g of script.gaps ?? []) if (claimByCode.has(g.claim)) out.evidence_gaps.push({ claim_id: claimByCode.get(g.claim)!, description: g.description });
      for (const f of script.findings ?? []) {
        const refs = f.obsRefs.map((r) => localRefs.get(r)).filter((x): x is string => !!x);
        const existing = ctx.existingEvidence
          .filter((e) => e.status === "active" && e.fixtureRef !== null && (f.evidenceFrom ?? []).includes(e.fixtureRef))
          .map((e) => e.id);
        const evidence_refs = [...refs, ...existing].slice(0, 10);
        if (evidence_refs.length)
          out.findings.push({ kind: f.kind, text: f.text, claim_ids: f.claims.filter((c) => claimByCode.has(c)).map((c) => claimByCode.get(c)!), evidence_refs });
      }
      if (script.followUp) followUpKey = script.followUp;
      notes.push(`Scripted fixture extraction for ${turn.fixtureRef}.`);
    } else {
      // Heuristic handling of non-fixture content, labelled as such.
      const q = turn.contextQuestionId ? ctx.questions.find((x) => x.id === turn.contextQuestionId) : undefined;
      if (UNKNOWN_RE.test(turn.text)) {
        if (q && (q.coverage === "pending" || q.coverage === "partially_answered"))
          out.coverage_updates.push({ question_id: q.id, coverage: "unable_to_answer", rationale: "Deterministic mock: respondent indicated they cannot answer.", answer_turn_ids: [turn.id] });
        notes.push("Mock: unknown-answer phrase detected; no evidence extracted.");
      } else if (turn.text.trim().length > 0) {
        const quote = turn.text.trim().slice(0, 1200);
        out.observations.push({
          ref: `o${++refN}`,
          turn_id: turn.id,
          quote,
          statement: `[Unclassified mock extraction; review required] ${quote.slice(0, 200)}`,
          basis: "opinion",
          ...nul,
          claim_links: (q?.claimIds ?? []).slice(0, 6).map((cid) => ({ claim_id: cid, relation: "unresolved" as const, comparability: "unclear" as const, note: "Deterministic mock: relation not assessed." })),
          supersedes_evidence_ids: [],
          retracts_evidence_ids: [],
        });
        if (q && q.coverage === "pending")
          out.coverage_updates.push({ question_id: q.id, coverage: "partially_answered", rationale: "Deterministic mock: treated as a partial answer pending review.", answer_turn_ids: [turn.id] });
        notes.push("Mock: non-fixture utterance stored as an unclassified observation.");
      }
    }
  }

  // Consultant directives become neutral follow-ups.
  const operatorFixture = ctx.questions.some((q) => q.fixtureKey === "q_staffing") && ctx.expert.name === "Dana Whitfield";
  for (const d of ctx.directives) {
    out.consumed_directive_ids.push(d.id);
    if (operatorFixture) {
      if (!qByKey.has("f_locations")) pushFollowUp(out, "f_locations", claimByCode);
    } else {
      out.new_questions.push({
        ref: `d${out.new_questions.length + 1}`,
        text: `The research team would like to understand the following better: ${d.instruction.replace(/^(please\s+)?(ask|find out|investigate)\s+(the\s+\w+\s+)?(whether|if|about)?\s*/i, "").slice(0, 380)}. What can you tell us, and how do you know?`,
        purpose: "Consultant directive converted by the deterministic mock; review the wording for neutrality.",
        claim_ids: d.claimIds.filter((c) => ctx.claims.some((x) => x.id === c)),
        priority: 1,
        fixture_key: null,
      });
    }
    notes.push("Consultant directive received and converted to a neutral follow-up.");
  }
  if (followUpKey && !qByKey.has(followUpKey) && out.new_questions.length < 3) pushFollowUp(out, followUpKey, claimByCode);

  if (env.mode === "extract_only" || ctx.lifecycle !== "active") {
    out.rationale = [...notes, "Extraction only; no next question."].join(" ");
    return out;
  }

  // Next action selection.
  const answeredNow = new Map(out.coverage_updates.map((c) => [c.question_id, c.coverage]));
  if (ctx.awaitingAnswerQuestionId && expertTurns.length === 0) {
    out.rationale = [...notes, "Waiting for the expert to answer the question just asked."].join(" ");
    return out;
  }
  if (out.new_questions.length) {
    const nq = out.new_questions[0];
    out.next_action = { type: "ask", question_ref: nq.ref, question_revision: null, delivery_directive: null };
    out.rationale = [...notes, "Asking the new follow-up first."].join(" ");
    return out;
  }
  const relevant = new Set(ctx.relevantClaimIds);
  const candidates = ctx.questions
    .filter((q) => {
      const cov = answeredNow.get(q.id) ?? q.coverage;
      if (cov !== "pending") return false;
      if (q.completedDeliveries > 0 || q.askedSinceLastExpertTurn) return false;
      if (q.origin === "planner" && relevant.size && !q.claimIds.some((c) => relevant.has(c))) return false;
      return true;
    })
    .sort((a, b) => originRank(a.origin) - originRank(b.origin) || a.priority - b.priority || a.code.localeCompare(b.code, undefined, { numeric: true }));
  if (candidates.length) {
    const q = candidates[0];
    out.next_action = { type: "ask", question_ref: q.id, question_revision: q.revision, delivery_directive: null };
    out.rationale = [...notes, `Next: highest-priority pending question ${q.code} relevant to this expert.`].join(" ");
  } else {
    out.next_action = { type: "end", question_ref: null, question_revision: null, delivery_directive: null };
    out.rationale = [...notes, "No pending questions relevant to this expert remain."].join(" ");
  }
  return out;
}

function originRank(o: string) {
  return o === "controller" || o === "copilot" || o === "consultant" ? 0 : 1;
}

function pushFollowUp(out: ControllerProposal, key: keyof typeof FOLLOWUPS, claimByCode: Map<string, string>) {
  if (out.new_questions.some((q) => q.fixture_key === key)) return;
  const f = FOLLOWUPS[key];
  out.new_questions.push({
    ref: key,
    text: f.text,
    purpose: f.purpose,
    claim_ids: f.claims.filter((c) => claimByCode.has(c)).map((c) => claimByCode.get(c)!),
    priority: 1,
    fixture_key: key,
  });
}

// ---------------------------------------------------------------------------
// Copilot (text): deterministic intent routing onto the same scoped tools
// ---------------------------------------------------------------------------

async function mockCopilot(input: CopilotTurnInput, _tools: CopilotToolSpec[], exec: ToolExecutor): Promise<CopilotTurnOutput> {
  const m = input.message.trim();
  const calls: CopilotTurnOutput["toolCalls"] = [];
  const call = async (name: string, args: unknown) => {
    const result = await exec(name, args);
    calls.push({ name, args, result });
    return result;
  };
  let reply: string;
  let navigation: CopilotTurnOutput["navigation"] = null;
  let mm: RegExpMatchArray | null;
  if ((mm = m.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i))) {
    const r = await call("remember_instruction", { text: mm[1].replace(/\.$/, "") + "." });
    reply = r.summary;
  } else if ((mm = m.match(/^(?:please\s+)?forget\s+(?:memory\s+)?(mem_\w+)/i))) {
    reply = (await call("retire_memory", { memory_id: mm[1] })).summary;
  } else if (/where were we|catch me up|brief(ing)?|update me|status/i.test(m)) {
    const h = await call("get_handoff", {});
    reply = h.summary;
    navigation = h.navigation ?? null;
  } else if (/what changed|since i last|since my last/i.test(m)) {
    reply = (await call("get_changes_since_review", {})).summary;
  } else if (/lack evidence|without evidence|gaps?|unsupported|still open/i.test(m)) {
    reply = (await call("list_evidence_gaps", {})).summary;
  } else if ((mm = m.match(/show (?:me )?(?:the )?source (?:for|of) (?:the )?(.+?)(?: concern| claim| issue)?\??$/i))) {
    const r = await call("search_evidence", { query: mm[1] });
    reply = r.summary;
    navigation = r.navigation ?? null;
  } else if ((mm = m.match(/^(?:please\s+)?(?:ask|investigate|find out|follow up|probe|look into)\b(.*)$/i))) {
    const r = await call("submit_research_directive", { instruction: m, claim_ids: [] });
    reply = r.summary;
  } else if ((mm = m.match(/(?:raise|lower|set|change) (?:the )?priority of (Q\d+) to (\d)/i))) {
    reply = (await call("set_question_priority", { question_code: mm[1].toUpperCase(), priority: Number(mm[2]) })).summary;
  } else if ((mm = m.match(/^(?:find|search|evidence (?:on|about|for))\s+(.+)$/i))) {
    const r = await call("search_evidence", { query: mm[1] });
    reply = r.summary;
    navigation = r.navigation ?? null;
  } else {
    const s = await call("get_project_status", {});
    reply =
      `${s.summary}\n\n(Deterministic text copilot: I recognise requests such as "Where were we?", "What changed since I last reviewed?", "Which assumptions still lack evidence?", "Show me the source for the retention concern", "Ask the operator whether …", and "Remember that …".)`;
  }
  return { reply, toolCalls: calls, navigation };
}

export class MockReasoningProvider implements ReasoningProvider {
  readonly name = "mock" as const;
  readonly model = null;
  async plan(input: PlannerInput): Promise<unknown> {
    return northstarPlan(input) ?? heuristicPlan(input);
  }
  /** Optional hook used by tests to delay or alter controller output. */
  controlHook: ((env: ControllerEnvelope, proposal: ControllerProposal) => Promise<unknown> | unknown) | null = null;
  async control(env: ControllerEnvelope): Promise<unknown> {
    const p = mockControl(env);
    return this.controlHook ? await this.controlHook(env, p) : p;
  }
  async copilot(input: CopilotTurnInput, tools: CopilotToolSpec[], exec: ToolExecutor): Promise<CopilotTurnOutput> {
    return mockCopilot(input, tools, exec);
  }
}
