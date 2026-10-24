export type ProjectStatus =
  "Draft" | "Planning" | "Ready for Interviews" | "In Progress" | "Completed";

export type ExpertSource = "GLG" | "AlphaSights" | "Third Bridge" | "Custom";

export interface Expert {
  id: string;
  name: string;
  title: string;
  phone: string;
  description: string;
  source: ExpertSource;
}

export interface ExpertNetwork {
  id: Exclude<ExpertSource, "Custom">;
  name: string;
  description: string;
  connected: boolean;
}

export interface InvestmentHypothesis {
  id: string;
  title: string;
  description: string;
  evidence: string;
  /** e.g. "New" or "Refined from H3" for hypotheses proposed after a research round. */
  origin?: string;
  /** Findings that prompted this hypothesis. */
  basisFindingIds?: string[];
  /** Research round in which the hypothesis was introduced (1 for the original thesis). */
  round?: number;
}

export interface PlanQuestion {
  id: string;
  text: string;
}

export interface PlanExpert {
  expertId: string;
  reason: string;
  hypothesisIds: string[];
  objectives: string;
  questions: PlanQuestion[];
}

export interface ResearchPlan {
  hypotheses: InvestmentHypothesis[];
  experts: PlanExpert[];
  approved: boolean;
}

export interface ResearchRound {
  plan: ResearchPlan;
  interviews: Interview[];
}

export type InterviewStatus = "Not Started" | "In Progress" | "Paused" | "Completed";

export interface InterviewQuestion {
  id: string;
  text: string;
  status: "pending" | "current" | "answered";
  added?: boolean;
}

export interface TranscriptTurn {
  id: string;
  speaker: "ai" | "expert";
  text: string;
  time: string;
  questionId?: string;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  hypothesisId: string;
  interviewId: string;
  turnId: string;
  quote: string;
  sentiment: "support" | "contradict" | "neutral";
}

export interface Interview {
  id: string;
  expertId: string;
  status: InterviewStatus;
  topic: string;
  questions: InterviewQuestion[];
  transcript: TranscriptTurn[];
  findings: Finding[];
}

export interface FindingReview {
  status?: "accepted" | "flagged" | undefined;
  note?: string | undefined;
}

export interface DiligenceProject {
  id: string;
  company: string;
  thesis: string;
  status: ProjectStatus;
  networks: ExpertNetwork[];
  experts: Expert[];
  plan?: ResearchPlan;
  interviews: Interview[];
  reviews: Record<string, FindingReview>;
  /** Network experts the consultant chose to include; custom experts are always included. */
  selectedExpertIds?: string[];
  /** Completed earlier research rounds; `plan` and `interviews` hold the current round. */
  pastRounds?: ResearchRound[];
  updatedAt: string;
}
