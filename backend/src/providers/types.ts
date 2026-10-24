import type { Coverage, NavigationTarget } from "../../../shared/contracts";

export interface PlannerInput {
  company: string;
  objective: string;
  passages: { id: string; text: string }[];
  experts: { id: string; name: string; title: string; organization: string; background: string }[];
  projectInstructions: string[];
}

export interface EnvelopeTurn {
  id: string;
  seq: number;
  speaker: "expert" | "interviewer" | "system";
  version: number;
  text: string;
  contextQuestionId: string | null;
  fixtureRef: string | null;
}

export interface ControllerEnvelope {
  requestId: string;
  interviewId: string;
  expectedRevision: number;
  planVersion: number | null;
  transcriptCursor: number;
  generation: number;
  turnVersions: Record<string, number>;
  mode: "interview" | "extract_only";
  trigger: string;
  context: {
    project: { company: string; objective: string; instructions: string[] };
    expert: { id: string; name: string; title: string; background: string };
    claims: { id: string; code: string; assertion: string; metricDefinition: string; scopeDefinition: string; assessment: string; gaps: string[] }[];
    questions: {
      id: string;
      code: string;
      revision: number;
      text: string;
      purpose: string;
      priority: number;
      claimIds: string[];
      coverage: Coverage;
      origin: string;
      fixtureKey: string | null;
      completedDeliveries: number;
      lastDeliveryState: string | null;
      askedSinceLastExpertTurn: boolean;
    }[];
    newTurns: EnvelopeTurn[];
    recentTurns: EnvelopeTurn[];
    awaitingAnswerQuestionId: string | null;
    existingEvidence: { id: string; sameInterview: boolean; turnId: string; fixtureRef: string | null; statement: string; claimIds: string[]; status: string }[];
    directives: { id: string; instruction: string; claimIds: string[] }[];
    relevantClaimIds: string[];
    lifecycle: string;
    limits: { maxNewQuestionsPerDecision: number; remainingFollowUps: number };
  };
}

export interface CopilotToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface CopilotToolResult {
  summary: string;
  detail?: unknown;
  navigation?: NavigationTarget | null;
  error?: string;
}

export interface CopilotTurnInput {
  message: string;
  history: { role: "consultant" | "assistant"; text: string }[];
  contextPacket: string;
}

export interface CopilotTurnOutput {
  reply: string;
  toolCalls: { name: string; args: unknown; result: CopilotToolResult }[];
  navigation: NavigationTarget | null;
}

export type ToolExecutor = (name: string, args: unknown) => Promise<CopilotToolResult>;

export interface ReasoningProvider {
  readonly name: "anthropic" | "mock";
  readonly model: string | null;
  plan(input: PlannerInput): Promise<unknown>;
  control(envelope: ControllerEnvelope): Promise<unknown>;
  copilot(input: CopilotTurnInput, tools: CopilotToolSpec[], exec: ToolExecutor): Promise<CopilotTurnOutput>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
  ) {
    super(message);
  }
}
