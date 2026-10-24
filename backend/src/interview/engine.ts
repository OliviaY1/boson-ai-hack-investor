// The interview engine: one serialized controller queue per interview, optimistic revision checks,
// and dispatch of authorized deliveries to the interview's transport (simulated or live browser voice).
import type { AppConfig } from "../config";
import { applyProposal, buildEnvelope, parseProposal, recordFailedDecision, validateProposal } from "../domain/controller";
import { commit, DomainError, type Ctx } from "../domain/events";
import {
  addMetric,
  appendTurn,
  createDelivery,
  endInterview,
  getInterview,
  lastStartedDelivery,
  pauseInterview,
  recordConsent,
  resumeInterview,
  transitionDelivery,
} from "../domain/interviews";
import { CLOSING_TEXT, INTRO_TEXT } from "../providers/prompts";
import type { ReasoningProvider } from "../providers/types";
import { OPERATOR_DEFAULT, OPERATOR_SCRIPT } from "../providers/northstarFixture";

export interface InterviewTransport {
  readonly kind: "simulated" | "browser_ws";
  deliver(deliveryId: string): void;
  cancelAll(reason: string): void;
}

export interface EngineProviders {
  real: ReasoningProvider | null;
  mock: ReasoningProvider;
}

export class InterviewEngine {
  private queues = new Map<string, Promise<void>>();
  private staleStreak = new Map<string, number>();
  private transports = new Map<string, InterviewTransport>();
  readonly simulated: SimulatedTransport;

  constructor(
    readonly ctx: Ctx,
    readonly providers: EngineProviders,
    readonly config: AppConfig,
  ) {
    this.simulated = new SimulatedTransport(this);
  }

  providerFor(mode: string): ReasoningProvider {
    if (mode === "live_voice") {
      if (!this.providers.real) throw new DomainError(503, "Live voice with real reasoning requires ANTHROPIC_API_KEY.", "reasoning_unavailable");
      return this.providers.real;
    }
    return this.providers.mock;
  }

  attachTransport(interviewId: string, t: InterviewTransport) {
    this.transports.set(interviewId, t);
  }
  detachTransport(interviewId: string, t: InterviewTransport) {
    if (this.transports.get(interviewId) === t) this.transports.delete(interviewId);
  }
  transportFor(interviewId: string): InterviewTransport | null {
    const iv = getInterview(this.ctx, interviewId);
    if (iv.transport === "simulated") return this.simulated;
    return this.transports.get(interviewId) ?? null;
  }

  /** Serialize controller work per interview. Resolves when this run (and earlier ones) finish. */
  enqueue(interviewId: string, trigger: string, mode: "interview" | "extract_only" = "interview", onlyTurnIds?: string[]): Promise<void> {
    const prev = this.queues.get(interviewId) ?? Promise.resolve();
    const next = prev
      .then(() => this.runController(interviewId, trigger, mode, onlyTurnIds))
      .catch((e) => console.error(`[engine] controller run failed for ${interviewId}:`, e));
    this.queues.set(interviewId, next);
    return next;
  }

  whenIdle(interviewId: string): Promise<void> {
    return this.queues.get(interviewId) ?? Promise.resolve();
  }

  private async runController(interviewId: string, trigger: string, mode: "interview" | "extract_only", onlyTurnIds?: string[]) {
    const iv = getInterview(this.ctx, interviewId);
    if (mode === "interview" && !["active", "paused"].includes(iv.lifecycle)) return;
    const provider = this.providerFor(iv.mode);
    const { envelope, vctx } = buildEnvelope(this.ctx, interviewId, trigger, mode, onlyTurnIds);
    if (mode === "extract_only" && envelope.context.newTurns.length === 0) return;
    const t0 = performance.now();
    let raw: unknown;
    try {
      raw = await withTimeout(provider.control(envelope), this.config.providerTimeoutMs, "controller");
    } catch (e) {
      // A failed provider never falls back to synthetic output; the failure is recorded and visible.
      recordFailedDecision(this.ctx, envelope, provider.name, "error", [(e as Error).message], performance.now() - t0, null);
      return;
    }
    const providerMs = performance.now() - t0;
    const parsed = parseProposal(raw);
    if (!parsed.ok) {
      recordFailedDecision(this.ctx, envelope, provider.name, "rejected_invalid", parsed.reasons, providerMs, raw);
      return;
    }
    const errors = validateProposal(parsed.proposal, vctx);
    if (errors.length) {
      recordFailedDecision(this.ctx, envelope, provider.name, "rejected_invalid", errors, providerMs, raw);
      return;
    }
    const tc = performance.now();
    const outcome = applyProposal(this.ctx, envelope, parsed.proposal, provider.name, providerMs);
    const commitMs = performance.now() - tc;
    commit(this.ctx, iv.project_id, "metrics.controller", (cs) => {
      const turnId = envelope.context.newTurns[envelope.context.newTurns.length - 1]?.id ?? null;
      addMetric(this.ctx, cs, interviewId, turnId, "controller_ms", providerMs);
      addMetric(this.ctx, cs, interviewId, turnId, "validation_commit_ms", commitMs);
    });
    if (outcome.kind === "stale") {
      const n = (this.staleStreak.get(interviewId) ?? 0) + 1;
      this.staleStreak.set(interviewId, n);
      if (n <= 3) void this.enqueue(interviewId, `recompute_after_stale(${trigger})`, mode, onlyTurnIds);
      return;
    }
    this.staleStreak.set(interviewId, 0);
    if (outcome.kind !== "applied") return;
    if (outcome.deliveryId) this.dispatch(interviewId, outcome.deliveryId);
    if (outcome.ended) this.finish(interviewId, "controller_completed");
  }

  dispatch(interviewId: string, deliveryId: string) {
    const t = this.transportFor(interviewId);
    if (!t) {
      // No connected transport: the question stays queued and is never presented as delivered.
      return;
    }
    t.deliver(deliveryId);
  }

  /** Deliver a closing line (when a transport is connected), then end the interview. */
  finish(interviewId: string, reason: string) {
    const iv = getInterview(this.ctx, interviewId);
    const t = this.transportFor(interviewId);
    if (t && iv.lifecycle === "active") {
      const id = commit(this.ctx, iv.project_id, "delivery.closing", (cs) =>
        createDelivery(this.ctx, cs, interviewId, { kind: "closing", questionId: null, questionRevision: null, text: CLOSING_TEXT, decisionId: null }),
      ).result;
      t.deliver(id);
    }
    this.stop(interviewId, reason, false);
  }

  /** Stop: cancel pending speech and controller work (generation bump), release the guard. */
  stop(interviewId: string, reason: string, cancelSpeech = true, consent?: "declined" | "withdrawn") {
    endInterview(this.ctx, interviewId, reason, consent);
    if (cancelSpeech) this.transportFor(interviewId)?.cancelAll(reason);
  }

  // -- events from transports and the API ------------------------------------------------------

  onStarted(interviewId: string) {
    const iv = getInterview(this.ctx, interviewId);
    if (iv.transport === "simulated") this.deliverIntro(interviewId);
  }

  deliverIntro(interviewId: string) {
    const iv = getInterview(this.ctx, interviewId);
    const id = commit(this.ctx, iv.project_id, "delivery.intro", (cs) =>
      createDelivery(this.ctx, cs, interviewId, { kind: "intro", questionId: null, questionRevision: null, text: INTRO_TEXT, decisionId: null }),
    ).result;
    this.dispatch(interviewId, id);
  }

  consent(interviewId: string, accepted: boolean) {
    if (!accepted) {
      this.stop(interviewId, "consent_declined", true, "declined");
      return;
    }
    recordConsent(this.ctx, interviewId, true);
    void this.enqueue(interviewId, "consent_accepted");
  }

  optOut(interviewId: string) {
    this.stop(interviewId, "participant_opt_out", true, "withdrawn");
  }

  pause(interviewId: string, reason: string) {
    pauseInterview(this.ctx, interviewId, reason);
  }

  resume(interviewId: string) {
    resumeInterview(this.ctx, interviewId);
    void this.enqueue(interviewId, "resume");
  }

  onExpertTurnFinal(interviewId: string) {
    const iv = getInterview(this.ctx, interviewId);
    if (iv.lifecycle === "ended") {
      // Late transcript after termination: extract evidence only; never restart speech.
      void this.enqueue(interviewId, "late_transcript", "extract_only");
      return;
    }
    commit(this.ctx, iv.project_id, "interview.input", (cs) => {
      this.ctx.db.prepare("UPDATE interviews SET control_revision = control_revision + 1 WHERE id = ?").run(interviewId);
      cs.touch("interviews", interviewId);
    });
    void this.enqueue(interviewId, "expert_turn");
  }

  onResearchChange(projectId: string) {
    const live = this.ctx.db.prepare("SELECT id, lifecycle FROM interviews WHERE project_id = ? AND active_slot IS NOT NULL").get(projectId) as any;
    if (live && live.lifecycle === "active") void this.enqueue(live.id, "consultant_change");
  }

  reextract(interviewId: string, turnId: string) {
    return this.enqueue(interviewId, "transcript_correction", "extract_only", [turnId]);
  }

  /** Typed respondent turn (synthetic mode, or a text fallback for a local test). */
  submitTypedTurn(interviewId: string, text: string, sourceEventId: string | null = null): string {
    const iv = getInterview(this.ctx, interviewId);
    if (!["active", "paused", "ended"].includes(iv.lifecycle)) throw new DomainError(409, "The interview is not accepting answers right now.", "invalid_transition");
    const t = text.trim();
    if (!t || t.length > 4000) throw new DomainError(400, "The answer must be 1-4000 characters.", "invalid_input");
    const ctxDelivery = lastStartedDelivery(this.ctx, interviewId);
    const { id, duplicate } = commit(this.ctx, iv.project_id, "transcript.turn", (cs) =>
      appendTurn(this.ctx, cs, {
        interviewId,
        speaker: "expert",
        text: t,
        finality: "final",
        reason: sourceEventId?.startsWith("fixture:") ? "fixture" : "typed",
        sourceEventId,
        contextDeliveryId: ctxDelivery?.id ?? null,
      }),
    ).result;
    if (!duplicate) this.onExpertTurnFinal(interviewId);
    return id;
  }

  /** Scripted Northstar respondent: answers the most recently delivered question. */
  respondScripted(interviewId: string): { action: string; turnId?: string } {
    const iv = getInterview(this.ctx, interviewId);
    if (iv.transport !== "simulated") throw new DomainError(409, "Scripted responses are only available in the synthetic demo.", "not_synthetic");
    if (iv.lifecycle === "consent_pending") {
      this.consent(interviewId, true);
      return { action: "consent_accepted" };
    }
    if (iv.lifecycle !== "active") throw new DomainError(409, `The interview is ${iv.lifecycle}.`, "invalid_transition");
    const d = this.ctx.db
      .prepare("SELECT d.*, q.fixture_key FROM delivery_attempts d LEFT JOIN questions q ON q.id = d.question_id WHERE d.interview_id = ? AND d.kind = 'question' AND d.state = 'completed' ORDER BY d.completed_at DESC LIMIT 1")
      .get(interviewId) as any;
    if (!d) throw new DomainError(409, "No question has been delivered yet.", "nothing_to_answer");
    const answered = this.ctx.db.prepare("SELECT 1 FROM transcript_turns WHERE interview_id = ? AND speaker = 'expert' AND context_delivery_id = ?").get(interviewId, d.id);
    if (answered) throw new DomainError(409, "The last question has already been answered; wait for the controller.", "already_answered");
    const u = (d.fixture_key && OPERATOR_SCRIPT[d.fixture_key]) || OPERATOR_DEFAULT;
    const ref = u === OPERATOR_DEFAULT ? `${u.ref}:${d.id}` : u.ref;
    const turnId = this.submitTypedTurn(interviewId, u.text, `fixture:${ref}`);
    return { action: "answered", turnId };
  }
}

/** Synthetic transport: no audio and no provider. Delivery transitions follow the same state machine. */
export class SimulatedTransport implements InterviewTransport {
  readonly kind = "simulated" as const;
  constructor(private engine: InterviewEngine) {}
  deliver(deliveryId: string) {
    const ctx = this.engine.ctx;
    const d = ctx.db.prepare("SELECT d.*, i.project_id, i.generation AS iv_generation, i.lifecycle FROM delivery_attempts d JOIN interviews i ON i.id = d.interview_id WHERE d.id = ?").get(deliveryId) as any;
    if (!d || d.state !== "queued") return;
    if (d.generation !== d.iv_generation) {
      commit(ctx, d.project_id, "delivery.cancelled", (cs) => transitionDelivery(ctx, cs, deliveryId, "cancelled", { detail: "stale generation" }));
      return;
    }
    if (d.kind === "question" && d.lifecycle !== "active") {
      commit(ctx, d.project_id, "delivery.cancelled", (cs) => transitionDelivery(ctx, cs, deliveryId, "cancelled", { detail: `interview ${d.lifecycle}` }));
      return;
    }
    commit(ctx, d.project_id, "delivery.simulated", (cs) => {
      transitionDelivery(ctx, cs, deliveryId, "speaking", { providerResponseId: `sim_${deliveryId}` });
      appendTurn(ctx, cs, { interviewId: d.interview_id, speaker: "interviewer", text: d.authorized_text, finality: "final", reason: "assistant_transcript", deliveryId, sourceEventId: `sim:${deliveryId}` });
      transitionDelivery(ctx, cs, deliveryId, "completed", { actualTranscript: d.authorized_text, detail: "synthetic delivery (no audio)" });
    });
  }
  cancelAll(_reason: string) {
    /* Simulated speech completes synchronously; nothing is in flight. */
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
