// Shared data contracts for the backend, the browser, and model outputs.
// One set of types is used for live and simulated operation.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerations: three deliberately separate state families
// ---------------------------------------------------------------------------

export const COVERAGE = ["pending", "partially_answered", "answered", "unable_to_answer", "skipped"] as const;
export type Coverage = (typeof COVERAGE)[number];

export const DELIVERY_STATES = ["queued", "speaking", "completed", "interrupted", "cancelled", "failed", "unknown"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const ASSESSMENTS = [
  "unassessed",
  "supported_by_interview",
  "contradicted_by_interview",
  "mixed_evidence",
  "inconclusive",
] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

export const ASSESSMENT_LABELS: Record<Assessment, string> = {
  unassessed: "Not yet assessed",
  supported_by_interview: "Supported by interview evidence",
  contradicted_by_interview: "Contradicted by interview evidence",
  mixed_evidence: "Mixed interview evidence",
  inconclusive: "Inconclusive (evidence not yet comparable)",
};

export const BASES = ["direct_observation", "estimate", "opinion", "secondhand_report"] as const;
export type EvidenceBasis = (typeof BASES)[number];

export const RELATIONS = ["supports", "challenges", "unresolved"] as const;
export type Relation = (typeof RELATIONS)[number];

export const COMPARABILITY = ["comparable", "not_comparable", "unclear"] as const;
export type Comparability = (typeof COMPARABILITY)[number];

export const INTERVIEW_MODES = ["synthetic", "live_voice", "live_voice_mock_reasoning", "fixture"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const MODE_LABELS: Record<InterviewMode, string> = {
  synthetic: "Fully synthetic demo (scripted respondent, mock reasoning, no audio)",
  live_voice: "Live browser voice with real reasoning",
  live_voice_mock_reasoning: "Live browser voice with MOCK reasoning",
  fixture: "Synthetic completed fixture",
};

export const LIFECYCLES = [
  "ready",
  "awaiting_participant",
  "consent_pending",
  "active",
  "paused",
  "ended",
  "interrupted",
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];
export const LIVE_LIFECYCLES: Lifecycle[] = ["awaiting_participant", "consent_pending", "active", "paused"];

export type ConsentState = "pending" | "accepted" | "declined" | "withdrawn";
/** verbal: the participant's spoken answer to the consent request; control: the on-screen control; scripted: synthetic demo respondent. */
export type ConsentMethod = "verbal" | "control" | "scripted";
export type QuestionOrigin = "planner" | "consultant" | "controller" | "copilot";
export type Speaker = "expert" | "interviewer" | "system";

// ---------------------------------------------------------------------------
// Records (API shapes)
// ---------------------------------------------------------------------------

export interface ProjectRecord {
  id: string;
  company: string;
  objective: string;
  owner: string;
  stateRevision: number;
  thesisVersion: number;
  currentPlanId: string | null;
  isSynthetic: boolean;
  lastReviewedRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PassageRecord {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface DocumentRecord {
  id: string;
  projectId: string;
  kind: "pasted" | "docx";
  filename: string | null;
  sizeBytes: number;
  thesisVersion: number;
  extractedText: string;
  isCurrent: boolean;
  createdAt: string;
  passages: PassageRecord[];
}

export interface ClaimRecord {
  id: string;
  projectId: string;
  code: string;
  assertion: string;
  passageIds: string[];
  priority: number;
  scopeDefinition: string;
  metricDefinition: string;
  missingDefinitions: string[];
  evidenceSupporting: string;
  evidenceChallenging: string;
  assessment: Assessment;
  assessmentRationale: string;
  status: "active" | "retired";
  thesisVersion: number;
  gaps: { description: string; source: string; createdAt: string }[];
  updatedAt: string;
}

export interface ExpertRecord {
  id: string;
  projectId: string;
  name: string;
  phone: string;
  email: string;
  title: string;
  organization: string;
  background: string;
  source: "manual" | "csv" | "demo";
  sourceSystem: string;
  sourceRecordId: string;
  retrievedAt: string | null;
  isSynthetic: boolean;
  deleted: boolean;
  createdAt: string;
}

export interface RankingRecord {
  id: string;
  planId: string;
  expertId: string;
  rank: number;
  score: number;
  rationale: string;
  backgroundQuote: string;
  claimIds: string[];
  recommended: boolean;
  selected: boolean;
}

export interface PlanRecord {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  producedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  gaps: { description: string; claimIds: string[] }[];
  snapshot: { questionId: string; revision: number; priority: number }[] | null;
  thesisVersion: number;
  createdAt: string;
}

export interface QuestionRevision {
  revision: number;
  text: string;
  purpose: string;
  createdBy: string;
  createdAt: string;
}

export interface QuestionRecord {
  id: string;
  projectId: string;
  code: string;
  currentRevision: number;
  text: string;
  purpose: string;
  priority: number;
  claimIds: string[];
  origin: QuestionOrigin;
  isOriginal: boolean;
  status: "active" | "removed";
  fixtureKey: string | null;
  createdInInterviewId: string | null;
  revisions: QuestionRevision[];
  createdAt: string;
}

export interface InterviewRecord {
  id: string;
  projectId: string;
  expertId: string;
  planId: string | null;
  planVersion: number | null;
  mode: InterviewMode;
  transport: "simulated" | "browser_ws" | "fixture";
  lifecycle: Lifecycle;
  consent: ConsentState;
  consentMethod: ConsentMethod | null;
  consentTurnId: string | null;
  consentAt: string | null;
  pauseReason: string | null;
  terminationReason: string | null;
  controlRevision: number;
  generation: number;
  controllerCursor: number;
  joinTokenExpiresAt: string | null;
  localTest: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface CoverageRecord {
  id: string; // `${interviewId}:${questionId}`
  interviewId: string;
  questionId: string;
  coverage: Coverage;
  rationale: string;
  answerTurnIds: string[];
  updatedAt: string;
}

export interface DeliveryRecord {
  id: string;
  interviewId: string;
  kind: "question" | "intro" | "clarification" | "closing";
  questionId: string | null;
  questionRevision: number | null;
  authorizedText: string;
  actualTranscript: string | null;
  providerResponseId: string | null;
  providerItemId: string | null;
  generation: number;
  state: DeliveryState;
  playedMs: number | null;
  interruptionDetail: string | null;
  decisionId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TurnVersion {
  version: number;
  text: string;
  reason: "asr" | "fixture" | "typed" | "correction" | "assistant_transcript";
  createdAt: string;
}

export interface TurnRecord {
  id: string;
  interviewId: string;
  seq: number;
  speaker: Speaker;
  channel: "interview";
  sourceEventId: string | null;
  inputItemId: string | null;
  deliveryId: string | null;
  contextDeliveryId: string | null;
  finality: "final" | "pending" | "missing";
  afterEnd: boolean;
  currentVersion: number;
  text: string;
  versions: TurnVersion[];
  startedAt: string;
  endedAt: string | null;
}

export interface EvidenceLink {
  claimId: string;
  relation: Relation;
  comparability: Comparability;
  note: string;
  disputed: boolean;
}

export interface EvidenceRecord {
  id: string;
  projectId: string;
  interviewId: string;
  expertId: string;
  turnId: string;
  turnVersion: number;
  spanStart: number;
  spanEnd: number;
  quote: string;
  statement: string;
  basis: EvidenceBasis;
  period: string | null;
  population: string | null;
  metric: string | null;
  unit: string | null;
  calcBasis: string | null;
  value: string | null;
  status: "active" | "superseded" | "retracted" | "invalidated";
  supersededBy: string | null;
  statusReason: string | null;
  links: EvidenceLink[];
  reviewStatus: "unreviewed" | "accepted" | "flagged";
  decisionId: string | null;
  createdAt: string;
}

export interface FindingRecord {
  id: string;
  projectId: string;
  interviewId: string | null;
  decisionId: string | null;
  kind: "possible_constraint" | "possible_consequence" | "pattern" | "other";
  text: string;
  claimIds: string[];
  evidenceIds: string[];
  status: "proposed" | "accepted" | "flagged";
  reviewNote: string | null;
  nextEvidenceNeeded: string | null;
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  interviewId: string;
  requestId: string;
  trigger: string;
  expectedRevision: number;
  generation: number;
  planVersion: number | null;
  transcriptCursor: number;
  provider: string;
  result: "applied" | "applied_held" | "rejected_stale" | "rejected_invalid" | "cancelled" | "error";
  rejectionReasons: string[];
  rationale: string;
  nextAction: "ask" | "wait" | "end" | null;
  nextQuestionId: string | null;
  latencyMs: number;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  action: string;
  actor: string;
  rationale: string;
  priorVersion: unknown;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  kind: "instruction" | "note";
  text: string;
  status: "active" | "retired";
  createdBy: string;
  createdAt: string;
}

export interface HandoffRecord {
  id: string;
  projectId: string;
  summary: string;
  sourceRevision: number;
  evidenceRefs: string[];
  unresolved: string[];
  nextSteps: string[];
  stale: boolean;
  createdAt: string;
}

export interface CopilotMessageRecord {
  id: string;
  projectId: string;
  role: "consultant" | "assistant" | "tool";
  channel: "text" | "voice";
  text: string;
  toolName: string | null;
  navigation: NavigationTarget | null;
  provider: string;
  createdAt: string;
}

export interface DirectiveRecord {
  id: string;
  projectId: string;
  interviewId: string | null;
  instruction: string;
  claimIds: string[];
  status: "pending" | "consumed" | "dismissed";
  createdBy: string;
  createdAt: string;
}

export interface MetricRecord {
  id: string;
  interviewId: string;
  turnId: string | null;
  name: string;
  ms: number;
  createdAt: string;
}

export type NavigationTarget =
  | { kind: "turn"; interviewId: string; turnId: string; version: number; spanStart: number; spanEnd: number }
  | { kind: "passage"; documentId: string; passageId: string }
  | { kind: "claim"; claimId: string }
  | { kind: "page"; page: "overview" | "experts" | "plan" | "live" | "findings" };

export interface Snapshot {
  project: ProjectRecord;
  documents: Record<string, DocumentRecord>;
  claims: Record<string, ClaimRecord>;
  experts: Record<string, ExpertRecord>;
  plans: Record<string, PlanRecord>;
  rankings: Record<string, RankingRecord>;
  questions: Record<string, QuestionRecord>;
  interviews: Record<string, InterviewRecord>;
  coverage: Record<string, CoverageRecord>;
  deliveries: Record<string, DeliveryRecord>;
  turns: Record<string, TurnRecord>;
  evidence: Record<string, EvidenceRecord>;
  findings: Record<string, FindingRecord>;
  decisions: Record<string, DecisionRecord>;
  reviews: Record<string, ReviewRecord>;
  memory: Record<string, MemoryRecord>;
  handoffs: Record<string, HandoffRecord>;
  copilot: Record<string, CopilotMessageRecord>;
  directives: Record<string, DirectiveRecord>;
  metrics: Record<string, MetricRecord>;
}

export type CollectionName = Exclude<keyof Snapshot, "project">;
export const COLLECTIONS: CollectionName[] = [
  "documents",
  "claims",
  "experts",
  "plans",
  "rankings",
  "questions",
  "interviews",
  "coverage",
  "deliveries",
  "turns",
  "evidence",
  "findings",
  "decisions",
  "reviews",
  "memory",
  "handoffs",
  "copilot",
  "directives",
  "metrics",
];

/** A committed state event. `revision` is the project's state revision after the commit. */
export interface StateEvent {
  id: string;
  projectId: string;
  revision: number;
  type: string;
  createdAt: string;
  project: ProjectRecord;
  upserts: Partial<{ [K in CollectionName]: Snapshot[K][string][] }>;
  removed: Partial<Record<CollectionName, string[]>>;
}

export interface Capabilities {
  reasoningProvider: "anthropic" | "mock";
  reasoningModel: string | null;
  bosonConfigured: boolean;
  allowLiveVoiceMockReasoning: boolean;
  accessControl: boolean;
  modes: { mode: InterviewMode; available: boolean; label: string; requirement: string | null }[];
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const CreateProjectInput = z.object({
  company: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(2000),
  thesisText: z.string().max(200_000).optional(),
});

export const ExpertInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).default(""),
  email: z.string().trim().max(200).default(""),
  title: z.string().trim().max(200).default(""),
  organization: z.string().trim().max(200).default(""),
  background: z.string().trim().min(1).max(5000),
  sourceSystem: z.string().trim().max(100).default(""),
  sourceRecordId: z.string().trim().max(200).default(""),
  retrievedAt: z.string().trim().max(40).nullable().default(null),
  isSynthetic: z.boolean().default(false),
});
export type ExpertInputT = z.infer<typeof ExpertInput>;

export const QuestionEditInput = z.object({
  text: z.string().trim().min(3).max(1000).optional(),
  purpose: z.string().trim().max(1000).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  claimIds: z.array(z.string()).max(20).optional(),
  status: z.enum(["active", "removed"]).optional(),
});

export const NewQuestionInput = z.object({
  text: z.string().trim().min(3).max(1000),
  purpose: z.string().trim().max(1000).default(""),
  priority: z.number().int().min(1).max(5).default(2),
  claimIds: z.array(z.string()).max(20).default([]),
  interviewId: z.string().nullable().default(null),
});

export const ClaimEditInput = z.object({
  assertion: z.string().trim().min(3).max(2000).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  scopeDefinition: z.string().max(2000).optional(),
  metricDefinition: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Model output schemas (validated server-side; shape + semantics)
// ---------------------------------------------------------------------------

const nullableText = z.string().max(400).nullable();

export const PlannerProposalSchema = z.object({
  claims: z
    .array(
      z.object({
        ref: z.string().min(1).max(20),
        assertion: z.string().min(3).max(600),
        passage_ids: z.array(z.string()).min(1).max(6),
        priority: z.number().int().min(1).max(5),
        scope_definition: z.string().max(600),
        metric_definition: z.string().max(600),
        missing_definitions: z.array(z.string().max(200)).max(8),
        evidence_supporting: z.string().max(600),
        evidence_challenging: z.string().max(600),
      }),
    )
    .min(1)
    .max(15),
  expert_rankings: z
    .array(
      z.object({
        expert_id: z.string(),
        score: z.number().int().min(0).max(100),
        rationale: z.string().max(600),
        background_quote: z.string().min(3).max(400),
        claim_refs: z.array(z.string()).max(15),
        recommended: z.boolean(),
      }),
    )
    .max(100),
  questions: z
    .array(
      z.object({
        text: z.string().min(5).max(500),
        purpose: z.string().max(400),
        claim_refs: z.array(z.string()).min(1).max(6),
        priority: z.number().int().min(1).max(5),
        fixture_key: z.string().max(40).nullable(),
      }),
    )
    .min(1)
    .max(40),
  gaps: z.array(z.object({ description: z.string().max(500), claim_refs: z.array(z.string()).max(10) })).max(15),
});
export type PlannerProposal = z.infer<typeof PlannerProposalSchema>;

export const ControllerProposalSchema = z.object({
  observations: z
    .array(
      z.object({
        ref: z.string().min(1).max(20),
        turn_id: z.string(),
        quote: z.string().min(1).max(1200),
        statement: z.string().min(1).max(600),
        basis: z.enum(BASES),
        period: nullableText,
        population: nullableText,
        metric: nullableText,
        unit: nullableText,
        calc_basis: nullableText,
        value: nullableText,
        claim_links: z
          .array(
            z.object({
              claim_id: z.string(),
              relation: z.enum(RELATIONS),
              comparability: z.enum(COMPARABILITY),
              note: z.string().max(400),
            }),
          )
          .max(6),
        supersedes_evidence_ids: z.array(z.string()).max(5),
        retracts_evidence_ids: z.array(z.string()).max(5),
      }),
    )
    .max(10),
  coverage_updates: z
    .array(
      z.object({
        question_id: z.string(),
        coverage: z.enum(COVERAGE),
        rationale: z.string().max(400),
        answer_turn_ids: z.array(z.string()).max(10),
      }),
    )
    .max(20),
  new_questions: z
    .array(
      z.object({
        ref: z.string().min(1).max(20),
        text: z.string().min(5).max(500),
        purpose: z.string().max(400),
        claim_ids: z.array(z.string()).max(6),
        priority: z.number().int().min(1).max(5),
        fixture_key: z.string().max(40).nullable(),
      }),
    )
    .max(3),
  priority_changes: z.array(z.object({ question_id: z.string(), priority: z.number().int().min(1).max(5) })).max(10),
  evidence_gaps: z.array(z.object({ claim_id: z.string(), description: z.string().min(3).max(500) })).max(5),
  findings: z
    .array(
      z.object({
        kind: z.enum(["possible_constraint", "possible_consequence", "pattern", "other"]),
        text: z.string().min(5).max(600),
        claim_ids: z.array(z.string()).max(6),
        evidence_refs: z.array(z.string()).min(1).max(10),
      }),
    )
    .max(3),
  consumed_directive_ids: z.array(z.string()).max(10),
  rationale: z.string().min(1).max(1200),
  next_action: z.object({
    type: z.enum(["ask", "wait", "end"]),
    question_ref: z.string().nullable(),
    question_revision: z.number().int().nullable(),
    delivery_directive: z.string().max(400).nullable(),
  }),
});
export type ControllerProposal = z.infer<typeof ControllerProposalSchema>;

export const CopilotReplySchema = z.object({ reply: z.string().min(1).max(4000) });
