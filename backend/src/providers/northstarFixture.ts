// Fictional Northstar Dental Group demonstration data. Every record created from this file is
// marked synthetic. No real company, person, or phone number is represented.

export const NORTHSTAR_MARKER = "Northstar Dental Group";

export const NORTHSTAR_PROJECT = {
  company: "Northstar Dental Group (fictional)",
  objective:
    "Test whether Northstar can grow EBITDA through same-clinic growth and pricing without patient loss, and identify operating risks that challenge the investment thesis.",
};

export const NORTHSTAR_THESIS_PARAGRAPHS = [
  "Northstar Dental Group — Investment Thesis (SYNTHETIC DEMONSTRATION DOCUMENT)",
  "Northstar Dental Group operates 42 general dentistry clinics across Ontario and Quebec, assembled through a roll-up strategy between 2019 and 2024.",
  "Thesis: Northstar can grow EBITDA from C$38M to C$60M within four years through same-clinic growth, disciplined pricing, and continued tuck-in acquisitions.",
  "Patient retention is strong: management reports annual patient churn below 5%.",
  "Clinics have spare chair capacity, so same-clinic visit volume can grow 6% per year without hiring additional hygienists.",
  "Centralized scheduling, introduced in 2023, has reduced appointment cancellations and no-shows across the network.",
  "Fee increases of 3-4% per year can be implemented without measurable patient loss, because most revenue is reimbursed by insurers.",
  "Staffing is stable; hygienist turnover is in line with the Ontario industry average.",
  "Key risks to test: hygienist labour availability, insurer fee-guide changes, and integration of recently acquired clinics.",
  "Scope: clinics owned as of 31 December 2024. Clinics acquired after 2024 are excluded from this diligence scope.",
];

export const NORTHSTAR_EXPERTS = [
  {
    key: "operator",
    name: "Dana Whitfield",
    title: "Former Regional Operations Director",
    organization: "Northstar Dental Group (former)",
    phone: "+1-555-0100",
    email: "dana.whitfield@example.invalid",
    background:
      "Regional operations director at Northstar Dental Group from 2020 to 2025, overseeing 11 clinics in Eastern Ontario. Responsible for hygienist scheduling, clinic staffing plans, and weekly cancellation reporting.",
    sourceRecordId: "NS-CRM-0001",
  },
  {
    key: "customer",
    name: "Priya Raman",
    title: "Former patient",
    organization: "Independent (consumer)",
    phone: "",
    email: "priya.raman@example.invalid",
    background:
      "Patient at the Northstar Kanata clinic from 2021 to early 2025 with a family of four; moved the family to an independent dental practice in 2025.",
    sourceRecordId: "NS-CRM-0002",
  },
  {
    key: "insurer",
    name: "Marc Gagnon",
    title: "Dental Claims Manager",
    organization: "Group benefits insurer (unnamed)",
    phone: "+1-555-0102",
    email: "marc.gagnon@example.invalid",
    background:
      "Twelve years managing dental claims at a Canadian group-benefits insurer, including annual review of provincial dental fee guides and reimbursement limits.",
    sourceRecordId: "NS-CRM-0003",
  },
  {
    key: "competitor",
    name: "Dr. Helen Okafor",
    title: "Dentist and clinic owner",
    organization: "Independent practice, Kingston",
    phone: "+1-555-0103",
    email: "helen.okafor@example.invalid",
    background:
      "Owns an independent general dentistry clinic in Kingston, Ontario that competes with two Northstar locations; previously an associate dentist at a different dental service organization.",
    sourceRecordId: "NS-CRM-0004",
  },
  {
    key: "recruiter",
    name: "Tom Becker",
    title: "Dental staffing recruiter",
    organization: "Healthcare staffing agency",
    phone: "+1-555-0104",
    email: "tom.becker@example.invalid",
    background:
      "Recruiter placing registered dental hygienists with Ontario clinics since 2016; tracks hygienist vacancy durations and wage offers across Eastern Ontario.",
    sourceRecordId: "NS-CRM-0005",
  },
  {
    key: "fpa",
    name: "Sofia Lindqvist",
    title: "Former FP&A Manager",
    organization: "Another dental service organization",
    phone: "+1-555-0105",
    email: "sofia.lindqvist@example.invalid",
    background:
      "FP&A manager at a different dental service organization (not Northstar) from 2018 to 2024; built patient churn and same-clinic growth metrics for lender reporting.",
    sourceRecordId: "NS-CRM-0006",
  },
] as const;

export type NorthstarExpertKey = (typeof NORTHSTAR_EXPERTS)[number]["key"];

/** Claims located by exact passage text match (so the mock never invents a source passage). */
export const NORTHSTAR_CLAIMS = [
  {
    ref: "C1",
    passageMatch: "annual patient churn below 5%",
    assertion: "Annual patient churn is below 5%.",
    priority: 1,
    scope: "Clinics owned as of 31 Dec 2024; company-wide.",
    metric: "Annual patient churn: share of active patients at year start with no visit in the following 12 months (definition to be confirmed with management).",
    missing: ["Definition of 'active patient'", "Customer vs revenue churn", "Measurement period and cohort"],
    supporting: "Consistent clinic-level retention figures; recall-list data matching the company definition.",
    challenging: "Reports of patients leaving after service disruption; clinic-level attrition materially above 5% on a comparable basis.",
  },
  {
    ref: "C2",
    passageMatch: "spare chair capacity",
    assertion: "Clinics have spare capacity to grow visit volume 6% per year without additional hygienists.",
    priority: 2,
    scope: "Same-clinic growth for the owned network.",
    metric: "Hygiene and chair utilization by clinic; appointment availability lead times.",
    missing: ["Utilization measure (chair vs hygienist hours)", "Baseline year"],
    supporting: "Utilization well below capacity with stable staffing.",
    challenging: "Hygiene capacity constrained by vacancies; long rebooking lead times.",
  },
  {
    ref: "C3",
    passageMatch: "reduced appointment cancellations",
    assertion: "Centralized scheduling has reduced appointment cancellations and no-shows since 2023.",
    priority: 1,
    scope: "Network-wide, 2023 onward.",
    metric: "Clinic-initiated and patient-initiated cancellations per 100 booked appointments.",
    missing: ["Split between clinic-initiated and patient-initiated cancellations", "Treatment of rescheduled appointments"],
    supporting: "Falling cancellation rates in scheduling-system reports across clinics.",
    challenging: "Rising clinic-initiated cancellations at specific clinics; operational causes unrelated to scheduling.",
  },
  {
    ref: "C4",
    passageMatch: "Fee increases of 3-4% per year",
    assertion: "Fee increases of 3-4% per year can be implemented without measurable patient loss.",
    priority: 2,
    scope: "Insurance-reimbursed revenue.",
    metric: "Price change versus provincial fee guide; patient volume after fee changes.",
    missing: ["Share of revenue reimbursed by insurers", "Patient out-of-pocket share"],
    supporting: "Insurer reimbursement tracking fee-guide increases.",
    challenging: "Reimbursement caps below Northstar fees; patient sensitivity to balance billing.",
  },
  {
    ref: "C5",
    passageMatch: "hygienist turnover is in line",
    assertion: "Staffing is stable; hygienist turnover is in line with the Ontario industry average.",
    priority: 1,
    scope: "Hygienist workforce at owned clinics.",
    metric: "Annual hygienist turnover rate and vacancy duration.",
    missing: ["Industry benchmark source", "Vacancy definition"],
    supporting: "Turnover and vacancy durations at or below market benchmarks.",
    challenging: "Persistent hygienist vacancies or loss of senior hygienists.",
  },
];

export const NORTHSTAR_QUESTIONS = [
  {
    key: "q_staffing",
    text: "How would you describe hygienist staffing at the clinics you know, including any vacancies and how long they lasted?",
    purpose: "Test staffing stability (C5) and its operational effects.",
    claims: ["C5", "C2"],
    priority: 1,
  },
  {
    key: "q_capacity",
    text: "How much hygiene appointment capacity was available relative to demand, and did that change over time?",
    purpose: "Test spare capacity assumption (C2).",
    claims: ["C2"],
    priority: 1,
  },
  {
    key: "q_retention",
    text: "What do you know about how many patients stop visiting a clinic over a year, and how that is measured?",
    purpose: "Test the churn claim and its definition (C1).",
    claims: ["C1"],
    priority: 2,
  },
  {
    key: "q_cancellations",
    text: "In your experience, how often were appointments cancelled or rescheduled, and by whom?",
    purpose: "Test the cancellation claim (C3) from the patient or operator perspective.",
    claims: ["C3"],
    priority: 1,
  },
  {
    key: "q_pricing",
    text: "How do insurer reimbursement limits compare with typical annual fee increases at clinics like these?",
    purpose: "Test pricing headroom (C4).",
    claims: ["C4"],
    priority: 2,
  },
  {
    key: "q_patient_decision",
    text: "What, if anything, has influenced your decision to stay with or leave a dental provider?",
    purpose: "Understand retention drivers from the patient perspective (C1).",
    claims: ["C1"],
    priority: 2,
  },
];

export const NORTHSTAR_RANKINGS: {
  expert: NorthstarExpertKey;
  score: number;
  quote: string;
  rationale: string;
  claims: string[];
  recommended: boolean;
}[] = [
  {
    expert: "operator",
    score: 92,
    quote: "Responsible for hygienist scheduling, clinic staffing plans, and weekly cancellation reporting",
    rationale: "Directly managed the staffing and cancellation reporting that the capacity, scheduling, and staffing claims depend on.",
    claims: ["C2", "C3", "C5"],
    recommended: true,
  },
  {
    expert: "recruiter",
    score: 81,
    quote: "tracks hygienist vacancy durations and wage offers across Eastern Ontario",
    rationale: "Independent view of hygienist labour availability, relevant to staffing stability and capacity.",
    claims: ["C5", "C2"],
    recommended: true,
  },
  {
    expert: "insurer",
    score: 74,
    quote: "annual review of provincial dental fee guides and reimbursement limits",
    rationale: "Can assess whether planned fee increases are reimbursable without shifting cost to patients.",
    claims: ["C4"],
    recommended: true,
  },
  {
    expert: "fpa",
    score: 63,
    quote: "built patient churn and same-clinic growth metrics for lender reporting",
    rationale: "Can explain how churn is commonly defined, useful for comparing figures; has no Northstar-specific knowledge.",
    claims: ["C1"],
    recommended: false,
  },
  {
    expert: "customer",
    score: 58,
    quote: "Patient at the Northstar Kanata clinic from 2021 to early 2025",
    rationale: "First-hand patient experience at one clinic; anecdotal for retention and cancellations.",
    claims: ["C1", "C3"],
    recommended: false,
  },
  {
    expert: "competitor",
    score: 45,
    quote: "competes with two Northstar locations",
    rationale: "Local competitive context; limited direct knowledge of Northstar operations.",
    claims: ["C1", "C4"],
    recommended: false,
  },
];

export const NORTHSTAR_GAPS = [
  {
    description:
      "No available expert can speak to Northstar's company-wide churn calculation; management data or an FP&A interview at Northstar would be needed.",
    claims: ["C1"],
  },
];

// ---------------------------------------------------------------------------
// Interview fixtures: utterances keyed by question fixture key
// ---------------------------------------------------------------------------

export interface ScriptedUtterance {
  ref: string; // stable fixture reference, also used as the turn's source event id
  text: string;
}

/** Completed customer interview (historical fixture). Interviewer lines precede each answer. */
export const CUSTOMER_INTERVIEW: { questionKey: string; answer: ScriptedUtterance }[] = [
  {
    questionKey: "q_cancellations",
    answer: {
      ref: "customer:1",
      text: "I was a patient at the Kanata clinic from 2021 until early 2025. In my last year there, three of my hygiene appointments were cancelled by the clinic, usually a day or two before.",
    },
  },
  {
    questionKey: "q_patient_decision",
    answer: {
      ref: "customer:2",
      text: "The rebooking dates were six to eight weeks out. After the third cancellation I moved my family of four to an independent practice near my office. I don't know whether other patients did the same.",
    },
  },
  {
    questionKey: "q_staffing",
    answer: {
      ref: "customer:3",
      text: "The front desk said they were short on hygienists. That's what I was told; I never saw anything official.",
    },
  },
];

/** Operator interview script: the scripted respondent answers whichever question was last delivered. */
export const OPERATOR_SCRIPT: Record<string, ScriptedUtterance> = {
  q_staffing: {
    ref: "operator:1",
    text: "We had real staffing gaps. From mid-2024 we were running about four hygienist positions short across my eleven clinics, and two clinics, Kanata and Orléans, lost their senior hygienists. That cut how many hygiene appointments we could offer. At those two sites we were at maybe seventy percent of normal hygiene capacity for a couple of quarters.",
  },
  q_capacity: {
    ref: "operator:1b",
    text: "Outside Kanata and Orléans we had some room, but I wouldn't call it spare capacity in hygiene.",
  },
  q_retention: {
    ref: "operator:4",
    text: "I don't know the company-wide retention numbers. That was tracked by the finance team, not regional operations.",
  },
  f_locations: {
    ref: "operator:2",
    text: "It was mostly Kanata and Orléans, from about July 2024 through March 2025. We tracked clinic-initiated cancellations in the scheduling system, and at those two sites they roughly doubled over that period. Most of those were hygiene appointments, but I haven't seen an analysis tying each cancellation to a vacancy.",
  },
  f_disruption_types: {
    ref: "operator:3",
    text: "Most clinic-initiated cancellations were rebooked, maybe two-thirds. Some patients just waited longer. Actual patients leaving, at Kanata I'd estimate we lost around twelve percent of active hygiene patients over those three quarters. That's my estimate from recall lists, not an audited number.",
  },
  q_cancellations: {
    ref: "operator:5",
    text: "Network-wide I only saw my own region's reports, so I can't confirm the company-wide trend.",
  },
  q_pricing: {
    ref: "operator:6",
    text: "Pricing was set centrally. I can't really speak to insurer reimbursement.",
  },
};

export const OPERATOR_DEFAULT: ScriptedUtterance = {
  ref: "operator:default",
  text: "I'm not able to speak to that from my role.",
};

/** Follow-up questions the mock controller proposes for the operator interview. */
export const FOLLOWUPS = {
  f_locations: {
    text: "Which locations and time periods were affected by the staffing gaps, and what records, if any, connect those gaps with appointment cancellations?",
    purpose: "Establish where and when disruption occurred and what evidence links staffing to cancellations (C3, C5).",
    claims: ["C3", "C5"],
  },
  f_disruption_types: {
    text: "Of the affected appointments, how many were cancelled outright, rescheduled, or lost to reduced capacity, and how many patients actually stopped coming?",
    purpose: "Distinguish cancellations, rescheduling, reduced capacity, and actual patient attrition (C1, C3).",
    claims: ["C1", "C3"],
  },
};
