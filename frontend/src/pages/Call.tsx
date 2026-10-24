// Test call: the AI interviewer calls you. Pick who you are pretending to be, press Answer, and talk.
// Everything runs through the real backend (POST /api/calls); this page is only the handset.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, Badge, Button, Card, Field, inputCls, Notice } from "../components/ui";
import { api, errorText } from "../lib/api";
import { ParticipantView } from "./Join";

interface Persona {
  id: string;
  name: string;
  title: string;
  organization: string;
  background: string;
  isDefault: boolean;
}
interface ModeOption {
  available: boolean;
  label: string;
  requirement: string | null;
}
interface Models {
  voice: { model: string; transcription: string } | null;
  reasoning: { provider: string; model: string | null };
}
interface Setup {
  projectId: string;
  personas: Persona[];
  modes: { voice: ModeOption; typed: ModeOption };
  models: Models;
  activeInterview: { id: string; replaceable: boolean } | null;
}
interface Started {
  interviewId: string;
  projectId: string;
  joinToken: string;
  statusPath: string;
  modeLabel: string;
  persona: { name: string; title: string; background: string };
  models: Models;
  voice: boolean;
}

function modelLine(m: Models) {
  const reasoning = m.reasoning.provider === "anthropic" ? `Claude (${m.reasoning.model})` : "scripted mock reasoning (no LLM)";
  return m.voice ? `Voice: Higgs ${m.voice.model}, transcription ${m.voice.transcription} · Questions chosen by: ${reasoning}` : `No audio · Questions chosen by: ${reasoning}`;
}

export function CallPage() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState("");
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [call, setCall] = useState<Started | null>(null);

  useEffect(() => {
    api
      .get<Setup>("/api/calls/setup")
      .then((s) => {
        setSetup(s);
        setPersonaId(s.personas.find((p) => p.isDefault)?.id ?? s.personas[0]?.id ?? "");
      })
      .catch((e) => setErr(errorText(e)));
  }, []);

  const answer = async (voice: boolean) => {
    setErr(null);
    const body = custom ? { voice, persona: { name, title, background } } : { voice, personaId };
    const started = await api.post<Omit<Started, "voice">>("/api/calls", body);
    setCall({ ...started, voice });
  };

  if (call)
    return (
      <Page>
        <Card
          title={`Call in progress: you are ${call.persona.name}`}
          actions={<Button size="sm" onClick={() => setCall(null)}>New call</Button>}
        >
          <p className="text-sm">{call.persona.title}</p>
          <p className="mt-1 text-xs text-muted">{call.persona.background}</p>
          <p className="mt-2 text-xs text-muted">{modelLine(call.models)}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <a className="text-accent-700 underline" href={call.statusPath} target="_blank" rel="noreferrer">Call diagnostics (JSON)</a>
            <Link className="text-accent-700 underline" to={`/projects/${call.projectId}/live?interview=${call.interviewId}`} target="_blank">Watch in the consultant workspace</Link>
          </div>
        </Card>
        <ParticipantView token={call.joinToken} autoJoin={call.voice} bare />
      </Page>
    );

  const persona = setup?.personas.find((p) => p.id === personaId);
  const customOk = name.trim().length > 0 && background.trim().length >= 3;
  return (
    <Page>
      <Card title="Incoming call from an AI research interviewer">
        {!setup ? (
          err ? <Notice tone="bad">{err}</Notice> : <div className="text-sm text-muted">Preparing the call…</div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Play the person being called. The AI introduces itself, asks whether you agree to take part (answer out loud), then asks research questions about{" "}
              <span className="font-medium">Northstar Dental Group</span>, a fictional company. Say “I have to go, bye” to hang up.
            </p>
            {!custom ? (
              <Field label="You are">
                <select className={inputCls} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                  {setup.personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {p.title}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="grid gap-2">
                <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Patel" /></Field>
                <Field label="Role"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Patient at the Ottawa clinic" /></Field>
                <Field label="Background the interviewer may use"><textarea className={inputCls} rows={2} value={background} onChange={(e) => setBackground(e.target.value)} /></Field>
              </div>
            )}
            {!custom && persona ? <p className="text-xs text-muted">{persona.background}</p> : null}
            <button className="text-xs text-accent-700 underline" onClick={() => setCustom((c) => !c)}>
              {custom ? "Pick one of the demo people instead" : "Play someone else"}
            </button>
            <p className="text-xs text-muted">{modelLine(setup.models)}</p>
            {setup.activeInterview && !setup.activeInterview.replaceable ? <Notice tone="warn">A real participant interview is active; end it before starting a test call.</Notice> : null}
            {setup.activeInterview?.replaceable ? <Notice tone="info">Answering ends the previous test call.</Notice> : null}
            {!setup.modes.voice.available ? <Notice tone="warn">{setup.modes.voice.requirement}</Notice> : null}
            {err ? <Notice tone="bad">{err}</Notice> : null}
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton variant="primary" disabled={!setup.modes.voice.available || (custom && !customOk)} onFail={setErr} action={() => answer(true)}>
                Answer call
              </ActionButton>
              <ActionButton disabled={custom && !customOk} onFail={setErr} action={() => answer(false)}>
                Answer by typing (no audio)
              </ActionButton>
              <Badge tone={setup.modes.voice.available ? "good" : "warn"}>{setup.modes.voice.available ? setup.modes.voice.label : "Voice unavailable"}</Badge>
            </div>
            <p className="text-xs text-muted">Use headphones so the interviewer's voice does not reach your microphone. Your browser will ask for microphone access.</p>
          </div>
        )}
      </Card>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <div className="flex h-12 items-center justify-between border-b border-line bg-white px-6">
        <span className="font-semibold">Test call</span>
        <Link className="text-sm text-accent-700 underline" to="/">Workspace</Link>
      </div>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
