// Private consultant copilot over Higgs with native server_vad. The server starts a response after each
// consultant turn, so the client never sends response.create for ordinary speech. response.create is sent
// only (a) once for the explicit briefing after the session is acknowledged, (b) exactly once after all
// tool outputs of a response are returned, and (c) for a coalesced background update while idle.
import type { StateEvent } from "../../../shared/contracts";
import { COPILOT_TOOLS, makeToolExecutor } from "../domain/copilotTools";
import type { Ctx } from "../domain/events";
import { currentHandoff, saveCopilotMessage } from "../domain/memory";
import type { InterviewEngine } from "../interview/engine";
import { copilotVoiceInstructions } from "../providers/prompts";
import { copilotSessionConfig, HiggsConnection, type ServerEvent } from "./higgs";
import type { ParticipantChannel, VoiceSettings } from "./interviewVoice";

const NOTABLE = new Set(["interview.ended", "interview.started", "interview.interrupted"]);

export function buildContextPacket(ctx: Ctx, projectId: string): string {
  const h = currentHandoff(ctx, projectId);
  return [h.summary, h.unresolved.length ? `Unresolved: ${h.unresolved.join(" ")}` : "", h.nextSteps.length ? `Next steps: ${h.nextSteps.join(" ")}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

export class CopilotVoiceSession {
  private higgs: HiggsConnection;
  private ready = false;
  private closed = false;
  private responseActive = false;
  private currentResponseId: string | null = null;
  /** Responses the consultant talked over: their remaining audio is never forwarded. */
  private interruptedResponses = new Set<string>();
  private currentItemId: string | null = null;
  private handledCalls = new Set<string>();
  private callResults = new Map<string, Promise<{ callId: string; output: string }>>();
  private callsByResponse = new Map<string, string[]>();
  private seenEvents = new Set<string>();
  private updates: string[] = [];
  private lastUserSpeechAt = 0;
  private lastBackgroundAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private pausedInterviewId: string | null = null;
  private assistantText = "";
  briefingSent = false;
  readonly sentTypes: string[] = [];

  constructor(
    private ctx: Ctx,
    private engine: InterviewEngine,
    readonly projectId: string,
    private client: ParticipantChannel,
    private settings: VoiceSettings,
  ) {
    this.higgs = new HiggsConnection(settings.url, settings.apiKey);
    this.higgs.on("event", (e: ServerEvent) => void this.onServerEvent(e));
    this.higgs.on("sent", (e: any) => this.sentTypes.push(e.type));
    this.higgs.on("closed", (c: any) => {
      if (!c.byUs && !this.closed) {
        this.client.sendJson({ type: "error", message: c.message });
        this.close();
      }
    });
  }

  async start(localInterviewTest: boolean) {
    // One-device demo: the consultant's private capture pauses a local interview test so no question
    // is asked while the consultant speaks privately. Audio paths never cross.
    if (localInterviewTest) {
      const live = this.ctx.db.prepare("SELECT id, lifecycle FROM interviews WHERE project_id = ? AND active_slot IS NOT NULL AND local_test = 1").get(this.projectId) as any;
      if (live?.lifecycle === "active") {
        this.engine.pause(live.id, "consultant_private_voice");
        this.pausedInterviewId = live.id;
      }
    }
    try {
      const tools = COPILOT_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
      await this.higgs.connect(
        copilotSessionConfig(this.settings.model, this.settings.voice, this.settings.transcriptionModel, copilotVoiceInstructions(buildContextPacket(this.ctx, this.projectId)), tools),
        this.settings.ackTimeoutMs ?? 10000,
      );
    } catch (e) {
      this.client.sendJson({ type: "error", message: `Voice unavailable: ${(e as Error).message}` });
      this.close();
      return;
    }
    this.ready = true;
    this.unsubscribe = this.engine.ctx.hub.subscribe(this.projectId, (ev) => this.onProjectEvent(ev));
    this.timer = setInterval(() => this.maybeSendBackgroundUpdate(), 3000);
    this.client.sendJson({ type: "ready" });
  }

  onAudio(pcm16: Buffer) {
    if (!this.ready || this.closed) return;
    this.higgs.send({ type: "input_audio_buffer.append", audio: pcm16.toString("base64") });
  }

  onMessage(msg: any) {
    if (msg?.type === "start_briefing") this.startBriefing();
    if (msg?.type === "playback" && msg.event === "flushed" && this.currentItemId && typeof msg.playedMs === "number") {
      this.higgs.send({ type: "conversation.item.truncate", item_id: this.currentItemId, content_index: 0, audio_end_ms: Math.max(0, Math.round(msg.playedMs)) });
    }
  }

  /** The single explicit initial response, after the user enabled voice and the session was acknowledged. */
  startBriefing() {
    if (!this.ready || this.briefingSent || this.responseActive) return;
    this.briefingSent = true;
    this.responseActive = true;
    this.higgs.send({
      type: "response.create",
      response: { instructions: "Give the consultant a short spoken briefing (three or four sentences) on where the project stands, using the context packet, then ask what they would like to do next." },
    });
  }

  private onProjectEvent(ev: StateEvent) {
    if (NOTABLE.has(ev.type)) this.updates.push(`${ev.type.replace(".", " ")}`);
    const findings = ev.upserts.findings?.length ?? 0;
    if (ev.type === "controller.decision" && findings) this.updates.push(`${findings} new or updated finding(s)`);
    if (this.updates.length > 10) this.updates = this.updates.slice(-10);
  }

  /** Coalesced, rate-limited background update; never interrupts the consultant or an answer in progress. */
  private maybeSendBackgroundUpdate() {
    if (!this.ready || this.closed || this.responseActive || this.updates.length === 0) return;
    if (Date.now() - this.lastUserSpeechAt < 6000 || Date.now() - this.lastBackgroundAt < 45000) return;
    const summary = [...new Set(this.updates)].join("; ");
    this.updates = [];
    this.lastBackgroundAt = Date.now();
    this.responseActive = true;
    this.higgs.send({ type: "response.create", response: { instructions: `In one short sentence, tell the consultant about this project update and offer details: ${summary}.` } });
  }

  private async onServerEvent(e: ServerEvent) {
    if (e.event_id) {
      if (this.seenEvents.has(e.event_id)) return;
      this.seenEvents.add(e.event_id);
    }
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        this.lastUserSpeechAt = Date.now();
        // Barge-in: stop forwarding and playing the current answer, cancel it, and truncate what was not
        // heard once the browser reports its playback position. No response.create here: server VAD
        // starts the next response automatically when the consultant finishes speaking.
        if (this.currentResponseId && this.responseActive && !this.interruptedResponses.has(this.currentResponseId)) {
          this.interruptedResponses.add(this.currentResponseId);
          this.higgs.send({ type: "response.cancel" });
        }
        this.client.sendJson({ type: "flush", responseId: this.currentResponseId });
        return;
      case "input_audio_buffer.speech_stopped":
        this.lastUserSpeechAt = Date.now();
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String((e as any).transcript ?? "").trim();
        if (text) {
          saveCopilotMessage(this.ctx, this.projectId, { role: "consultant", channel: "voice", text, provider: "higgs" });
          this.client.sendJson({ type: "user_text", text });
        }
        return;
      }
      case "response.created":
        this.responseActive = true;
        this.currentResponseId = (e.response as any)?.id ?? null;
        this.assistantText = "";
        return;
      case "response.output_item.added": {
        const item = e.item as any;
        if (item?.type === "message") this.currentItemId = item.id ?? null;
        return;
      }
      case "response.output_audio.delta":
        if ((e as any).response_id === this.currentResponseId && !this.interruptedResponses.has(this.currentResponseId ?? ""))
          this.client.sendJson({ type: "audio", responseId: this.currentResponseId, data: (e as any).delta });
        return;
      case "response.output_audio_transcript.done":
        this.assistantText = String((e as any).transcript ?? "");
        return;
      case "response.function_call_arguments.done":
        this.startToolCall(String((e as any).call_id), String((e as any).name), String((e as any).arguments ?? "{}"), (e as any).response_id ?? this.currentResponseId);
        return;
      case "response.done": {
        const resp = e.response as any;
        for (const item of resp?.output ?? []) {
          if (item?.type === "function_call") this.startToolCall(String(item.call_id), String(item.name), String(item.arguments ?? "{}"), resp.id);
        }
        if (this.assistantText.trim()) {
          saveCopilotMessage(this.ctx, this.projectId, { role: "assistant", channel: "voice", text: this.assistantText.trim(), provider: "higgs" });
          this.client.sendJson({ type: "assistant_text", text: this.assistantText.trim() });
          this.assistantText = "";
        }
        const calls = this.callsByResponse.get(resp?.id) ?? [];
        this.callsByResponse.delete(resp?.id);
        if (calls.length) {
          const outputs = await Promise.all(calls.map((c) => this.callResults.get(c)!));
          for (const o of outputs) this.higgs.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: o.callId, output: o.output } });
          // Exactly one continuation after all tool outputs of this response.
          this.higgs.send({ type: "response.create" });
          this.responseActive = true;
        } else this.responseActive = false;
        return;
      }
      default:
        return;
    }
  }

  private startToolCall(callId: string, name: string, argsJson: string, responseId: string | null) {
    if (!callId || this.handledCalls.has(callId)) return; // announced twice: arguments.done and response.done
    this.handledCalls.add(callId);
    const key = responseId ?? "unknown";
    this.callsByResponse.set(key, [...(this.callsByResponse.get(key) ?? []), callId]);
    const exec = makeToolExecutor(this.ctx, this.projectId, "copilot", { onResearchChange: (pid) => this.engine.onResearchChange(pid) });
    this.callResults.set(
      callId,
      (async () => {
        let args: unknown = {};
        try {
          args = JSON.parse(argsJson);
        } catch {
          return { callId, output: JSON.stringify({ summary: "Arguments were not valid JSON.", error: "invalid_json" }) };
        }
        const result = await exec(name, args);
        if (result.navigation) this.client.sendJson({ type: "navigate", target: result.navigation });
        saveCopilotMessage(this.ctx, this.projectId, { role: "tool", channel: "voice", text: result.summary, toolName: name, navigation: result.navigation ?? null, provider: "higgs" });
        return { callId, output: JSON.stringify({ summary: result.summary, error: result.error ?? null }) };
      })(),
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    this.higgs.close();
    if (this.pausedInterviewId) {
      const iv = this.ctx.db.prepare("SELECT lifecycle, pause_reason FROM interviews WHERE id = ?").get(this.pausedInterviewId) as any;
      if (iv?.lifecycle === "paused" && iv.pause_reason === "consultant_private_voice") this.engine.resume(this.pausedInterviewId);
    }
    try {
      this.client.close(1000, "copilot voice closed");
    } catch {
      /* ignore */
    }
  }
}

