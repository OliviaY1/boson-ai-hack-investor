// Composition root: database, event hub, providers, engine, and cross-cutting services.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Capabilities, InterviewMode } from "../../shared/contracts";
import { MODE_LABELS } from "../../shared/contracts";
import type { AppConfig } from "./config";
import { migrate, openDb, type DB } from "./db/db";
import { COPILOT_TOOLS, makeToolExecutor } from "./domain/copilotTools";
import { commit, DomainError, EventHub, type Ctx } from "./domain/events";
import { appendTurn, createDelivery, createInterview, getInterview, recoverAfterRestart, transitionDelivery } from "./domain/interviews";
import { saveCopilotMessage, saveHandoff } from "./domain/memory";
import { approvePlan, runPlanner } from "./domain/planning";
import { addThesisDocument, createProject, importExperts } from "./domain/projects";
import { parseExpertCsv } from "./ingest/csv";
import { extractDocxText } from "./ingest/docx";
import { InterviewEngine } from "./interview/engine";
import { AnthropicReasoningProvider } from "./providers/anthropic";
import { MockReasoningProvider } from "./providers/mock";
import { CUSTOMER_INTERVIEW, NORTHSTAR_PROJECT } from "./providers/northstarFixture";
import type { ReasoningProvider } from "./providers/types";
import { ProviderError } from "./providers/types";
import { buildContextPacket } from "./voice/copilotVoice";
import type { VoiceSettings } from "./voice/interviewVoice";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = [path.resolve(here, "../.."), path.resolve(here, ".."), process.cwd()].find((p) => {
  try {
    readFileSync(path.join(p, "fixtures/northstar/contacts.csv"));
    return true;
  } catch {
    return false;
  }
}) ?? process.cwd();

export class Services {
  readonly db: DB;
  readonly ctx: Ctx;
  readonly mock: MockReasoningProvider;
  readonly real: ReasoningProvider | null;
  readonly engine: InterviewEngine;

  constructor(
    readonly config: AppConfig,
    opts: { real?: ReasoningProvider | null; mock?: MockReasoningProvider } = {},
  ) {
    this.db = openDb(config.dataDir);
    migrate(this.db);
    this.ctx = { db: this.db, hub: new EventHub() };
    this.mock = opts.mock ?? new MockReasoningProvider();
    this.real =
      opts.real !== undefined
        ? opts.real
        : config.anthropicApiKey
          ? new AnthropicReasoningProvider(config.anthropicApiKey, config.reasoningModel, config.reasoningFallbacks, config.providerTimeoutMs)
          : null;
    this.engine = new InterviewEngine(this.ctx, { real: this.real, mock: this.mock }, config);
  }

  /** Startup: interviews that were live when the process stopped are marked interrupted (resumable). */
  recover(): string[] {
    return recoverAfterRestart(this.ctx);
  }

  /** Reasoning provider for planning and the text copilot: the configured real provider, else the labelled mock. */
  get reasoning(): ReasoningProvider {
    return this.real ?? this.mock;
  }

  voiceSettings(): VoiceSettings | null {
    if (!this.config.bosonApiKey) return null;
    return {
      url: this.config.bosonRealtimeUrl,
      apiKey: this.config.bosonApiKey,
      model: this.config.bosonModel,
      voice: this.config.bosonVoice,
      transcriptionModel: this.config.transcriptionModel,
      transcriptionTimeoutMs: this.config.transcriptionTimeoutMs,
    };
  }

  capabilities(): Capabilities {
    const boson = !!this.config.bosonApiKey;
    const real = !!this.real;
    const modes: Capabilities["modes"] = [
      { mode: "synthetic", available: true, label: MODE_LABELS.synthetic, requirement: null },
      {
        mode: "live_voice",
        available: boson && real,
        label: MODE_LABELS.live_voice,
        requirement: boson && real ? null : `Requires ${[!boson && "BOSON_API_KEY", !real && "ANTHROPIC_API_KEY"].filter(Boolean).join(" and ")} on the backend, plus microphone permission.`,
      },
      {
        mode: "live_voice_mock_reasoning",
        available: boson && this.config.allowLiveVoiceMockReasoning,
        label: MODE_LABELS.live_voice_mock_reasoning,
        requirement:
          boson && this.config.allowLiveVoiceMockReasoning
            ? null
            : `Requires ${[!boson && "BOSON_API_KEY", !this.config.allowLiveVoiceMockReasoning && "ALLOW_LIVE_VOICE_MOCK_REASONING=true"].filter(Boolean).join(" and ")}.`,
      },
    ];
    return {
      reasoningProvider: real ? "anthropic" : "mock",
      reasoningModel: real ? this.config.reasoningModel : null,
      bosonConfigured: boson,
      allowLiveVoiceMockReasoning: this.config.allowLiveVoiceMockReasoning,
      accessControl: !!this.config.accessToken,
      modes,
    };
  }

  assertModeAvailable(mode: InterviewMode) {
    const m = this.capabilities().modes.find((x) => x.mode === mode);
    if (!m) throw new DomainError(400, "Unknown interview mode.", "invalid_mode");
    if (!m.available) throw new DomainError(409, `${m.label} is unavailable: ${m.requirement}`, "mode_unavailable");
  }

  async copilotText(projectId: string, message: string) {
    const text = message.trim();
    if (!text || text.length > 2000) throw new DomainError(400, "Message must be 1-2000 characters.", "invalid_input");
    const provider = this.reasoning;
    saveCopilotMessage(this.ctx, projectId, { role: "consultant", channel: "text", text, provider: provider.name });
    const history = (
      this.db.prepare("SELECT role, text FROM copilot_messages WHERE project_id = ? AND channel = 'text' AND role != 'tool' ORDER BY created_at DESC LIMIT 11").all(projectId) as any[]
    )
      .slice(1)
      .reverse()
      .map((r) => ({ role: r.role as "consultant" | "assistant", text: r.text }));
    const exec = makeToolExecutor(this.ctx, projectId, "copilot", { onResearchChange: (pid) => this.engine.onResearchChange(pid) });
    try {
      const out = await provider.copilot({ message: text, history, contextPacket: buildContextPacket(this.ctx, projectId) }, COPILOT_TOOLS, exec);
      for (const c of out.toolCalls) saveCopilotMessage(this.ctx, projectId, { role: "tool", channel: "text", text: c.result.summary, toolName: c.name, navigation: c.result.navigation ?? null, provider: provider.name });
      saveCopilotMessage(this.ctx, projectId, { role: "assistant", channel: "text", text: out.reply, navigation: out.navigation, provider: provider.name });
      return out;
    } catch (e) {
      const msg = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
      // Degraded capability is explained; nothing synthetic is substituted.
      saveCopilotMessage(this.ctx, projectId, { role: "assistant", channel: "text", text: `The ${provider.name} reasoning provider failed: ${msg}. No changes were made.`, provider: provider.name });
      throw new DomainError(502, `Copilot provider failed: ${msg}`, "provider_failed");
    }
  }

  /** Creates a new fictional Northstar project through the same ingestion, planning, and controller paths. */
  async seedNorthstar(): Promise<string> {
    const fx = path.join(REPO_ROOT, "fixtures/northstar");
    const projectId = createProject(this.ctx, { company: NORTHSTAR_PROJECT.company, objective: NORTHSTAR_PROJECT.objective, isSynthetic: true });
    const docx = readFileSync(path.join(fx, "northstar_thesis.docx"));
    const text = await extractDocxText(docx, this.config.maxUploadBytes);
    addThesisDocument(this.ctx, this.config.dataDir, projectId, { kind: "docx", text, filename: "northstar_thesis.docx", raw: docx });
    const csv = parseExpertCsv(readFileSync(path.join(fx, "contacts.csv")));
    if (csv.errors.length) throw new Error(`Fixture CSV invalid: ${JSON.stringify(csv.errors)}`);
    importExperts(this.ctx, projectId, csv.valid.map((v) => v.expert), "csv");
    await runPlanner(this.ctx, this.mock, projectId);
    approvePlan(this.ctx, projectId, "demo seed (synthetic)", "Seeded demonstration plan");
    await this.loadCustomerFixture(projectId);
    saveHandoff(this.ctx, projectId);
    return projectId;
  }

  /** Completed historical customer interview, extracted through the controller in extract-only mode. */
  async loadCustomerFixture(projectId: string): Promise<string> {
    const expert = this.db.prepare("SELECT id FROM experts WHERE project_id = ? AND name = 'Priya Raman'").get(projectId) as any;
    const interviewId = createInterview(this.ctx, projectId, expert.id, "fixture", false);
    const iv = getInterview(this.ctx, interviewId);
    commit(this.ctx, projectId, "fixture.started", (cs) => {
      this.db.prepare("UPDATE interviews SET lifecycle = 'active', consent = 'accepted', started_at = ? WHERE id = ?").run(new Date(Date.now() - 86400_000 * 3).toISOString(), interviewId);
      cs.touch("interviews", interviewId);
    });
    for (const step of CUSTOMER_INTERVIEW) {
      const q = this.db
        .prepare("SELECT q.id, q.current_revision, r.text FROM questions q JOIN question_revisions r ON r.question_id = q.id AND r.revision = q.current_revision WHERE q.project_id = ? AND q.fixture_key = ?")
        .get(projectId, step.questionKey) as any;
      commit(this.ctx, projectId, "fixture.turns", (cs) => {
        const d = createDelivery(this.ctx, cs, interviewId, { kind: "question", questionId: q.id, questionRevision: q.current_revision, text: q.text, decisionId: null });
        transitionDelivery(this.ctx, cs, d, "speaking", { providerResponseId: `fixture_${d}` });
        appendTurn(this.ctx, cs, { interviewId, speaker: "interviewer", text: q.text, finality: "final", reason: "fixture", deliveryId: d, sourceEventId: `fixture:q:${step.answer.ref}` });
        transitionDelivery(this.ctx, cs, d, "completed", { actualTranscript: q.text, detail: "synthetic fixture" });
        appendTurn(this.ctx, cs, { interviewId, speaker: "expert", text: step.answer.text, finality: "final", reason: "fixture", contextDeliveryId: d, sourceEventId: `fixture:${step.answer.ref}` });
      });
      await this.engine.enqueue(interviewId, "fixture_load", "extract_only");
    }
    commit(this.ctx, projectId, "fixture.completed", (cs) => {
      this.db.prepare("UPDATE interviews SET lifecycle = 'ended', termination_reason = 'fixture_completed', ended_at = ? WHERE id = ?").run(new Date(Date.now() - 86400_000 * 3 + 1800_000).toISOString(), interviewId);
      cs.touch("interviews", interviewId);
    });
    void iv;
    return interviewId;
  }

  close() {
    this.db.close();
  }
}
