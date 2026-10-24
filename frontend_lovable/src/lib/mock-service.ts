/**
 * Mock service layer. Each function mirrors the shape of a future backend
 * response so it can later be swapped for a real API call.
 */
import {
  NETWORK_EXPERTS,
  ROUND2_HYPOTHESES,
  ROUND2_PLAN_EXPERTS,
  CROSS_INSIGHTS,
  DENTAL_HYPOTHESES,
  DENTAL_PLAN_EXPERTS,
  GENERIC_ANSWERS,
  LINK_RESPONSE,
  SCRIPT,
  seedProjects,
  type ScriptEntry,
} from "./mock-data";
import type {
  DiligenceProject,
  Finding,
  Interview,
  InterviewQuestion,
  InvestmentHypothesis,
  ProjectStatus,
  ResearchPlan,
  ResearchRound,
  Expert,
} from "./types";

/** All research rounds, oldest first; the last one is the current round. */
export function roundsOf(p: DiligenceProject): ResearchRound[] {
  return [...(p.pastRounds ?? []), ...(p.plan ? [{ plan: p.plan, interviews: p.interviews }] : [])];
}
export const allInterviews = (p: DiligenceProject) => [
  ...(p.pastRounds ?? []).flatMap((r) => r.interviews),
  ...p.interviews,
];
export function allHypotheses(p: DiligenceProject): InvestmentHypothesis[] {
  const seen = new Map<string, InvestmentHypothesis>();
  for (const r of roundsOf(p))
    for (const h of r.plan.hypotheses) if (!seen.has(h.id)) seen.set(h.id, h);
  return [...seen.values()];
}

/** Drop a project from the saved list. */
export const withoutProject = (ps: DiligenceProject[], id: string) => ps.filter((p) => p.id !== id);

/** Sample projects the consultant has not saved yet. */
export const missingSamples = (ps: DiligenceProject[]) =>
  seedProjects().filter((s) => !ps.some((p) => p.id === s.id));

export const canRecommendNextRound = (p: DiligenceProject) =>
  !!p.plan?.approved &&
  p.interviews.length > 0 &&
  p.interviews.every((i) => i.status === "Completed");

/** Proposes the next research round from completed findings. Returns new experts to add to the project. */
export function generateNextRoundPlan(p: DiligenceProject): {
  plan: ResearchPlan;
  newExperts: Expert[];
} {
  const roundNo = (p.pastRounds?.length ?? 0) + 2;
  if (isDental(p) && roundNo === 2) {
    const ids = ROUND2_PLAN_EXPERTS.map((e) => e.expertId);
    return {
      plan: {
        hypotheses: ROUND2_HYPOTHESES.map((h) => ({ ...h })),
        experts: ROUND2_PLAN_EXPERTS.map((pe) => ({
          ...pe,
          questions: pe.questions.map((q) => ({ ...q })),
        })),
        approved: false,
      },
      newExperts: NETWORK_EXPERTS.filter(
        (e) => ids.includes(e.id) && !p.experts.some((x) => x.id === e.id),
      ),
    };
  }
  const { validation } = generateMockFindings(p);
  const open = validation
    .filter((v) => v.assessment === "Insufficient Evidence" || v.assessment === "Mixed Evidence")
    .slice(0, 3);
  const all = allHypotheses(p);
  const hypotheses: InvestmentHypothesis[] = open.map((v, i) => ({
    id: `h-r${roundNo}-${i + 1}`,
    title: `Resolve: ${v.hypothesis.title}`,
    description: `Evidence so far is ${v.assessment.toLowerCase()}; gather corroborating views.`,
    evidence: v.hypothesis.evidence,
    origin: `Refined from H${all.findIndex((h) => h.id === v.hypothesis.id) + 1}`,
    basisFindingIds: v.findings.map((f) => f.id),
    round: roundNo,
  }));
  const used = new Set(p.plan?.experts.map((e) => e.expertId));
  const pool = [
    ...p.experts.filter((e) => !used.has(e.id)),
    ...p.experts.filter((e) => used.has(e.id)),
  ].slice(0, 2);
  return {
    plan: {
      hypotheses,
      experts: pool.map((e) => ({
        expertId: e.id,
        reason: `Additional perspective to close open evidence gaps.`,
        hypothesisIds: hypotheses.map((h) => h.id),
        objectives: "Resolve hypotheses with mixed or insufficient evidence.",
        questions: hypotheses.map((h) => ({
          id: uid("q"),
          text: `What evidence have you seen on whether ${h.title.replace("Resolve: ", "").toLowerCase()}?`,
        })),
      })),
      approved: false,
    },
    newExperts: [],
  };
}

/** Archives the current round and makes the proposed plan the active one. */
export function startNextRound(p: DiligenceProject): DiligenceProject {
  const { plan, newExperts } = generateNextRoundPlan(p);
  return {
    ...p,
    pastRounds: [...(p.pastRounds ?? []), { plan: p.plan!, interviews: p.interviews }],
    plan,
    interviews: [],
    experts: [...p.experts, ...newExperts],
    selectedExpertIds: [
      ...new Set([...(p.selectedExpertIds ?? []), ...plan.experts.map((e) => e.expertId)]),
    ],
  };
}

export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 9)}`;

const isDental = (p: DiligenceProject) => /dental|dentist/i.test(p.company + " " + p.thesis);

/** Experts the consultant has chosen for this project: all custom contacts plus selected network experts. */
export function selectedExperts(p: DiligenceProject) {
  const sel = new Set(p.selectedExpertIds ?? []);
  return p.experts.filter((e) => e.source === "Custom" || sel.has(e.id));
}

/** AI-suggested experts from the directory, with the reason each is relevant. */
export function getRecommendedExperts(
  p: DiligenceProject,
): { expertId: string; reason: string; hypotheses: string[] }[] {
  const ids = new Set(p.experts.map((e) => e.id));
  if (isDental(p)) {
    return DENTAL_PLAN_EXPERTS.filter((pe) => ids.has(pe.expertId)).map((pe) => ({
      expertId: pe.expertId,
      reason: pe.reason,
      hypotheses: pe.hypothesisIds.map((h) => DENTAL_HYPOTHESES.find((x) => x.id === h)!.title),
    }));
  }
  return p.experts.slice(0, 3).map((e) => ({
    expertId: e.id,
    reason: `${e.title} with a relevant perspective on ${p.company}.`,
    hypotheses: [],
  }));
}

export function generateMockResearchPlan(input: DiligenceProject): ResearchPlan {
  const project = { ...input, experts: selectedExperts(input) };
  if (isDental(project)) {
    const scripted = new Set(DENTAL_PLAN_EXPERTS.map((pe) => pe.expertId));
    const available = new Set(project.experts.map((e) => e.id));
    const experts = DENTAL_PLAN_EXPERTS.filter((pe) => available.has(pe.expertId));
    const extra = project.experts.filter((e) => !scripted.has(e.id));
    return {
      hypotheses: DENTAL_HYPOTHESES.map((h) => ({ ...h })),
      experts: [
        ...experts.map((pe) => ({ ...pe, questions: pe.questions.map((q) => ({ ...q })) })),
        ...extra.map((e) => ({
          expertId: e.id,
          reason: `${e.title} — selected by the consultant for an additional perspective.`,
          hypothesisIds: ["h1", "h4"],
          objectives: "Corroborate evidence on retention and operating efficiency.",
          questions: [
            "How would you describe Northstar's reputation among patients and peers?",
            "What operational factors most affect profitability in multi-site dental groups?",
            "Where do you see the largest risks for a dental roll-up over the next three years?",
          ].map((text) => ({ id: uid("q"), text })),
        })),
      ],
      approved: false,
    };
  }
  const c = project.company || "the target";
  const hypotheses: InvestmentHypothesis[] = [
    {
      id: "h1",
      title: "Customer demand is resilient",
      description: `Demand for ${c}'s services is recurring and stable.`,
      evidence: "Customer tenure, switching drivers, volume trends.",
    },
    {
      id: "h2",
      title: "Pricing is sustainable",
      description: "Price increases can be passed through without material volume loss.",
      evidence: "Price sensitivity, payer constraints, competitor pricing.",
    },
    {
      id: "h3",
      title: "Consolidation opportunity exists",
      description: "The market is fragmented enough to support a buy-and-build strategy.",
      evidence: "Market share data, acquisition multiples, seller pipeline.",
    },
    {
      id: "h4",
      title: "Operating leverage can expand margins",
      description: "Central functions will lower unit costs as the network grows.",
      evidence: "Realised synergies, cost benchmarks.",
    },
  ];
  return {
    hypotheses,
    experts: project.experts.slice(0, 3).map((e, i) => ({
      expertId: e.id,
      reason: `${e.title || "Expert"} with relevant perspective on ${c}.`,
      hypothesisIds: [hypotheses[i % 4]!.id, hypotheses[(i + 1) % 4]!.id],
      objectives: `Test ${hypotheses[i % 4]!.title.toLowerCase()}.`,
      questions: [
        `What is your experience with ${c} or its direct competitors?`,
        "What drives customers to stay with or leave a provider in this market?",
        "How much pricing flexibility do operators in this sector really have?",
        "Where do you see the largest operational risks over the next three years?",
      ].map((text) => ({ id: uid("q"), text })),
    })),
    approved: false,
  };
}

export function createInterviewsFromPlan(plan: ResearchPlan): Interview[] {
  return plan.experts.map((pe) => ({
    id: uid("iv"),
    expertId: pe.expertId,
    status: "Not Started",
    topic: "Awaiting start",
    questions: pe.questions.map((q) => ({ id: q.id, text: q.text, status: "pending" })),
    transcript: [],
    findings: [],
  }));
}

export const startMockInterview = (iv: Interview): Interview =>
  iv.status === "Completed"
    ? iv
    : {
        ...iv,
        status: "In Progress",
        topic: iv.topic === "Awaiting start" ? "Opening the interview" : iv.topic,
      };

export const pauseMockInterview = (iv: Interview): Interview =>
  iv.status === "In Progress" ? { ...iv, status: "Paused" } : iv;

/** How many interview agents run side by side; the rest wait in the queue. */
export const MAX_CONCURRENT_INTERVIEWS = 2;

/** Interview agents start themselves: fill free slots from the queue. Paused interviews stay paused. */
export function autoLaunchInterviews(p: DiligenceProject): DiligenceProject {
  const slots =
    MAX_CONCURRENT_INTERVIEWS - p.interviews.filter((i) => i.status === "In Progress").length;
  if (slots <= 0) return p;
  const ids = new Set(
    p.interviews
      .filter((i) => i.status === "Not Started")
      .slice(0, slots)
      .map((i) => i.id),
  );
  if (!ids.size) return p;
  return { ...p, interviews: p.interviews.map((i) => (ids.has(i.id) ? startMockInterview(i) : i)) };
}

export function addInterviewQuestion(iv: Interview, text: string): Interview {
  const q: InterviewQuestion = { id: uid("fq"), text: text.trim(), status: "pending", added: true };
  return { ...iv, questions: [...iv.questions, q] };
}

export const completeMockInterview = (iv: Interview): Interview => ({
  ...iv,
  status: "Completed",
  topic: "Interview complete",
  questions: iv.questions.map((q) => (q.status === "current" ? { ...q, status: "pending" } : q)),
});

const fmtTime = (i: number) => {
  const s = i * 37 + 12;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function resolveScript(q: InterviewQuestion, iv: Interview): ScriptEntry {
  const scripted = SCRIPT[q.id];
  if (scripted) return scripted;
  if (
    q.added &&
    /staff|cancel|hygien|shortage/i.test(q.text) &&
    !iv.findings.some((f) => f.id === "f-link")
  ) {
    return LINK_RESPONSE;
  }
  const n = q.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    topic: q.added ? "Consultant follow-up" : "Exploring additional question",
    answer: GENERIC_ANSWERS[n % GENERIC_ANSWERS.length]!,
  };
}

/** Advance the simulation by one transcript turn. */
export function advanceMockInterview(iv: Interview): Interview {
  if (iv.status !== "In Progress") return iv;
  const current = iv.questions.find((q) => q.status === "current");
  const time = fmtTime(iv.transcript.length);

  if (current) {
    const s = resolveScript(current, iv);
    const turnId = uid("t");
    const findings: Finding[] = s.finding
      ? [...iv.findings, { ...s.finding, interviewId: iv.id, turnId }]
      : iv.findings;
    return {
      ...iv,
      transcript: [
        ...iv.transcript,
        { id: turnId, speaker: "expert", text: s.answer, time, questionId: current.id },
      ],
      questions: iv.questions.map((q) => (q.id === current.id ? { ...q, status: "answered" } : q)),
      findings,
    };
  }

  const next =
    iv.questions.find((q) => q.added && q.status === "pending") ??
    iv.questions.find((q) => q.status === "pending");
  if (!next) return completeMockInterview(iv);

  const s = resolveScript(next, iv);
  const text = next.added
    ? `Thank you. Before we move on, I'd like to follow up on something specific: ${next.text}`
    : next.text;
  return {
    ...iv,
    topic: s.topic,
    transcript: [
      ...iv.transcript,
      { id: uid("t"), speaker: "ai", text, time, questionId: next.id },
    ],
    questions: iv.questions.map((q) => (q.id === next.id ? { ...q, status: "current" } : q)),
  };
}

export function deriveStatus(p: DiligenceProject): ProjectStatus {
  if (p.interviews.length && p.interviews.every((i) => i.status === "Completed"))
    return "Completed";
  if (p.interviews.some((i) => i.status !== "Not Started")) return "In Progress";
  if (p.plan?.approved) return "Ready for Interviews";
  if (p.plan) return "Planning";
  return p.status === "Planning" ? "Planning" : "Draft";
}

export function getCrossInsights(p: DiligenceProject) {
  const all = allInterviews(p).flatMap((i) => i.findings);
  return CROSS_INSIGHTS.flatMap((ci) => {
    const a = all.find((f) => f.id === ci.aFindingId);
    const b = all.find((f) => f.id === ci.bFindingId);
    return a && b ? [{ ...ci, a, b }] : [];
  });
}

export type Assessment = "Supported" | "Contradicted" | "Mixed Evidence" | "Insufficient Evidence";

function assess(fs: Finding[]): Assessment {
  const sup = fs.filter((f) => f.sentiment === "support").length;
  const con = fs.filter((f) => f.sentiment === "contradict").length;
  return sup + con === 0
    ? "Insufficient Evidence"
    : con === 0
      ? "Supported"
      : sup === 0
        ? "Contradicted"
        : "Mixed Evidence";
}

/** Derive evidence from unscripted answers, including interviews saved before extraction existed. */
function findingsForRound(round: ResearchRound): Finding[] {
  return round.interviews.flatMap((iv) => {
    const pe = round.plan.experts.find((e) => e.expertId === iv.expertId);
    const hypotheses =
      pe?.hypothesisIds.flatMap((id) => round.plan.hypotheses.filter((h) => h.id === id)) ?? [];
    const evidence = iv.transcript.flatMap((turn) => {
      if (turn.speaker !== "expert" || !turn.questionId || !turn.text.trim()) return [];
      if (SCRIPT[turn.questionId] || iv.findings.some((f) => f.turnId === turn.id)) return [];
      const questionIndex = iv.questions.findIndex((q) => q.id === turn.questionId);
      const hypothesis = hypotheses[Math.max(0, questionIndex) % hypotheses.length];
      if (!hypothesis) return [];
      return [
        {
          id: `f-evidence-${iv.id}-${turn.id}`,
          title: `Further evidence needed: ${hypothesis.title}`,
          description:
            "The expert offered a qualified perspective, but did not provide enough evidence to confirm or reject this hypothesis.",
          hypothesisId: hypothesis.id,
          interviewId: iv.id,
          turnId: turn.id,
          quote: turn.text,
          sentiment: "neutral" as const,
        },
      ];
    });
    return [...iv.findings, ...evidence];
  });
}

export function generateMockFindings(p: DiligenceProject) {
  const rounds = roundsOf(p);
  const roundFindings = rounds.map(findingsForRound);
  const findings = roundFindings.flat();
  const hyps = allHypotheses(p);
  const validation = hyps.map((h) => {
    const fs = findings.filter((f) => f.hypothesisId === h.id);
    const start = (h.round ?? 1) - 1;
    // Assessment after each round since the hypothesis was introduced.
    const history = rounds.slice(start).map((_, k) =>
      assess(
        roundFindings
          .slice(0, start + k + 1)
          .flat()
          .filter((f) => f.hypothesisId === h.id),
      ),
    );
    return { hypothesis: h, assessment: assess(fs), findings: fs, history, startRound: start + 1 };
  });

  const contradictions: { a: Finding; b: Finding; hypothesisId: string }[] = [];
  for (const h of hyps) {
    const fs = findings.filter((f) => f.hypothesisId === h.id);
    const s = fs.find((f) => f.sentiment === "support");
    const c = fs.find((f) => f.sentiment === "contradict");
    if (s && c) contradictions.push({ a: s, b: c, hypothesisId: h.id });
  }

  const gaps = [
    ...validation
      .filter((v) => v.assessment === "Insufficient Evidence")
      .map((v) =>
        v.findings.length
          ? `Expert answers remain inconclusive for "${v.hypothesis.title}"; obtain supporting data or a corroborating interview.`
          : `No interview evidence yet for "${v.hypothesis.title}".`,
      ),
    ...validation
      .filter((v) => v.findings.length === 1)
      .map(
        (v) =>
          `"${v.hypothesis.title}" rests on a single expert source; corroborate with a second interview.`,
      ),
    ...allInterviews(p).flatMap((iv) => {
      const n = iv.questions.filter((q) => q.status !== "answered").length;
      return n ? [`${n} planned question(s) unanswered in one interview.`] : [];
    }),
  ];

  const supported = validation.filter((v) => v.assessment === "Supported");
  const risks = validation.filter(
    (v) => v.assessment === "Contradicted" || v.assessment === "Mixed Evidence",
  );
  const overall =
    findings.length === 0
      ? "Not yet assessed"
      : supported.length + risks.length === 0
        ? "Thesis not yet validated — further evidence required"
        : risks.length > supported.length
          ? "Thesis partially supported — material risks identified"
          : "Thesis broadly supported";

  return {
    findings,
    validation,
    contradictions,
    gaps,
    supported,
    risks,
    overall,
    crossInsights: getCrossInsights(p),
  };
}
