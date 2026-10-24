import type {
  DiligenceProject,
  Expert,
  ExpertNetwork,
  Finding,
  InvestmentHypothesis,
  PlanExpert,
} from "./types";

export const SAMPLE_COMPANY = "Northstar Dental Group";

export const SAMPLE_THESIS = `Northstar Dental Group operates 62 general dentistry clinics across the US Midwest and represents an attractive platform for a buy-and-build strategy.

Market attractiveness: US general dentistry is a ~$165bn market growing 4–5% annually. It remains highly fragmented, with dental service organisations (DSOs) controlling under a third of practices and a large cohort of independent owners approaching retirement.

Consolidation opportunity: We believe Northstar can acquire 8–10 independent clinics per year at 4–5x EBITDA and integrate them onto its central platform, creating multiple arbitrage relative to an expected exit at 12–14x.

Recurring patient relationships: Preventive care drives twice-yearly visits. Management reports patient retention above 85% and a strong base of recall appointments that underpins revenue visibility.

Pricing power: Northstar has implemented annual fee increases of 4–6% with minimal patient attrition, suggesting sustainable pricing power, particularly in self-pay and cosmetic services.

Operational efficiencies: Centralised procurement, billing, scheduling and marketing should expand clinic-level EBITDA margins from 17% to 22% over the hold period.

Key risks: Industry-wide shortages of hygienists and dental assistants may increase wage costs and limit capacity. Service quality and clinician continuity must be maintained as the network scales.`;

export const NETWORKS: ExpertNetwork[] = [
  {
    id: "GLG",
    name: "GLG",
    description: "Global network of industry operators and former executives.",
    connected: false,
  },
  {
    id: "AlphaSights",
    name: "AlphaSights",
    description: "On-demand access to advisers, operators and transaction specialists.",
    connected: false,
  },
  {
    id: "Third Bridge",
    name: "Third Bridge",
    description: "Expert calls and frontline practitioner perspectives.",
    connected: false,
  },
];

export const NETWORK_EXPERTS: Expert[] = [
  {
    id: "e-david",
    name: "David Okafor",
    title: "Former Regional Operations Manager, Northstar Dental",
    phone: "+1 (555) 010-2231",
    description:
      "Ran operations for 14 Northstar clinics (2021–2024), covering staffing, scheduling, procurement and clinic P&Ls.",
    source: "GLG",
  },
  {
    id: "e-sarah",
    name: "Sarah Kim",
    title: "Former CFO, Regional DSO",
    phone: "+1 (555) 010-4410",
    description:
      "CFO of a 40-clinic dental service organisation through two acquisitions and a sponsor exit.",
    source: "GLG",
  },
  {
    id: "e-priya",
    name: "Priya Raman",
    title: "Healthcare M&A Adviser, Dental Services",
    phone: "+1 (555) 010-7782",
    description:
      "Advised on 30+ dental practice and DSO transactions; deep view on valuation multiples and integration.",
    source: "AlphaSights",
  },
  {
    id: "e-jon",
    name: "Jonathan Weiss",
    title: "Operating Partner, Healthcare PE",
    phone: "+1 (555) 010-6625",
    description:
      "Led value-creation plans for two dental platforms, with a focus on procurement and revenue cycle.",
    source: "AlphaSights",
  },
  {
    id: "e-linda",
    name: "Linda Hart",
    title: "Former Lead Hygienist, Multi-site Dental Group",
    phone: "+1 (555) 010-3394",
    description:
      "15 years as a dental hygienist, including four in a DSO-owned clinic; close view of frontline staffing.",
    source: "Third Bridge",
  },
  {
    id: "e-elena",
    name: "Elena Novak",
    title: "Independent Practice Owner (sold to DSO, 2022)",
    phone: "+1 (555) 010-5517",
    description:
      "Owned and sold a three-chair practice; can speak to seller motivations and post-acquisition experience.",
    source: "Third Bridge",
  },
];

export const CUSTOM_EXPERTS: Expert[] = [
  {
    id: "e-maria",
    name: "Maria Chen",
    title: "Former Northstar Patient",
    phone: "+1 (555) 010-1187",
    description:
      "Northstar patient for six years at the Riverside clinic; switched providers in 2024.",
    source: "Custom",
  },
  {
    id: "e-tom",
    name: "Tom Reyes",
    title: "Sales Director, Dental Supply Distributor",
    phone: "+1 (555) 010-2054",
    description:
      "Manages supply accounts for DSOs in the Midwest, including purchasing volumes and pricing tiers.",
    source: "Custom",
  },
];

export const DENTAL_HYPOTHESES: InvestmentHypothesis[] = [
  {
    id: "h1",
    title: "Customer retention is strong",
    description:
      "Patients remain with Northstar over multiple years, supporting recurring revenue.",
    evidence: "Patient tenure, reasons for switching, recall appointment adherence.",
  },
  {
    id: "h2",
    title: "The business has sustainable pricing power",
    description: "Annual fee increases can continue without material patient attrition.",
    evidence: "Patient sensitivity to price, insurer fee schedule constraints, service mix.",
  },
  {
    id: "h3",
    title: "Market fragmentation creates acquisition opportunities",
    description: "A large pool of independent practices can be acquired at attractive multiples.",
    evidence: "DSO penetration, seller pipeline, recent transaction multiples.",
  },
  {
    id: "h4",
    title: "Centralised operations can improve margins",
    description: "Shared procurement, billing and scheduling expand clinic-level EBITDA margins.",
    evidence:
      "Realised procurement savings, back-office cost reductions, offsetting cost pressures.",
  },
  {
    id: "h5",
    title: "Staffing challenges are manageable",
    description: "Hygienist and assistant shortages will not constrain capacity or quality.",
    evidence: "Vacancy rates, agency usage, clinician continuity, impact on schedules.",
  },
];

export const DENTAL_PLAN_EXPERTS: PlanExpert[] = [
  {
    expertId: "e-maria",
    reason:
      "Direct patient perspective on why Northstar patients stay or leave, and how they react to price increases.",
    hypothesisIds: ["h1", "h2"],
    objectives: "Understand drivers of patient churn and tolerance for fee increases.",
    questions: [
      {
        id: "q-maria-1",
        text: "How long were you a Northstar patient, and what originally brought you to the clinic?",
      },
      {
        id: "q-maria-2",
        text: "What ultimately led you to switch to a different dental provider?",
      },
      {
        id: "q-maria-3",
        text: "How did Northstar's pricing compare with the alternatives you considered?",
      },
      {
        id: "q-maria-4",
        text: "How would you rate the quality and continuity of care compared with your new clinic?",
      },
      { id: "q-maria-5", text: "What, if anything, would have made you stay?" },
    ],
  },
  {
    expertId: "e-david",
    reason:
      "Former operator with first-hand data on staffing, scheduling and the impact of centralisation on clinic P&Ls.",
    hypothesisIds: ["h4", "h5"],
    objectives:
      "Quantify margin benefits of centralisation and assess the severity of staffing constraints.",
    questions: [
      { id: "q-david-1", text: "What was your scope of responsibility at Northstar?" },
      {
        id: "q-david-2",
        text: "How have centralised procurement and back-office functions affected clinic margins?",
      },
      {
        id: "q-david-3",
        text: "How significant are hygienist and assistant staffing shortages across the network?",
      },
      {
        id: "q-david-4",
        text: "What has the company done to recruit and retain clinical staff, and at what cost?",
      },
      {
        id: "q-david-5",
        text: "Which clinics performed best, and what distinguished them operationally?",
      },
    ],
  },
  {
    expertId: "e-priya",
    reason:
      "Transaction adviser who can test the acquisition pipeline, valuation assumptions and pricing dynamics.",
    hypothesisIds: ["h3", "h2"],
    objectives:
      "Validate the size of the acquisition opportunity and whether entry multiples support the thesis.",
    questions: [
      { id: "q-priya-1", text: "How fragmented is the US general dentistry market today?" },
      {
        id: "q-priya-2",
        text: "How have acquisition multiples for independent practices changed over the past three years?",
      },
      {
        id: "q-priya-3",
        text: "Do DSOs typically achieve pricing power after acquiring practices?",
      },
      { id: "q-priya-4", text: "What integration risks do you see most often in dental roll-ups?" },
      {
        id: "q-priya-5",
        text: "How do you view Northstar's positioning relative to other mid-sized DSOs?",
      },
    ],
  },
];

type ScriptFinding = Omit<Finding, "interviewId" | "turnId">;
export interface ScriptEntry {
  topic: string;
  answer: string;
  finding?: ScriptFinding;
}

/** Deterministic expert responses keyed by question id. */
export const SCRIPT: Record<string, ScriptEntry> = {
  "q-maria-1": {
    topic: "Patient history and clinic selection",
    answer:
      "About six years at the Riverside location. It was close to my office and my insurer covered it fully, so it was an easy choice at first.",
  },
  "q-maria-2": {
    topic: "Investigating reasons for patient churn",
    answer:
      "Honestly, it was the cancellations. In my last year they cancelled or rescheduled on me four times, usually the day before. Frequent appointment cancellations were a major reason I changed clinics.",
    finding: {
      id: "f-cancel",
      title: "Appointment cancellations drove patient churn",
      description:
        "A six-year patient left primarily because of repeated short-notice cancellations, not price or clinical quality.",
      hypothesisId: "h1",
      quote: "Frequent appointment cancellations were a major reason I changed clinics.",
      sentiment: "contradict",
    },
  },
  "q-maria-3": {
    topic: "Investigating price sensitivity",
    answer:
      "Pricing was roughly in line with other places. When they raised hygiene fees by about 8% I noticed, but I wouldn't have left over it. Price was not the issue for me.",
    finding: {
      id: "f-price",
      title: "Patients tolerated modest fee increases",
      description: "An 8% hygiene fee increase was noticed but did not trigger switching.",
      hypothesisId: "h2",
      quote: "Price was not the issue for me.",
      sentiment: "support",
    },
  },
  "q-maria-4": {
    topic: "Quality and continuity of care",
    answer:
      "The dentists themselves were good. But it felt like they were stretched thin — I saw a different hygienist almost every visit.",
    finding: {
      id: "f-continuity",
      title: "Low clinician continuity noticed by patients",
      description:
        "Patients observe frequent hygienist changes, suggesting staffing turnover is visible at the point of care.",
      hypothesisId: "h5",
      quote: "I saw a different hygienist almost every visit.",
      sentiment: "contradict",
    },
  },
  "q-maria-5": {
    topic: "Retention levers",
    answer:
      "Reliable scheduling. If I could trust that the appointment would actually happen, I'd probably still be there.",
  },

  "q-david-1": {
    topic: "Expert background",
    answer:
      "I oversaw operations for 14 clinics in the Midwest region from 2021 to 2024 — staffing, scheduling, supply chain and the clinic P&Ls.",
  },
  "q-david-2": {
    topic: "Investigating centralisation and margin impact",
    answer:
      "Procurement consolidation was real. We cut supply costs by roughly 11% per chair. Centralising billing took longer, but eventually reduced admin headcount by about a fifth.",
    finding: {
      id: "f-margin",
      title: "Centralised procurement delivered ~11% supply savings",
      description:
        "Former operator confirms tangible savings from procurement and billing centralisation.",
      hypothesisId: "h4",
      quote: "We cut supply costs by roughly 11% per chair.",
      sentiment: "support",
    },
  },
  "q-david-3": {
    topic: "Investigating staffing and operational performance",
    answer:
      "It's the biggest operational issue we had. At any point, around 15% of hygienist roles were vacant. Staff shortages regularly disrupted clinic schedules.",
    finding: {
      id: "f-staff",
      title: "Persistent hygienist vacancies disrupted scheduling",
      description:
        "Roughly 15% of hygienist roles were vacant at any time, regularly disrupting clinic schedules.",
      hypothesisId: "h5",
      quote: "Staff shortages regularly disrupted clinic schedules.",
      sentiment: "contradict",
    },
  },
  "q-david-4": {
    topic: "Recruitment and retention costs",
    answer:
      "Signing bonuses and some wage increases in 2023. It helped at the margin, but we were still filling gaps with agency staff at a 30 to 40% premium.",
    finding: {
      id: "f-agency",
      title: "Agency staffing costs offset margin gains",
      description:
        "Gaps filled by agency clinicians at a 30–40% premium partially erode centralisation savings.",
      hypothesisId: "h4",
      quote: "we were still filling gaps with agency staff at a 30 to 40% premium.",
      sentiment: "contradict",
    },
  },
  "q-david-5": {
    topic: "Drivers of clinic performance",
    answer:
      "The best clinics had stable, long-tenured office managers. Turnover at the manager level was the clearest predictor of underperformance.",
  },

  "q-priya-1": {
    topic: "Investigating market fragmentation",
    answer:
      "Still very fragmented. DSOs hold roughly a quarter to a third of practices; the rest are independent, and many are owned by dentists approaching retirement.",
    finding: {
      id: "f-frag",
      title: "Large pool of independent practices remains",
      description:
        "DSOs control roughly 25–33% of practices, with an ageing owner base creating seller supply.",
      hypothesisId: "h3",
      quote: "DSOs hold roughly a quarter to a third of practices",
      sentiment: "support",
    },
  },
  "q-priya-2": {
    topic: "Investigating acquisition multiples",
    answer:
      "They've moved up. Good practices traded at 4 to 5x EBITDA a few years ago; competitive processes now regularly clear 6 to 7x.",
    finding: {
      id: "f-multiples",
      title: "Rising entry multiples compress roll-up returns",
      description: "Entry multiples have risen to 6–7x, above the 4–5x assumed in the thesis.",
      hypothesisId: "h3",
      quote: "competitive processes now regularly clear 6 to 7x.",
      sentiment: "contradict",
    },
  },
  "q-priya-3": {
    topic: "Investigating pricing power",
    answer:
      "It's limited. Most revenue is tied to insurer fee schedules. The upside comes from mix — more cosmetic and implant work — rather than headline price.",
    finding: {
      id: "f-pricing-limit",
      title: "Pricing power constrained by insurer fee schedules",
      description:
        "Price upside is largely limited to self-pay mix rather than broad fee increases.",
      hypothesisId: "h2",
      quote: "Most revenue is tied to insurer fee schedules.",
      sentiment: "contradict",
    },
  },
  "q-priya-4": {
    topic: "Integration risks",
    answer:
      "Dentist attrition after the deal and culture clash. If the selling dentist leaves within two years, patient retention often drops noticeably.",
  },
  "q-priya-5": {
    topic: "Competitive positioning",
    answer:
      "Respectable regional density, which matters for staffing and referrals. But they'll be competing with better-capitalised buyers for the same targets.",
  },
};

/** Round 2 (deterministic): recommended after Round 1 interviews complete. */
export const ROUND2_HYPOTHESES: InvestmentHypothesis[] = [
  {
    id: "h6",
    title: "Staffing shortages are driving patient churn",
    description:
      "Hygienist vacancies cause recall cancellations, and cancelled patients lapse at elevated rates.",
    evidence: "Which appointments are cancelled when short-staffed; lapse rates after reschedules.",
    origin: "New — from cross-interview insight",
    basisFindingIds: ["f-cancel", "f-staff", "f-link"],
    round: 2,
  },
  {
    id: "h7",
    title: "Entry multiples still support buy-and-build returns",
    description:
      "Despite rising prices, Northstar can acquire practices at multiples that preserve the exit arbitrage.",
    evidence:
      "Recent DSO entry multiples, ramp-up time to platform margins, realistic exit multiples.",
    origin: "Refined from H3",
    basisFindingIds: ["f-frag", "f-multiples"],
    round: 2,
  },
];

export const ROUND2_PLAN_EXPERTS: PlanExpert[] = [
  {
    expertId: "e-linda",
    reason:
      "Frontline hygienist who can confirm how staffing gaps translate into cancellations and lapsed patients.",
    hypothesisIds: ["h6", "h5"],
    objectives: "Test the causal chain from hygienist vacancies to cancellations to patient churn.",
    questions: [
      {
        id: "q-linda-1",
        text: "How did hygienist staffing levels change during your time at a DSO-owned clinic?",
      },
      {
        id: "q-linda-2",
        text: "When the clinic was short-staffed, how were patient appointments handled?",
      },
      {
        id: "q-linda-3",
        text: "Did you see patients leave the practice after repeated cancellations?",
      },
      { id: "q-linda-4", text: "What would have made it easier to retain hygienists?" },
    ],
  },
  {
    expertId: "e-sarah",
    reason:
      "Former DSO CFO with direct data on entry multiples, integration ramp-up and exit valuations.",
    hypothesisIds: ["h7", "h4"],
    objectives: "Quantify whether today's entry multiples still support the targeted exit returns.",
    questions: [
      {
        id: "q-sarah-1",
        text: "What entry multiples did your DSO pay for independent practices in the last two years?",
      },
      {
        id: "q-sarah-2",
        text: "How long did acquired practices take to reach platform-level margins?",
      },
      {
        id: "q-sarah-3",
        text: "Is a 12–14x exit multiple realistic for a platform of Northstar's size?",
      },
      {
        id: "q-sarah-4",
        text: "Which diligence areas do buyers most often underestimate in dental roll-ups?",
      },
    ],
  },
];

Object.assign(SCRIPT, {
  "q-linda-1": {
    topic: "Clinic staffing trends",
    answer:
      "We went from five hygienists to three over about eighteen months, and the replacements were mostly agency staff who rotated weekly.",
    finding: {
      id: "f-r2-turnover",
      title: "Permanent hygienists replaced by rotating agency staff",
      description:
        "A clinic lost 40% of its permanent hygienists in 18 months, backfilled by rotating agency cover.",
      hypothesisId: "h5",
      quote: "the replacements were mostly agency staff who rotated weekly.",
      sentiment: "contradict",
    },
  },
  "q-linda-2": {
    topic: "Investigating cancellation practices",
    answer:
      "Recall and cleaning appointments were always the first to go. The front desk had a list — they'd call patients the night before and push them out four to six weeks.",
    finding: {
      id: "f-r2-recall",
      title: "Recall visits are cancelled first when short-staffed",
      description:
        "Clinics systematically cancel recall and hygiene appointments when hygienists are unavailable.",
      hypothesisId: "h6",
      quote: "Recall and cleaning appointments were always the first to go.",
      sentiment: "support",
    },
  },
  "q-linda-3": {
    topic: "Investigating patient lapse after cancellations",
    answer:
      "Definitely. After the second or third reschedule a lot of them just didn't come back. We'd see them in the system as lapsed after a year.",
    finding: {
      id: "f-r2-lapse",
      title: "Repeated reschedules lead patients to lapse",
      description:
        "Patients rescheduled two or three times frequently lapse, confirming the churn mechanism.",
      hypothesisId: "h6",
      quote: "After the second or third reschedule a lot of them just didn't come back.",
      sentiment: "support",
    },
  },
  "q-linda-4": {
    topic: "Hygienist retention levers",
    answer:
      "Predictable schedules and less pressure on chair time. Pay mattered, but burnout was why most of my colleagues left.",
  },
  "q-sarah-1": {
    topic: "Investigating current entry multiples",
    answer:
      "Our average was about 6.5x for practices with over a million in revenue. Smaller practices were cheaper, but they rarely moved the needle.",
    finding: {
      id: "f-r2-multiple",
      title: "Quality practices now cost ~6.5x EBITDA",
      description: "Meaningful targets trade well above the 4–5x entry assumed in the thesis.",
      hypothesisId: "h7",
      quote: "Our average was about 6.5x for practices with over a million in revenue.",
      sentiment: "contradict",
    },
  },
  "q-sarah-2": {
    topic: "Integration ramp-up",
    answer:
      "Typically 18 to 24 months, and only when the selling dentist stayed. Where they left early, some practices never got there.",
    finding: {
      id: "f-r2-ramp",
      title: "Margin ramp-up depends on retaining the selling dentist",
      description:
        "Acquired practices take 18–24 months to reach platform margins, and may never if the seller leaves.",
      hypothesisId: "h4",
      quote: "Where they left early, some practices never got there.",
      sentiment: "contradict",
    },
  },
  "q-sarah-3": {
    topic: "Exit valuation",
    answer:
      "For a 60-plus clinic platform with clean data, 11 to 13x is achievable. Fourteen would need a strong organic growth story.",
    finding: {
      id: "f-r2-exit",
      title: "11–13x exit multiple is achievable at scale",
      description:
        "A 60+ clinic platform can plausibly exit at 11–13x, slightly below the top of the thesis range.",
      hypothesisId: "h7",
      quote: "11 to 13x is achievable.",
      sentiment: "support",
    },
  },
  "q-sarah-4": {
    topic: "Underestimated diligence areas",
    answer:
      "Clinical labour. Buyers model wage inflation but not the volume lost when chairs sit empty.",
  },
} satisfies Record<string, ScriptEntry>);

/** Response used when a consultant follow-up concerns staffing and cancellations. */
export const LINK_RESPONSE: ScriptEntry = {
  topic: "Consultant follow-up: staffing and cancellations",
  answer:
    "Yes, directly. When we were short a hygienist, the scheduling team cancelled the lowest-value appointments first — usually recall and hygiene visits. In a bad month that was 10 to 12% of the book in some clinics, and those patients were the least likely to rebook.",
  finding: {
    id: "f-link",
    title: "Staffing gaps caused a measurable share of cancellations",
    description:
      "Hygienist shortages led to cancellation of up to 10–12% of appointments in affected clinics, concentrated in recall visits.",
    hypothesisId: "h1",
    quote:
      "In a bad month that was 10 to 12% of the book in some clinics, and those patients were the least likely to rebook.",
    sentiment: "contradict",
  },
};

export const GENERIC_ANSWERS = [
  "That's a fair question. From what I've seen, it varies by region, but the general pattern holds — I'd want to see the underlying data before giving you a firm number.",
  "In my experience, it's less about the headline figure and more about consistency over time. The better operators manage that very deliberately.",
  "I'd be cautious there. It's often presented as a strength, but in practice it depends heavily on local management quality.",
];

export const CROSS_INSIGHTS = [
  {
    id: "ci-staff-churn",
    aFindingId: "f-cancel",
    bFindingId: "f-staff",
    title:
      "Staffing shortages may be contributing to customer churn through appointment cancellations.",
    hypothesisIds: ["h1", "h5"],
    suggestedQuestion:
      "Investigate whether staffing shortages are causing appointment cancellations.",
  },
  {
    id: "ci-multiples",
    aFindingId: "f-frag",
    bFindingId: "f-multiples",
    title:
      "Fragmentation remains, but competition for targets may erode the multiple arbitrage assumed in the thesis.",
    hypothesisIds: ["h3"],
    suggestedQuestion:
      "How many acquisition targets would still be available at 4–5x EBITDA in Northstar's core region?",
  },
];

const now = new Date("2026-10-22T15:30:00Z").toISOString();

function bare(
  id: string,
  company: string,
  thesis: string,
  status: DiligenceProject["status"],
  updatedAt: string,
): DiligenceProject {
  return {
    id,
    company,
    thesis,
    status,
    networks: NETWORKS.map((n) => ({ ...n })),
    experts: [],
    interviews: [],
    reviews: {},
    updatedAt,
  };
}

export function seedProjects(): DiligenceProject[] {
  const connected = new Set(["GLG", "AlphaSights", "Third Bridge"]);
  const northstar: DiligenceProject = {
    ...bare("northstar", SAMPLE_COMPANY, SAMPLE_THESIS, "Ready for Interviews", now),
    networks: NETWORKS.map((n) => ({ ...n, connected: connected.has(n.id) })),
    experts: [...CUSTOM_EXPERTS, ...NETWORK_EXPERTS.filter((e) => connected.has(e.source))],
    selectedExpertIds: ["e-david", "e-priya"],
    plan: {
      hypotheses: DENTAL_HYPOTHESES.map((h) => ({ ...h })),
      experts: DENTAL_PLAN_EXPERTS.map((p) => ({
        ...p,
        questions: p.questions.map((q) => ({ ...q })),
      })),
      approved: true,
    },
  };
  northstar.interviews = northstar.plan!.experts.map((pe) => ({
    id: `iv-${pe.expertId.replace("e-", "")}`,
    expertId: pe.expertId,
    status: "Not Started" as const,
    topic: "Awaiting start",
    questions: pe.questions.map((q) => ({ id: q.id, text: q.text, status: "pending" as const })),
    transcript: [],
    findings: [],
  }));

  const harbor = {
    ...bare(
      "harbor",
      "Harbor Veterinary Partners",
      "Harbor Veterinary Partners operates 28 companion-animal clinics in the Pacific Northwest. The thesis rests on rising pet ownership, premiumisation of veterinary care, and consolidation of independent practices.",
      "Planning",
      "2026-10-19T10:00:00Z",
    ),
  };
  harbor.networks = harbor.networks.map((n) => ({ ...n, connected: n.id === "AlphaSights" }));
  harbor.experts = NETWORK_EXPERTS.filter((e) => e.source === "AlphaSights");

  const summit = bare(
    "summit",
    "Summit Physio Clinics",
    "Summit Physio is a regional outpatient physiotherapy chain with 19 sites. We believe referral relationships with orthopaedic surgeons create defensible volume.",
    "Draft",
    "2026-10-14T09:12:00Z",
  );

  return [northstar, harbor, summit];
}
