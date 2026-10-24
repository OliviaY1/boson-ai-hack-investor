// Participant route: interview-scoped, expiring token. Shows only the introduction, consent,
// microphone controls, connection status, and end control. No consultant workspace or project data.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MicCapture } from "../audio/capture";
import { acquireMic, onMicChange, releaseMic } from "../audio/micOwnership";
import { PcmPlayer } from "../audio/playback";
import { AudioSocket } from "../audio/socket";
import { ActionButton, Badge, Button, Card, inputCls, Notice } from "../components/ui";
import { api } from "../lib/api";

interface Info {
  interviewId: string;
  participantName: string;
  mode: string;
  transport: "simulated" | "browser_ws" | "fixture";
  lifecycle: string;
  consent: string;
  intro: string;
  localTest: boolean;
  voiceAvailable: boolean;
  transcript: { seq: number; speaker: string; text: string | null }[];
  audioRecording: boolean;
}

type Phase = "idle" | "connecting" | "connected" | "error" | "closed";

export function JoinPage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const load = useCallback(async () => {
    try {
      setInfo(await api.get<Info>(`/api/participant/${token}`));
    } catch (e) {
      if ((e as any).status === 404) setInvalid(true);
      else setErr((e as Error).message);
    }
  }, [token]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  if (invalid)
    return (
      <Shell>
        <Notice tone="bad">This interview link is invalid or has expired. Ask the research team for a new link.</Notice>
      </Shell>
    );
  if (!info) return <Shell>{err ? <Notice tone="bad">{err}</Notice> : <div className="text-muted">Loading…</div>}</Shell>;
  const ended = info.lifecycle === "ended";
  return (
    <Shell>
      {info.localTest ? <Notice tone="warn">Local browser test: you are acting as the respondent. This page has no access to the consultant workspace.</Notice> : null}
      <Card title={`Interview with ${info.participantName}`}>
        <p className="text-[15px] leading-relaxed">{info.intro}</p>
        <p className="mt-2 text-xs text-muted">Audio is {info.audioRecording ? "recorded" : "not recorded"}. A text transcript is kept for this research. You can stop at any time.</p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Badge tone={info.lifecycle === "active" ? "good" : ended ? "neutral" : "info"}>{info.lifecycle.replace(/_/g, " ")}</Badge>
          <Badge tone={info.consent === "accepted" ? "good" : info.consent === "pending" ? "neutral" : "bad"}>consent {info.consent}</Badge>
        </div>
      </Card>
      {ended ? <Notice tone="info">This interview has ended. Thank you for your time. You can close this page.</Notice> : info.transport === "browser_ws" ? <VoiceParticipant token={token} info={info} onChange={load} /> : <TypedParticipant token={token} info={info} onChange={load} />}
      <Transcript info={info} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <div className="flex h-12 items-center border-b border-line bg-white px-6 font-semibold">Research interview</div>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

function ConsentButtons({ onAnswer }: { onAnswer: (accepted: boolean) => Promise<unknown> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton variant="primary" action={() => onAnswer(true)}>I agree to participate</ActionButton>
      <ActionButton variant="danger" action={() => onAnswer(false)}>No, I do not agree</ActionButton>
    </div>
  );
}

function TypedParticipant({ token, info, onChange }: { token: string; info: Info; onChange: () => void }) {
  const [text, setText] = useState("");
  return (
    <Card title="Synthetic demo participant">
      <p className="mb-3 text-xs text-muted">Fully synthetic mode: no microphone, no audio. Type answers to the questions shown below.</p>
      {info.consent === "pending" ? (
        <ConsentButtons onAnswer={async (accepted) => { await api.post(`/api/participant/${token}/consent`, { accepted }); onChange(); }} />
      ) : info.consent === "accepted" ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await api.post(`/api/participant/${token}/answer`, { text });
            setText("");
            onChange();
          }}
        >
          <textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" />
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={!text.trim()}>Send answer</Button>
            <ActionButton variant="danger" action={async () => { await api.post(`/api/participant/${token}/end`); onChange(); }}>End interview</ActionButton>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function VoiceParticipant({ token, info, onChange }: { token: string; info: Info; onChange: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const r = useRef<{ sock?: AudioSocket; cap?: MicCapture; player?: PcmPlayer; micId?: string; consented?: boolean }>({});
  r.current.consented = info.consent === "accepted";

  const teardown = useCallback(() => {
    const x = r.current;
    x.sock?.close();
    void x.cap?.stop();
    void x.player?.close();
    if (x.micId) releaseMic(x.micId);
    r.current = { consented: x.consented };
    setSpeaking(false);
    setUserSpeaking(false);
    setLevel(0);
  }, []);
  useEffect(() => () => teardown(), [teardown]);
  useEffect(() => {
    // When the consultant releases private voice, offer to reclaim the microphone (requires a click).
    const off = onMicChange((m) => {
      if (m.type === "released" && m.role === "consultant") setRevoked((x) => x);
    });
    return () => {
      off();
    };
  }, []);

  const startCapture = async () => {
    const sock = r.current.sock!;
    const player = r.current.player!;
    const mic = await acquireMic("participant", () => {
      // The consultant took the microphone for private voice: capture stops; the backend pauses questions.
      setRevoked(true);
      void r.current.cap?.stop();
      r.current.cap = undefined;
      r.current.micId = undefined;
      setLevel(0);
    });
    r.current.micId = mic.id;
    setRevoked(false);
    const cap = new MicCapture(mic.stream, {
      onLevel: setLevel,
      onSpeechStart: () => {
        setUserSpeaking(true);
        if (!r.current.consented) return;
        const cur = player.current;
        if (player.playing && cur) {
          const played = player.playedMs(cur);
          player.flush(); // barge-in: clear local playback immediately
          sock.send({ type: "speech_start", playedMs: played });
        } else sock.send({ type: "speech_start" });
      },
      onSpeechFrame: (pcm) => {
        if (r.current.consented) sock.sendAudio(pcm);
      },
      onSpeechEnd: (hangoverMs) => {
        setUserSpeaking(false);
        if (r.current.consented) sock.send({ type: "speech_end", vadHangoverMs: hangoverMs });
      },
    });
    r.current.cap = cap;
    await cap.start();
  };

  const join = async () => {
    setErr(null);
    setPhase("connecting");
    const player = new PcmPlayer();
    r.current.player = player;
    try {
      await player.activate(); // user gesture: browser audio activation
      const sock = new AudioSocket();
      r.current.sock = sock;
      player.onActivity = (p) => {
        setSpeaking(p);
        if (r.current.cap) r.current.cap.thresholdBoost = p ? 2.5 : 1; // resist echo while the interviewer speaks
      };
      player.onDrained = (deliveryId, playedMs) => sock.send({ type: "playback", event: "drained", deliveryId, playedMs });
      sock.onJson = (m) => {
        switch (m.type) {
          case "audio":
            player.enqueue(m.deliveryId, m.data);
            return;
          case "audio_done":
            player.markDone(m.deliveryId);
            return;
          case "flush": {
            const played = player.flush();
            sock.send({ type: "playback", event: "flushed", deliveryId: m.deliveryId, playedMs: played.get(m.deliveryId) ?? player.playedMs(m.deliveryId) });
            return;
          }
          case "state":
          case "turn_committed":
          case "assistant_text":
          case "speaking":
            onChange();
            return;
          case "ended":
            teardown();
            setPhase("closed");
            onChange();
            return;
          case "error":
            setErr(m.message);
            return;
        }
      };
      sock.onClose = () => {
        if (r.current.sock === sock) {
          teardown();
          setPhase((p) => (p === "closed" ? p : "error"));
          setErr((e) => e ?? "The connection was lost. Reload this page to rejoin; nothing already said is lost.");
        }
      };
      await sock.connect(`/ws/participant?token=${encodeURIComponent(token)}`);
      setPhase("connected");
      await startCapture();
    } catch (e) {
      setErr((e as Error).message);
      setPhase((p) => (p === "connected" ? p : "error"));
    }
  };

  const consent = async (accepted: boolean) => {
    if (r.current.sock?.open) r.current.sock.send({ type: "consent", accepted });
    else await api.post(`/api/participant/${token}/consent`, { accepted });
    r.current.consented = accepted;
    if (!accepted) teardown();
    setTimeout(onChange, 300);
  };

  return (
    <Card title="Voice">
      {phase === "idle" || phase === "error" ? (
        <div className="space-y-2">
          {!info.voiceAvailable ? <Notice tone="bad">Voice is unavailable on the server (Higgs voice is not configured).</Notice> : null}
          <Button variant="primary" disabled={!info.voiceAvailable} onClick={() => void join()}>
            {phase === "error" ? "Reconnect" : "Join with microphone"}
          </Button>
          <p className="text-xs text-muted">Your browser will ask for microphone permission. Use headphones if possible to avoid echo.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={phase === "connected" ? "good" : "info"}>{phase === "connected" ? "Connected" : phase === "connecting" ? "Connecting…" : "Disconnected"}</Badge>
            <Badge tone={speaking ? "accent" : userSpeaking ? "good" : "neutral"}>{speaking ? "Interviewer speaking" : userSpeaking ? "You are speaking" : "Listening"}</Badge>
            <span className="inline-block h-2 w-24 overflow-hidden rounded bg-surface" aria-label="Microphone level">
              <span className="block h-full bg-emerald-600" style={{ width: `${Math.min(100, level * 600)}%` }} />
            </span>
          </div>
          {revoked ? (
            <Notice tone="warn">
              The microphone is in use by the consultant's private voice session, so questions are paused.{" "}
              <button className="underline" onClick={() => void startCapture().catch((e) => setErr(e.message))}>Reclaim microphone</button>
            </Notice>
          ) : null}
          {info.consent === "pending" ? <ConsentButtons onAnswer={consent} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { const m = !muted; setMuted(m); if (r.current.cap) r.current.cap.muted = m; }}>{muted ? "Unmute microphone" : "Mute microphone"}</Button>
            <Button onClick={() => { if (r.current.cap?.forceEnd() === false && r.current.consented) r.current.sock?.send({ type: "end_turn" }); }} disabled={info.consent !== "accepted"}>I'm done speaking</Button>
            <Button
              onClick={() => {
                const p = r.current.player;
                const cur = p?.current;
                const played = cur ? p!.playedMs(cur) : undefined;
                p?.flush();
                r.current.sock?.send({ type: "interrupt", playedMs: played });
              }}
              disabled={!speaking}
            >
              Interrupt
            </Button>
            <Button variant="danger" onClick={() => { r.current.sock?.send({ type: "end" }); setTimeout(() => { teardown(); setPhase("closed"); onChange(); }, 300); }}>
              End interview
            </Button>
          </div>
        </div>
      )}
      {err ? <div className="mt-2"><Notice tone="bad">{err}</Notice></div> : null}
    </Card>
  );
}

function Transcript({ info }: { info: Info }) {
  if (!info.transcript.length) return null;
  return (
    <Card title="Conversation so far">
      <ol className="space-y-2 text-sm">
        {info.transcript.map((t) => (
          <li key={t.seq}>
            <span className="text-xs font-semibold text-muted">{t.speaker === "interviewer" ? "Interviewer" : t.speaker === "expert" ? "You" : "System"}:</span> {t.text ?? <span className="italic text-muted">(transcribing…)</span>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
