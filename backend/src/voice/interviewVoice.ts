// Live expert interview over Higgs with application-controlled turns:
//   turn_detection null -> browser VAD marks turn end -> commit -> final transcription -> controller ->
//   validated decision -> authorized delivery -> response.create with the question in response.instructions
//   -> forward audio only for the authorized, still-current response.
import { commit, type Ctx } from "../domain/events";
import {
  addMetric,
  appendTurn,
  finalizeTurn,
  getInterview,
  lastStartedDelivery,
  markInterrupted,
  participantJoined,
  transitionDelivery,
} from "../domain/interviews";
import type { InterviewEngine, InterviewTransport } from "../interview/engine";
import { CLARIFY_TEXT, fixedUtteranceInstructions, interviewVoiceInstructions, questionResponseInstructions } from "../providers/prompts";
import { createDelivery } from "../domain/interviews";
import { AUDIO_RATE, HiggsConnection, interviewSessionConfig, type ServerEvent } from "./higgs";

export interface ParticipantChannel {
  sendJson(msg: Record<string, unknown>): void;
  close(code?: number, reason?: string): void;
}

export interface VoiceSettings {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  transcriptionTimeoutMs: number;
  ackTimeoutMs?: number;
  /** response.create sent, no response.created yet: the provider is treated as unresponsive after this. */
  responseStartTimeoutMs?: number;
  /** response.created received, no response.done yet. */
  responseDoneTimeoutMs?: number;
}

interface Current {
  deliveryId: string;
  kind: string;
  generation: number;
  responseId: string | null;
  itemId: string | null;
  createdAt: number;
  firstAudioAt: number | null;
  forwardedSamples: number;
  transcript: string;
  generationDone: boolean;
  drained: boolean;
  interrupted: boolean;
  completionTimer: NodeJS.Timeout | null;
  providerTimer: NodeJS.Timeout | null;
}

interface DeferredCommit {
  hangoverMs: number | null;
  timer: NodeJS.Timeout;
}

// While a commit waits for an active generation to finish, give up waiting after this and commit anyway.
const COMMIT_DEFER_MAX_MS = 3000;

interface PendingCommit {
  turnId: string;
  itemId: string | null;
  committedAt: number;
  timer: NodeJS.Timeout;
}

export class InterviewVoiceSession implements InterviewTransport {
  readonly kind = "browser_ws" as const;
  private higgs: HiggsConnection;
  private ready = false;
  private ended = false;
  private queue: string[] = [];
  private current: Current | null = null;
  private appendedSinceCommit = 0;
  private speechContextDeliveryId: string | null = null;
  private speechStartedAt: string | null = null;
  private pending: PendingCommit[] = [];
  private seenEvents = new Set<string>();
  private droppedAudioEvents = 0;
  private missingStreak = 0;
  // Response lifecycle bookkeeping. Responses carry no request id, so correlation relies on never having
  // more than one response.create outstanding and never creating while any response is active.
  private pendingCreates = 0;
  private activeResponses = new Set<string>();
  private unrequestedResponses = new Set<string>();
  private unrequestedCount = 0;
  private deferredCommit: DeferredCommit | null = null;
  private superseded = false;
  readonly log: { dir: "in" | "out"; type: string; at: number }[] = [];

  constructor(
    private ctx: Ctx,
    private engine: InterviewEngine,
    readonly interviewId: string,
    private participant: ParticipantChannel,
    private settings: VoiceSettings,
  ) {
    this.higgs = new HiggsConnection(settings.url, settings.apiKey);
    this.higgs.on("event", (e: ServerEvent) => this.onServerEvent(e));
    this.higgs.on("sent", (e: any) => this.log.push({ dir: "out", type: e.type, at: Date.now() }));
    this.higgs.on("closed", (c: any) => {
      if (!c.byUs && !this.ended) {
        this.participant.sendJson({ type: "error", message: c.message });
        this.teardown("provider_disconnected", true);
      }
    });
  }

  get droppedAudio() {
    return this.droppedAudioEvents;
  }

  /** Provider responses this session did not request (cancelled and never forwarded). */
  get unrequestedResponseCount() {
    return this.unrequestedCount;
  }

  async start() {
    const iv = getInterview(this.ctx, this.interviewId);
    const expert = this.ctx.db.prepare("SELECT name FROM experts WHERE id = ?").get(iv.expert_id) as any;
    participantJoined(this.ctx, this.interviewId);
    // A rejoin (e.g. a new window, or a reconnect before the old socket's close arrived) replaces the
    // previous participant session; the old one is released without marking the interview interrupted.
    const previous = this.engine.attachTransport(this.interviewId, this);
    if (previous instanceof InterviewVoiceSession && previous !== this) previous.supersede();
    this.sendState("connecting");
    try {
      const resolved = await this.higgs.connect(
        interviewSessionConfig(this.settings.model, this.settings.voice, this.settings.transcriptionModel, interviewVoiceInstructions(expert.name)),
        this.settings.ackTimeoutMs ?? 10000,
      );
      const td = (resolved as any)?.audio?.input?.turn_detection;
      if (td !== undefined && td !== null) throw new Error("Voice provider did not accept application-controlled turns (turn_detection is not null).");
    } catch (e) {
      this.participant.sendJson({ type: "error", message: `Voice unavailable: ${(e as Error).message}` });
      this.teardown("provider_unavailable", true);
      return;
    }
    this.ready = true;
    this.sendState("ready");
    const now = getInterview(this.ctx, this.interviewId);
    if (now.lifecycle === "consent_pending") this.engine.deliverIntro(this.interviewId);
    else {
      // Rejoin: do not replay anything with an unknown outcome; let the controller choose the next step.
      for (const d of this.ctx.db.prepare("SELECT id FROM delivery_attempts WHERE interview_id = ? AND state = 'queued' ORDER BY queued_at").all(this.interviewId) as any[]) this.deliver(d.id);
      if (now.lifecycle === "active") void this.engine.enqueue(this.interviewId, "participant_rejoined");
    }
  }

  private sendState(transport: "connecting" | "ready" | "error") {
    const iv = getInterview(this.ctx, this.interviewId);
    this.participant.sendJson({ type: "state", lifecycle: iv.lifecycle, consent: iv.consent, transport });
  }

  // -- deliveries --------------------------------------------------------------------------------

  deliver(deliveryId: string) {
    if (!this.queue.includes(deliveryId)) this.queue.push(deliveryId);
    this.pump();
  }

  /** True while the provider may still be generating: a response.create is outstanding or a response is active. */
  private providerBusy(): boolean {
    return this.pendingCreates > 0 || this.activeResponses.size > 0;
  }

  private pump() {
    // A new response.create can be rejected while another generation is active, and a waiting expert
    // commit goes first, so nothing new is requested until the provider is idle.
    if (!this.ready || this.current || this.ended || this.providerBusy() || this.deferredCommit) return;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const d = this.ctx.db.prepare("SELECT * FROM delivery_attempts WHERE id = ?").get(id) as any;
      const iv = getInterview(this.ctx, this.interviewId);
      if (!d || d.state !== "queued") continue;
      // The closing line is authorized at a graceful end, after the generation bump; nothing else plays then.
      const closing = d.kind === "closing";
      if (!closing && (d.generation !== iv.generation || iv.lifecycle === "ended" || (d.kind === "question" && iv.lifecycle !== "active"))) {
        commit(this.ctx, iv.project_id, "delivery.cancelled", (cs) => transitionDelivery(this.ctx, cs, id, "cancelled", { detail: `not current (${iv.lifecycle})` }));
        continue;
      }
      const instructions = d.kind === "question" ? questionResponseInstructions(d.authorized_text, null) : fixedUtteranceInstructions(d.authorized_text);
      this.current = {
        deliveryId: id,
        kind: d.kind,
        generation: d.generation,
        responseId: null,
        itemId: null,
        createdAt: Date.now(),
        firstAudioAt: null,
        forwardedSamples: 0,
        transcript: "",
        generationDone: false,
        drained: false,
        interrupted: false,
        completionTimer: null,
        providerTimer: null,
      };
      const c = this.current;
      this.pendingCreates++;
      this.higgs.send({ type: "response.create", response: { instructions, output_modalities: ["audio"] } });
      c.providerTimer = setTimeout(() => this.onResponseStartTimeout(c), this.settings.responseStartTimeoutMs ?? 15000);
      return;
    }
  }

  private onResponseStartTimeout(c: Current) {
    if (this.current !== c || c.responseId) return;
    this.pendingCreates = Math.max(0, this.pendingCreates - 1);
    if (c.interrupted) {
      // Already recorded as interrupted; the provider never started it, so nothing is left to cancel.
      this.closeCurrent();
      return;
    }
    const iv = getInterview(this.ctx, this.interviewId);
    commit(this.ctx, iv.project_id, "delivery.failed", (cs) =>
      transitionDelivery(this.ctx, cs, c.deliveryId, "failed", { detail: "voice provider did not start the response in time" }),
    );
    this.current = null;
    this.providerUnresponsive("did not start a response");
  }

  private onResponseDoneTimeout(c: Current) {
    if (this.current !== c || c.generationDone) return;
    this.higgs.send({ type: "response.cancel" });
    const iv = getInterview(this.ctx, this.interviewId);
    // Some audio may have played: the outcome is unknown, never "completed", and it is not replayed.
    commit(this.ctx, iv.project_id, "delivery.unknown", (cs) =>
      transitionDelivery(this.ctx, cs, c.deliveryId, c.interrupted ? "interrupted" : "unknown", { detail: "voice provider did not finish the response in time", actualTranscript: c.transcript || null }),
    );
    this.current = null;
    this.providerUnresponsive("did not finish a response");
  }

  /** A stalled provider is not waited on forever: the interview becomes interrupted and can be resumed. */
  private providerUnresponsive(what: string) {
    this.participant.sendJson({ type: "error", message: `The voice service ${what} in time. The research team can resume the interview.` });
    this.teardown("provider_unresponsive", true);
  }

  private isCurrentAudio(responseId: unknown): boolean {
    const c = this.current;
    if (!c || c.interrupted || this.ended) return false;
    if (!c.responseId || responseId !== c.responseId) return false;
    if (c.kind === "closing") return true;
    const iv = getInterview(this.ctx, this.interviewId);
    return iv.generation === c.generation && iv.lifecycle !== "ended";
  }

  private onServerEvent(e: ServerEvent) {
    this.log.push({ dir: "in", type: e.type, at: Date.now() });
    if (e.event_id) {
      if (this.seenEvents.has(e.event_id)) return; // duplicate provider event
      this.seenEvents.add(e.event_id);
    }
    const iv = () => getInterview(this.ctx, this.interviewId);
    const rid = String((e.response as any)?.id ?? (e as any).response_id ?? "");
    if (rid && this.unrequestedResponses.has(rid)) {
      // Events of a provider-initiated response are never forwarded or recorded as a delivery.
      if (e.type === "response.done") {
        this.unrequestedResponses.delete(rid);
        this.activeResponses.delete(rid);
        this.onResponseFinished(rid);
      } else if (e.type === "response.output_audio.delta") this.droppedAudioEvents++;
      return;
    }
    switch (e.type) {
      case "response.created": {
        const c = this.current;
        if (rid) this.activeResponses.add(rid);
        if (this.pendingCreates === 0 || !c || c.responseId) {
          // Not requested by this session (e.g. a provider-initiated reply after a commit). Cancel it so it
          // cannot occupy the conversation, and never forward its audio.
          this.unrequestedResponses.add(rid);
          this.unrequestedCount++;
          console.warn(`[interview-voice] cancelling a provider response that was not requested (${this.unrequestedCount} so far)`);
          this.higgs.send({ type: "response.cancel" });
          return;
        }
        this.pendingCreates--;
        c.responseId = rid;
        if (c.providerTimer) clearTimeout(c.providerTimer);
        c.providerTimer = setTimeout(() => this.onResponseDoneTimeout(c), this.settings.responseDoneTimeoutMs ?? 90000);
        if (c.interrupted) {
          // Interrupted before the provider started it: cancel now and wait for response.done before moving on.
          this.higgs.send({ type: "response.cancel" });
          return;
        }
        const p = iv();
        commit(this.ctx, p.project_id, "delivery.speaking", (cs) => {
          transitionDelivery(this.ctx, cs, c.deliveryId, "speaking", { providerResponseId: rid });
          addMetric(this.ctx, cs, this.interviewId, null, "response_start_ms", Date.now() - c.createdAt);
        });
        this.participant.sendJson({ type: "speaking", deliveryId: c.deliveryId });
        return;
      }
      case "response.output_item.added": {
        const c = this.current;
        if (c && (e as any).response_id === c.responseId && (e.item as any)?.id) c.itemId = (e.item as any).id;
        return;
      }
      case "response.output_audio.delta": {
        if (!this.isCurrentAudio((e as any).response_id)) {
          this.droppedAudioEvents++;
          return; // stale or unauthorized audio is never forwarded
        }
        const c = this.current!;
        if (!c.itemId && (e as any).item_id) c.itemId = (e as any).item_id as string;
        const b64 = String((e as any).delta ?? "");
        c.forwardedSamples += Math.floor((b64.length * 3) / 4 / 2);
        if (c.firstAudioAt === null) {
          c.firstAudioAt = Date.now();
          const p = iv();
          commit(this.ctx, p.project_id, "metrics.voice", (cs) => addMetric(this.ctx, cs, this.interviewId, null, "first_audio_forwarded_ms", c.firstAudioAt! - c.createdAt));
        }
        this.participant.sendJson({ type: "audio", deliveryId: c.deliveryId, data: b64 });
        return;
      }
      case "response.output_audio_transcript.delta": {
        const c = this.current;
        if (c && (e as any).response_id === c.responseId && !c.interrupted) c.transcript += String((e as any).delta ?? "");
        return;
      }
      case "response.output_audio_transcript.done": {
        const c = this.current;
        if (c && (e as any).response_id === c.responseId) {
          if (!c.interrupted) c.transcript = String((e as any).transcript ?? c.transcript);
          this.participant.sendJson({ type: "assistant_text", deliveryId: c.deliveryId, text: c.transcript });
        }
        return;
      }
      case "response.done": {
        const c = this.current;
        this.activeResponses.delete(rid);
        if (!c || rid !== c.responseId) return this.onResponseFinished(rid);
        c.generationDone = true;
        if (c.providerTimer) clearTimeout(c.providerTimer);
        c.providerTimer = null;
        const status = (e.response as any)?.status;
        if (c.interrupted) return this.closeCurrent();
        if (status === "failed" || status === "incomplete") {
          const p = iv();
          commit(this.ctx, p.project_id, "delivery.failed", (cs) => transitionDelivery(this.ctx, cs, c.deliveryId, "failed", { detail: `provider status ${status}` }));
          return this.closeCurrent();
        }
        if (c.forwardedSamples === 0) return this.completeCurrent("generation done; no audio to play");
        // Generation completion is not playback completion: tell the browser no more audio is coming and
        // wait for its drained report (which it only sends after this notice and an empty playback queue).
        this.participant.sendJson({ type: "audio_done", deliveryId: c.deliveryId });
        const remainingMs = (c.forwardedSamples / AUDIO_RATE) * 1000 - (Date.now() - (c.firstAudioAt ?? Date.now()));
        c.completionTimer = setTimeout(() => this.unknownCurrent("no playback completion report from the browser"), Math.max(0, remainingMs) + 8000);
        return;
      }
      case "input_audio_buffer.committed": {
        const pend = this.pending.find((p) => !p.itemId);
        if (pend) {
          pend.itemId = String((e as any).item_id ?? "");
          this.ctx.db.prepare("UPDATE transcript_turns SET input_item_id = ? WHERE id = ?").run(pend.itemId, pend.turnId);
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = String((e as any).item_id ?? "");
        const text = String((e as any).transcript ?? "").trim();
        this.onTranscription(itemId, text);
        return;
      }
      case "error": {
        const msg = JSON.stringify((e as any).error ?? e).slice(0, 300);
        console.warn(`[interview-voice] provider error: ${msg}`);
        // Errors about audio input, truncation, or a cancel with nothing active are not a rejected response.create.
        const aboutOther = /input_audio_buffer|append|commit|truncat|cancel/i.test(msg);
        const c = this.current;
        if (c && !c.responseId && !c.interrupted && !aboutOther && Date.now() - c.createdAt < 5000) {
          // response.create was rejected: mark failed, do not retry blindly.
          this.pendingCreates = Math.max(0, this.pendingCreates - 1);
          const p = iv();
          commit(this.ctx, p.project_id, "delivery.failed", (cs) => transitionDelivery(this.ctx, cs, c.deliveryId, "failed", { detail: `provider error: ${msg}` }));
          this.closeCurrent();
        }
        return;
      }
      default:
        return;
    }
  }

  private onTranscription(itemId: string, text: string) {
    const turn = this.ctx.db.prepare("SELECT * FROM transcript_turns WHERE interview_id = ? AND input_item_id = ?").get(this.interviewId, itemId) as any;
    if (!turn) return;
    const pend = this.pending.find((p) => p.turnId === turn.id);
    if (pend) {
      clearTimeout(pend.timer);
      this.pending = this.pending.filter((p) => p !== pend);
    }
    if (turn.finality === "final") return; // duplicate
    const p = getInterview(this.ctx, this.interviewId);
    const changed = commit(this.ctx, p.project_id, "transcript.final", (cs) => {
      let ok: boolean;
      if (turn.finality === "missing") {
        // A late transcription completes the record; the turn keeps its original position.
        if (!text) return false;
        this.ctx.db.prepare("INSERT OR IGNORE INTO transcript_versions (turn_id, version, text, reason, created_at) VALUES (?, 1, ?, 'asr', ?)").run(turn.id, text, new Date().toISOString());
        this.ctx.db.prepare("UPDATE transcript_turns SET finality = 'final', current_version = 1 WHERE id = ?").run(turn.id);
        cs.touch("turns", turn.id);
        ok = true;
      } else ok = finalizeTurn(this.ctx, cs, turn.id, text || null, text ? "final" : "missing", "asr");
      if (pend) addMetric(this.ctx, cs, this.interviewId, turn.id, "final_transcription_ms", Date.now() - pend.committedAt);
      return ok;
    }).result;
    if (!changed) return;
    if (!text) return this.onMissingTranscript();
    this.missingStreak = 0;
    this.engine.onExpertTurnFinal(this.interviewId);
  }

  private onMissingTranscript() {
    this.missingStreak++;
    const iv = getInterview(this.ctx, this.interviewId);
    if (iv.lifecycle !== "active" || this.missingStreak > 2) return; // wait safely; never invent an answer
    const id = commit(this.ctx, iv.project_id, "delivery.clarification", (cs) =>
      createDelivery(this.ctx, cs, this.interviewId, { kind: "clarification", questionId: null, questionRevision: null, text: CLARIFY_TEXT, decisionId: null }),
    ).result;
    this.deliver(id);
  }

  private completeCurrent(detail: string) {
    const c = this.current;
    if (!c) return;
    const iv = getInterview(this.ctx, this.interviewId);
    commit(this.ctx, iv.project_id, "delivery.completed", (cs) => {
      if (transitionDelivery(this.ctx, cs, c.deliveryId, "completed", { actualTranscript: c.transcript || null, detail })) {
        appendTurn(this.ctx, cs, {
          interviewId: this.interviewId,
          speaker: "interviewer",
          text: c.transcript || "(no assistant transcript received)",
          finality: "final",
          reason: "assistant_transcript",
          deliveryId: c.deliveryId,
          sourceEventId: c.responseId ? `resp:${c.responseId}` : null,
        });
      }
    });
    this.closeCurrent();
  }

  private unknownCurrent(detail: string) {
    const c = this.current;
    if (!c) return;
    const iv = getInterview(this.ctx, this.interviewId);
    commit(this.ctx, iv.project_id, "delivery.unknown", (cs) => transitionDelivery(this.ctx, cs, c.deliveryId, "unknown", { detail, actualTranscript: c.transcript || null }));
    this.closeCurrent();
  }

  /** A response that is not the current delivery's (unrequested, or already abandoned) has finished. */
  private onResponseFinished(_rid: string) {
    if (this.providerBusy()) return;
    if (this.deferredCommit) this.flushDeferredCommit();
    else this.pump();
  }

  private closeCurrent() {
    if (this.current?.completionTimer) clearTimeout(this.current.completionTimer);
    if (this.current?.providerTimer) clearTimeout(this.current.providerTimer);
    this.current = null;
    if (this.deferredCommit && !this.providerBusy()) this.flushDeferredCommit();
    this.pump();
    if (!this.current && !this.ended) {
      const iv = getInterview(this.ctx, this.interviewId);
      if (iv.lifecycle === "ended") {
        // Graceful end: the closing line has played (or could not); close the participant session.
        this.participant.sendJson({ type: "ended", reason: iv.termination_reason });
        this.teardown(null, false);
      }
    }
  }

  // -- participant input ------------------------------------------------------------------------

  private capturing(): boolean {
    const iv = getInterview(this.ctx, this.interviewId);
    return this.ready && iv.consent === "accepted" && (iv.lifecycle === "active" || iv.lifecycle === "paused");
  }

  onAudio(pcm16: Buffer) {
    if (!this.capturing()) return; // no audio is sent before consent or after the end
    this.higgs.send({ type: "input_audio_buffer.append", audio: pcm16.toString("base64") });
    this.appendedSinceCommit += pcm16.length / 2;
  }

  async onMessage(msg: any) {
    switch (msg?.type) {
      case "consent":
        this.engine.consent(this.interviewId, !!msg.accepted);
        if (!msg.accepted) this.teardown(null, false);
        return;
      case "speech_start":
        this.speechStartedAt = new Date().toISOString();
        // Context is the delivery active at speech time, not whichever is current when the transcript arrives.
        // A delivery the provider has not started yet counts as context only once it is speaking.
        this.speechContextDeliveryId = (this.current?.responseId ? this.current.deliveryId : null) ?? lastStartedDelivery(this.ctx, this.interviewId)?.id ?? null;
        // Barge-in. A question requested but not yet started is withdrawn too: new input makes it obsolete.
        // The closing line follows the end of the interview, so it is only stopped once it is audible.
        const c = this.current;
        if (c && !c.interrupted && (c.responseId || c.kind !== "closing")) await this.interrupt("participant barge-in", msg.playedMs);
        return;
      case "interrupt":
        if (this.current) await this.interrupt("manual interrupt", msg.playedMs);
        return;
      case "speech_end":
      case "end_turn":
        this.commitTurn(typeof msg.vadHangoverMs === "number" ? msg.vadHangoverMs : null);
        return;
      case "playback":
        this.onPlayback(msg);
        return;
      case "end":
        this.engine.stop(this.interviewId, "participant_ended");
        return;
      default:
        return;
    }
  }

  private commitTurn(hangoverMs: number | null) {
    if (!this.capturing()) return;
    if (this.appendedSinceCommit < AUDIO_RATE * 0.1) return; // under 100 ms of audio: nothing to commit
    if (this.deferredCommit) return; // already waiting; the audio appended since is included
    if (this.providerBusy()) {
      // A commit while a generation is active (e.g. the cancelled question after a barge-in) can be
      // rejected, so wait for response.done; commit anyway if the provider takes too long.
      const timer = setTimeout(() => this.flushDeferredCommit(), COMMIT_DEFER_MAX_MS);
      this.deferredCommit = { hangoverMs, timer };
      return;
    }
    this.doCommit(hangoverMs);
  }

  private flushDeferredCommit() {
    const d = this.deferredCommit;
    if (!d) return;
    clearTimeout(d.timer);
    this.deferredCommit = null;
    if (this.ended || !this.capturing()) return;
    this.doCommit(d.hangoverMs);
    this.pump();
  }

  private doCommit(hangoverMs: number | null) {
    this.appendedSinceCommit = 0;
    const iv = getInterview(this.ctx, this.interviewId);
    const contextDeliveryId = this.speechContextDeliveryId ?? lastStartedDelivery(this.ctx, this.interviewId)?.id ?? null;
    const turnId = commit(this.ctx, iv.project_id, "transcript.pending", (cs) => {
      const t = appendTurn(this.ctx, cs, {
        interviewId: this.interviewId,
        speaker: "expert",
        text: null,
        finality: "pending",
        reason: "asr",
        contextDeliveryId,
        startedAt: this.speechStartedAt ?? undefined,
      });
      if (hangoverMs !== null) addMetric(this.ctx, cs, this.interviewId, t.id, "turn_end_detection_ms", hangoverMs);
      return t.id;
    }).result;
    this.speechContextDeliveryId = null;
    this.speechStartedAt = null;
    this.higgs.send({ type: "input_audio_buffer.commit" });
    const timer = setTimeout(() => this.onTranscriptionTimeout(turnId), this.settings.transcriptionTimeoutMs);
    this.pending.push({ turnId, itemId: null, committedAt: Date.now(), timer });
    this.participant.sendJson({ type: "turn_committed", turnId });
  }

  private onTranscriptionTimeout(turnId: string) {
    this.pending = this.pending.filter((p) => p.turnId !== turnId);
    const iv = getInterview(this.ctx, this.interviewId);
    const changed = commit(this.ctx, iv.project_id, "transcript.missing", (cs) => finalizeTurn(this.ctx, cs, turnId, null, "missing", "asr")).result;
    if (changed) this.onMissingTranscript();
  }

  private flushWaiters: ((playedMs: number | null) => void)[] = [];

  private async interrupt(detail: string, reportedPlayedMs?: number) {
    const c = this.current;
    if (!c) return;
    c.interrupted = true; // from here no further audio of this response is forwarded
    // Cancel even if response.created has not arrived yet, so the provider never starts speaking it.
    if (!c.generationDone) this.higgs.send({ type: "response.cancel" });
    let playedMs: number | null = typeof reportedPlayedMs === "number" ? reportedPlayedMs : null;
    if (playedMs === null) {
      this.participant.sendJson({ type: "flush", deliveryId: c.deliveryId });
      playedMs = await new Promise<number | null>((resolve) => {
        const t = setTimeout(() => resolve(null), 1000);
        this.flushWaiters.push((v) => {
          clearTimeout(t);
          resolve(v);
        });
      });
    } else this.participant.sendJson({ type: "flush", deliveryId: c.deliveryId });
    const forwardedMs = (c.forwardedSamples / AUDIO_RATE) * 1000;
    // Conservative estimate when the browser cannot confirm: elapsed since first audio, capped at what was sent.
    const estimate = c.firstAudioAt ? Math.min(forwardedMs, Date.now() - c.firstAudioAt) : 0;
    const audioEndMs = Math.max(0, Math.round(Math.min(playedMs ?? estimate, forwardedMs)));
    if (c.itemId) this.higgs.send({ type: "conversation.item.truncate", item_id: c.itemId, content_index: 0, audio_end_ms: audioEndMs });
    const iv = getInterview(this.ctx, this.interviewId);
    const state = (this.ctx.db.prepare("SELECT state FROM delivery_attempts WHERE id = ?").get(c.deliveryId) as any)?.state;
    if (state === "queued") {
      // Nothing was spoken yet: the request is withdrawn, not interrupted, and no interviewer turn exists.
      commit(this.ctx, iv.project_id, "delivery.cancelled", (cs) => transitionDelivery(this.ctx, cs, c.deliveryId, "cancelled", { detail: `${detail} before the provider started speaking` }));
    } else commit(this.ctx, iv.project_id, "delivery.interrupted", (cs) => {
      if (transitionDelivery(this.ctx, cs, c.deliveryId, "interrupted", { playedMs: audioEndMs, detail: `${detail}${playedMs === null ? " (playback position estimated)" : ""}`, actualTranscript: c.transcript || null })) {
        appendTurn(this.ctx, cs, {
          interviewId: this.interviewId,
          speaker: "interviewer",
          text: c.transcript ? `${c.transcript} [interrupted]` : "[interrupted before transcript]",
          finality: "final",
          reason: "assistant_transcript",
          deliveryId: c.deliveryId,
          sourceEventId: c.responseId ? `resp:${c.responseId}` : null,
        });
      }
    });
    if (c.generationDone) this.closeCurrent();
    else if (!c.responseId) {
      // The provider has not started it yet. Keep the slot so a late response.created is recognised and
      // cancelled rather than mistaken for the next delivery; stop waiting soon if it never arrives.
      if (c.providerTimer) clearTimeout(c.providerTimer);
      c.providerTimer = setTimeout(() => this.onResponseStartTimeout(c), Math.min(2000, this.settings.responseStartTimeoutMs ?? 2000));
    }
    // Otherwise wait for response.done (cancelled) before issuing another response.create.
  }

  private onPlayback(msg: any) {
    if (msg.event === "flushed") {
      const w = this.flushWaiters.splice(0);
      for (const f of w) f(typeof msg.playedMs === "number" ? msg.playedMs : null);
      return;
    }
    const c = this.current;
    if (!c || msg.deliveryId !== c.deliveryId) return;
    // A drained report only counts once generation is done; a queue that empties mid-stream is jitter.
    if (msg.event === "drained" && c.generationDone && !c.interrupted) {
      c.drained = true;
      this.completeCurrent("playback drained in browser");
    }
  }

  // -- teardown ---------------------------------------------------------------------------------

  /** Engine stop: cancel speech and pending work, then close both sides. */
  cancelAll(reason: string) {
    if (this.current && !this.current.generationDone) this.higgs.send({ type: "response.cancel" });
    if (this.current) {
      this.current.interrupted = true;
      this.participant.sendJson({ type: "flush", deliveryId: this.current.deliveryId });
    }
    for (const p of this.pending) clearTimeout(p.timer);
    this.queue = [];
    this.participant.sendJson({ type: "ended", reason });
    this.teardown(null, false);
  }

  /** Participant socket closed. */
  onParticipantClosed() {
    if (this.ended) return;
    const iv = getInterview(this.ctx, this.interviewId);
    if (iv.lifecycle !== "ended") this.teardown("participant_disconnected", true);
    else this.teardown(null, false);
  }

  get isSuperseded() {
    return this.superseded;
  }

  /** Replaced by a newer participant connection for the same interview: release without interrupting it. */
  supersede() {
    if (this.ended) return;
    this.superseded = true;
    const c = this.current;
    if (c) {
      if (!c.generationDone) this.higgs.send({ type: "response.cancel" });
      c.interrupted = true;
      const iv = getInterview(this.ctx, this.interviewId);
      const state = (this.ctx.db.prepare("SELECT state FROM delivery_attempts WHERE id = ?").get(c.deliveryId) as any)?.state;
      // Audio may have reached the old window: unknown, not replayed. A request the provider never started
      // stays queued so the new session can deliver it.
      if (state === "speaking")
        commit(this.ctx, iv.project_id, "delivery.unknown", (cs) =>
          transitionDelivery(this.ctx, cs, c.deliveryId, "unknown", { detail: "participant session replaced by a new connection; playback outcome unknown", actualTranscript: c.transcript || null }),
        );
    }
    this.participant.sendJson({ type: "error", message: "This interview was opened in another window, so this window has been disconnected." });
    this.teardown(null, false);
  }

  private teardown(interruptReason: string | null, markInterruptedState: boolean) {
    if (this.ended) return;
    this.ended = true;
    if (this.current?.completionTimer) clearTimeout(this.current.completionTimer);
    if (this.current?.providerTimer) clearTimeout(this.current.providerTimer);
    if (this.deferredCommit) clearTimeout(this.deferredCommit.timer);
    this.deferredCommit = null;
    for (const p of this.pending) clearTimeout(p.timer);
    this.engine.detachTransport(this.interviewId, this);
    // A newer participant session owns the interview now; this session's loss does not interrupt it.
    if (this.engine.transportFor(this.interviewId)) markInterruptedState = false;
    const now = getInterview(this.ctx, this.interviewId);
    if (now.lifecycle === "ended") {
      // E.g. the participant left during the closing line: its playback outcome is unknown, not completed.
      const open = this.ctx.db.prepare("SELECT id, state FROM delivery_attempts WHERE interview_id = ? AND state IN ('queued','speaking')").all(this.interviewId) as any[];
      if (open.length)
        commit(this.ctx, now.project_id, "delivery.session_closed", (cs) => {
          for (const d of open) transitionDelivery(this.ctx, cs, d.id, d.state === "queued" ? "cancelled" : "unknown", { detail: "session closed before playback was confirmed" });
        });
    }
    if (markInterruptedState && interruptReason) {
      const iv = getInterview(this.ctx, this.interviewId);
      if (iv.lifecycle !== "ended") markInterrupted(this.ctx, this.interviewId, interruptReason, false);
    }
    this.higgs.close();
    setTimeout(() => this.participant.close(1000, "session ended"), 50);
  }
}
