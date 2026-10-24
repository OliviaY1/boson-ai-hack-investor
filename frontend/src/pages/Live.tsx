import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { EvidenceRecord, InterviewMode, InterviewRecord, TurnRecord } from "../../../shared/contracts";
import { MODE_LABELS } from "../../../shared/contracts";
import { ActionButton, Badge, Button, Card, cx, Empty, Field, inputCls, Notice, SyntheticBadge } from "../components/ui";
import { api } from "../lib/api";
import {
  activeClaims,
  activeQuestions,
  ASSESSMENT_LABELS,
  ASSESSMENT_TONE,
  COVERAGE_LABELS,
  COVERAGE_TONE,
  currentPlan,
  DELIVERY_LABELS,
  duration,
  human,
  LIFECYCLE_LABELS,
  liveInterview,
  when,
} from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import { NewQuestion } from "./Plan";

const LIVE = ["awaiting_participant", "consent_pending", "active", "paused"];
const tokenKey = (id: string) => `dl-join-${id}`;
function rememberToken(id: string, t: string | null) {
  try {
    if (t) sessionStorage.setItem(tokenKey(id), t);
  } catch {
    /* storage unavailable */
  }
}
function recallToken(id: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
}

export function LivePage() {
  const { snapshot: s } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const live = liveInterview(s);
  const selectedId = params.get("interview") ?? live?.id ?? null;
  const iv = selectedId ? s.interviews[selectedId] ?? null : null;
  const interviews = Object.values(s.interviews).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Live research</h1>
        <div className="flex-1" />
        {interviews.length ? (
          <select
            className="rounded-md border border-line bg-white px-2 py-1 text-sm"
            value={iv?.id ?? ""}
            onChange={(e) => setParams(e.target.value ? { interview: e.target.value } : {})}
          >
            <option value="">{live ? "Current interview" : "Start a new interview"}</option>
            {interviews.map((i) => (
              <option key={i.id} value={i.id}>
                {s.experts[i.expertId]?.name} · {LIFECYCLE_LABELS[i.lifecycle]} · {when(i.startedAt ?? i.createdAt)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {iv ? <InterviewView iv={iv} /> : <StartInterview />}
    </div>
  );
}

function StartInterview() {
  const { snapshot: s, caps, unapproved } = useWorkspace();
  const [, setParams] = useSearchParams();
  const plan = currentPlan(s);
  const rankings = Object.values(s.rankings).filter((r) => r.planId === plan?.id).sort((a, b) => a.rank - b.rank);
  const experts = Object.values(s.experts).filter((e) => !e.deleted);
  const ordered = [...rankings.map((r) => experts.find((e) => e.id === r.expertId)).filter((e): e is NonNullable<typeof e> => !!e), ...experts.filter((e) => !rankings.some((r) => r.expertId === e.id))];
  const done = new Set(Object.values(s.interviews).filter((i) => i.lifecycle === "ended").map((i) => i.expertId));
  const firstPick = rankings.find((r) => r.selected && !done.has(r.expertId))?.expertId ?? rankings.find((r) => r.recommended && !done.has(r.expertId))?.expertId ?? ordered[0]?.id ?? "";
  const [expertId, setExpertId] = useState(firstPick);
  const modes = (caps?.modes ?? []).filter((m) => m.mode !== "fixture");
  const [mode, setMode] = useState<InterviewMode>("synthetic");
  const [localTest, setLocalTest] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setExpertId((x) => x || firstPick);
  }, [firstPick]);
  const interrupted = Object.values(s.interviews).filter((i) => i.lifecycle === "interrupted");
  const approved = plan?.status === "approved";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card title="Start an expert interview">
        {!plan ? (
          <Empty>Generate and approve a research plan before interviewing.</Empty>
        ) : (
          <div className="space-y-3">
            {!approved ? <Notice tone="warn">The research plan must be approved before an interview can start.</Notice> : null}
            {approved && unapproved ? <Notice tone="info">The plan has edits since approval. The interview will use the latest questions; approve again to record a new plan version.</Notice> : null}
            <Field label="Expert">
              <select className={inputCls} value={expertId} onChange={(e) => setExpertId(e.target.value)}>
                {ordered.map((e) => {
                  const r = rankings.find((x) => x.expertId === e.id);
                  return (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.isSynthetic ? " (synthetic)" : ""}
                      {r ? ` · #${r.rank}${r.recommended ? " recommended" : ""}` : ""}
                      {done.has(e.id) ? " · interviewed" : ""}
                    </option>
                  );
                })}
              </select>
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-muted">Mode</legend>
              {modes.map((m) => (
                <label key={m.mode} className={cx("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", mode === m.mode ? "border-accent-600 bg-accent-50" : "border-line", !m.available && "opacity-60")}>
                  <input type="radio" name="mode" disabled={!m.available} checked={mode === m.mode} onChange={() => setMode(m.mode)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    {m.requirement ? <span className="block text-xs text-muted">{m.requirement}</span> : null}
                    {m.mode === "synthetic" ? <span className="block text-xs text-muted">No microphone, no audio, nobody is contacted. A scripted respondent answers through the same controller path.</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            {mode !== "synthetic" ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={localTest} onChange={(e) => setLocalTest(e.target.checked)} />
                Local browser test: I will act as the respondent in another tab of this browser
              </label>
            ) : null}
            {err ? <Notice tone="bad">{err}</Notice> : null}
            <ActionButton
              variant="primary"
              disabled={!approved || !expertId}
              onFail={setErr}
              action={async () => {
                setErr(null);
                const { id } = await api.post<{ id: string }>(`/api/projects/${s.project.id}/interviews`, { expertId, mode, localTest: mode !== "synthetic" && localTest });
                const r = await api.post<{ joinToken: string | null }>(`/api/projects/${s.project.id}/interviews/${id}/start`);
                rememberToken(id, r.joinToken);
                setParams({ interview: id });
              }}
            >
              Start interview
            </ActionButton>
            <p className="text-xs text-muted">Only one expert interview can be active at a time. The interviewer identifies itself as AI and asks for consent before any substantive question.</p>
          </div>
        )}
      </Card>
      <div className="space-y-4">
        {interrupted.length ? (
          <Card title="Interrupted interviews">
            <ul className="space-y-2 text-sm">
              {interrupted.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span>{s.experts[i.expertId]?.name} · {when(i.startedAt)}</span>
                  <Button size="sm" onClick={() => setParams({ interview: i.id })}>Open</Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card title="Claim assessments">
          <ClaimSummary />
        </Card>
      </div>
    </div>
  );
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

function InterviewView({ iv }: { iv: InterviewRecord }) {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const nav = useNavigate();
  const expert = s.experts[iv.expertId];
  const isLive = LIVE.includes(iv.lifecycle);
  useTick(isLive);
  const [joinToken, setJoinToken] = useState<string | null>(() => recallToken(iv.id));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setJoinToken(recallToken(iv.id));
  }, [iv.id]);
  const joinUrl = joinToken ? `${location.origin}/join/${joinToken}` : null;
  const call = (suffix: string, body?: unknown) => api.post<any>(`/api/projects/${pid}/interviews/${iv.id}/${suffix}`, body);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{expert?.name ?? "Unknown expert"}</span>
            {expert?.isSynthetic ? <SyntheticBadge /> : null}
            <Badge tone={iv.lifecycle === "active" ? "good" : iv.lifecycle === "interrupted" ? "warn" : iv.lifecycle === "ended" ? "neutral" : "info"}>{LIFECYCLE_LABELS[iv.lifecycle]}</Badge>
            <Badge tone={iv.consent === "accepted" ? "good" : iv.consent === "pending" ? "neutral" : "bad"}>Consent {iv.consent}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {[expert?.title, expert?.organization].filter(Boolean).join(", ")} · Mode: <span className={iv.mode === "live_voice_mock_reasoning" ? "font-semibold text-amber-700" : ""}>{MODE_LABELS[iv.mode]}</span> · Transport: {iv.transport === "simulated" ? "simulated (no audio)" : iv.transport === "browser_ws" ? "browser WebSocket → Higgs realtime" : "fixture"}
            {iv.localTest ? " · local browser test (consultant acting as respondent)" : ""} · Plan v{iv.planVersion ?? "—"} · Duration {duration(iv.startedAt, iv.endedAt)}
            {iv.terminationReason ? ` · Ended: ${human(iv.terminationReason)}` : ""}
            {iv.pauseReason && iv.lifecycle === "paused" ? ` · Paused: ${human(iv.pauseReason)}` : ""}
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {iv.transport === "simulated" && isLive ? (
            <ActionButton variant="primary" action={async () => { const r = await call("respond"); setMsg(r.action === "consent_accepted" ? "Scripted respondent accepted consent." : r.action === "answered" ? "Scripted respondent answered the current question." : r.action === "waiting" ? "Nothing to answer yet: the interviewer is waiting for the controller." : String(r.action)); }} onFail={setErr}>
              Advance scripted respondent
            </ActionButton>
          ) : null}
          {iv.lifecycle === "active" ? <ActionButton action={() => call("pause", { reason: "consultant" })} onFail={setErr}>Pause questions</ActionButton> : null}
          {iv.lifecycle === "paused" ? <ActionButton action={() => call("resume")} onFail={setErr}>Resume</ActionButton> : null}
          {isLive ? (
            <ActionButton variant="danger" onFail={setErr} action={async () => { if (confirm("End this interview? Pending speech and controller work are cancelled.")) await call("stop", { reason: "consultant_ended" }); }}>
              End interview
            </ActionButton>
          ) : null}
          {iv.lifecycle === "interrupted" ? (
            <ActionButton variant="primary" onFail={setErr} action={async () => { const r = await call("resume-interrupted"); rememberToken(iv.id, r.joinToken); setJoinToken(r.joinToken); }}>
              Resume interview
            </ActionButton>
          ) : null}
          {!isLive && iv.lifecycle !== "interrupted" ? <Button onClick={() => nav(`/projects/${pid}/live`)}>New interview</Button> : null}
        </div>
      </div>
      {iv.mode === "live_voice_mock_reasoning" ? <Notice tone="warn">Live Higgs voice with MOCK reasoning: questions and extractions come from the deterministic mock, not a reasoning model.</Notice> : null}
      {isLive && iv.transport !== "fixture" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm">
          <span className="text-muted">Participant link (interview-scoped, expiring {when(iv.joinTokenExpiresAt)}):</span>
          {joinUrl ? (
            <>
              <code className="max-w-md truncate rounded bg-surface px-1.5 py-0.5 text-xs">{joinUrl}</code>
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(joinUrl)}>Copy</Button>
              <a className="text-xs text-accent-700 underline" href={joinUrl} target="_blank" rel="noreferrer">
                {iv.localTest ? "Open as respondent (local test)" : "Open participant view"}
              </a>
            </>
          ) : (
            <span className="text-xs text-muted">Not shown after reload (only a hash is stored).</span>
          )}
          <ActionButton size="sm" variant="ghost" onFail={setErr} action={async () => { const r = await call("join-link"); rememberToken(iv.id, r.joinToken); setJoinToken(r.joinToken); }}>
            Issue new link
          </ActionButton>
        </div>
      ) : null}
      {msg ? <Notice tone="info">{msg}</Notice> : null}
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid gap-3 xl:grid-cols-[1.25fr_1fr_1.1fr]">
        <TranscriptPanel iv={iv} />
        <QueuePanel iv={iv} />
        <EvidencePanel iv={iv} />
      </div>
      <DecisionLog iv={iv} />
    </div>
  );
}

function TranscriptPanel({ iv }: { iv: InterviewRecord }) {
  const { snapshot: s } = useWorkspace();
  const [params] = useSearchParams();
  const focus = params.get("turn");
  const focusV = Number(params.get("v") ?? 0);
  const fs = Number(params.get("s") ?? -1);
  const fe = Number(params.get("e") ?? -1);
  const turns = Object.values(s.turns).filter((t) => t.interviewId === iv.id).sort((a, b) => a.seq - b.seq);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) document.getElementById(`turn-${focus}`)?.scrollIntoView({ block: "center" });
    else endRef.current?.scrollIntoView({ block: "nearest" });
  }, [focus, turns.length]);
  return (
    <Card title="Transcript" className="flex max-h-[70vh] flex-col">
      <div className="-m-4 max-h-[calc(70vh-48px)] space-y-2 overflow-y-auto p-4">
        {turns.length === 0 ? <Empty>No turns yet.</Empty> : null}
        {turns.map((t) => (
          <TurnView key={t.id} t={t} focused={focus === t.id} focusV={focusV} span={focus === t.id ? [fs, fe] : null} />
        ))}
        <div ref={endRef} />
      </div>
    </Card>
  );
}

function TurnView({ t, focused, focusV, span }: { t: TurnRecord; focused: boolean; focusV: number; span: [number, number] | null }) {
  const { snapshot: s } = useWorkspace();
  const [edit, setEdit] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const delivery = t.deliveryId ? s.deliveries[t.deliveryId] : null;
  const shownVersion = focused && focusV ? t.versions.find((v) => v.version === focusV) ?? null : null;
  const text = shownVersion ? shownVersion.text : t.text;
  const label = t.speaker === "interviewer" ? "AI interviewer" : t.speaker === "expert" ? s.experts[s.interviews[t.interviewId]?.expertId]?.name ?? "Expert" : "System";
  let body: React.ReactNode = text;
  if (span && span[0] >= 0 && span[1] > span[0] && text && span[1] <= text.length) {
    body = (
      <>
        {text.slice(0, span[0])}
        <mark className="cite">{text.slice(span[0], span[1])}</mark>
        {text.slice(span[1])}
      </>
    );
  }
  return (
    <div id={`turn-${t.id}`} className={cx("rounded-md px-3 py-2", t.speaker === "expert" ? "bg-white ring-1 ring-line" : "bg-surface", focused && "ring-2 ring-amber-400")}>
      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">{label}</span>
        <span>#{t.seq}</span>
        {t.currentVersion > 1 ? <Badge tone="info">v{t.currentVersion} corrected</Badge> : null}
        {shownVersion && shownVersion.version !== t.currentVersion ? <Badge tone="warn">Showing cited v{shownVersion.version} (current v{t.currentVersion})</Badge> : null}
        {delivery ? <Badge tone={delivery.state === "completed" ? "neutral" : delivery.state === "interrupted" ? "warn" : delivery.state === "speaking" ? "accent" : "neutral"}>{DELIVERY_LABELS[delivery.state]}</Badge> : null}
        {t.afterEnd ? <Badge tone="warn">After end: extraction only</Badge> : null}
        <span>{when(t.startedAt)}</span>
        {t.speaker === "expert" && t.finality === "final" ? (
          <button className="ml-auto text-accent-700 underline" onClick={() => setEdit(t.text)}>
            Correct transcript
          </button>
        ) : null}
        {t.versions.length > 1 ? (
          <button className="text-accent-700 underline" onClick={() => setShowHistory((x) => !x)}>
            History
          </button>
        ) : null}
      </div>
      {t.finality === "pending" ? <div className="italic text-muted">Transcribing…</div> : t.finality === "missing" ? <div className="italic text-amber-700">Transcription unavailable for this turn; nothing was inferred.</div> : <div className="whitespace-pre-wrap">{body}</div>}
      {delivery?.state === "interrupted" ? <div className="mt-1 text-xs text-amber-700">Interrupted after ~{Math.round((delivery.playedMs ?? 0) / 100) / 10}s of playback{delivery.actualTranscript ? `; heard: “${delivery.actualTranscript.slice(0, 120)}”` : ""}</div> : null}
      {showHistory ? (
        <ol className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
          {t.versions.map((v) => (
            <li key={v.version}>
              v{v.version} ({v.reason}, {when(v.createdAt)}): {v.text}
            </li>
          ))}
        </ol>
      ) : null}
      {edit !== null ? (
        <div className="mt-2 space-y-1.5">
          <textarea className={inputCls} rows={3} value={edit} onChange={(e) => setEdit(e.target.value)} />
          <div className="text-xs text-muted">A correction creates a new version. Extractions quoting the old text are invalidated and re-extracted against the new version.</div>
          <div className="flex gap-1">
            <ActionButton size="sm" variant="primary" action={async () => { await api.patch(`/api/projects/${s.project.id}/turns/${t.id}`, { text: edit }); setEdit(null); }}>Save correction</ActionButton>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function originRank(o: string) {
  return o === "controller" || o === "copilot" || o === "consultant" ? 0 : 1;
}

function QueuePanel({ iv }: { iv: InterviewRecord }) {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const questions = activeQuestions(s);
  const isLive = LIVE.includes(iv.lifecycle);
  const [adding, setAdding] = useState(false);
  const [directive, setDirective] = useState("");
  const deliveries = Object.values(s.deliveries).filter((d) => d.interviewId === iv.id).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const cov = (qid: string) => s.coverage[`${iv.id}:${qid}`];
  const lastDelivery = (qid: string) => [...deliveries].reverse().find((d) => d.questionId === qid);
  const current = [...deliveries].reverse().find((d) => d.kind === "question" && ["queued", "speaking", "completed"].includes(d.state));
  const upcoming = questions
    .filter((q) => (cov(q.id)?.coverage ?? "pending") === "pending" && !deliveries.some((d) => d.questionId === q.id && ["completed", "speaking", "queued"].includes(d.state)))
    .sort((a, b) => originRank(a.origin) - originRank(b.origin) || a.priority - b.priority || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const directives = Object.values(s.directives).filter((d) => d.interviewId === iv.id || (d.interviewId === null && d.status === "pending"));
  return (
    <Card title="Question coverage & delivery" className="max-h-[70vh] overflow-y-auto">
      {current ? (
        <div className="mb-3 rounded-md border border-accent-100 bg-accent-50 px-3 py-2 text-sm">
          <div className="text-xs font-medium text-accent-700">Current: {DELIVERY_LABELS[current.state]}</div>
          <div>{current.authorizedText}</div>
        </div>
      ) : null}
      <table className="w-full text-sm">
        <tbody>
          {questions.map((q) => {
            const c = cov(q.id);
            const d = lastDelivery(q.id);
            return (
              <tr key={q.id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-2 align-top font-mono text-xs">{q.code}</td>
                <td className="py-1.5 pr-2 align-top">
                  <div className="text-xs">{q.text}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {!q.isOriginal ? <Badge tone="accent">Added ({q.origin})</Badge> : null}
                    {d ? <Badge>{DELIVERY_LABELS[d.state]}</Badge> : null}
                  </div>
                  {c?.rationale && c.coverage !== "pending" ? <div className="mt-0.5 text-[11px] text-muted">{c.rationale}</div> : null}
                </td>
                <td className="py-1.5 align-top">
                  <Badge tone={COVERAGE_TONE[c?.coverage ?? "pending"]}>{COVERAGE_LABELS[c?.coverage ?? "pending"]}</Badge>
                  {isLive ? (
                    <select className="mt-1 block rounded border border-line px-1 py-0.5 text-xs" value={q.priority} title="Priority" onChange={(e) => void api.patch(`/api/projects/${pid}/questions/${q.id}`, { priority: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>P{n}</option>)}
                    </select>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {isLive ? (
        <>
          <div className="mt-3 text-xs font-semibold text-muted">Upcoming (controller decides; relevance to this expert applies)</div>
          <ol className="mt-1 list-decimal pl-5 text-xs">{upcoming.slice(0, 5).map((q) => <li key={q.id}>{q.code}: {q.text.slice(0, 90)}</li>)}</ol>
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <div className="text-xs font-semibold text-muted">Private directive to the controller</div>
            <textarea className={inputCls} rows={2} placeholder="e.g. Find out whether cancellations were concentrated in specific clinics." value={directive} onChange={(e) => setDirective(e.target.value)} />
            <div className="flex gap-2">
              <ActionButton size="sm" variant="primary" disabled={directive.trim().length < 3} action={async () => { await api.post(`/api/projects/${pid}/directives`, { instruction: directive }); setDirective(""); }}>Send privately</ActionButton>
              <Button size="sm" onClick={() => setAdding(true)}>Add exact follow-up question</Button>
            </div>
            <div className="text-[11px] text-muted">The expert never hears your directive; the controller turns it into a neutral question or ignores it.</div>
            {adding ? <NewQuestion interviewId={iv.id} onDone={() => setAdding(false)} /> : null}
          </div>
        </>
      ) : null}
      {directives.length ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
          {directives.map((d) => (
            <li key={d.id}>
              <Badge tone={d.status === "consumed" ? "good" : "neutral"}>{d.status}</Badge> {d.instruction}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function EvidenceItem({ e, compact }: { e: EvidenceRecord; compact?: boolean }) {
  const { snapshot: s, go } = useWorkspace();
  const pid = s.project.id;
  const [note, setNote] = useState<string | null>(null);
  const turn = s.turns[e.turnId];
  const inactive = e.status !== "active";
  return (
    <div className={cx("rounded-md border border-line px-3 py-2 text-sm", inactive && "opacity-60")}>
      <button
        className="text-left italic text-ink underline decoration-dotted underline-offset-2 hover:text-accent-700"
        title="Open the cited transcript span"
        onClick={() => go({ kind: "turn", interviewId: e.interviewId, turnId: e.turnId, version: e.turnVersion, spanStart: e.spanStart, spanEnd: e.spanEnd })}
      >
        “{e.quote}”
      </button>
      <div className="mt-0.5 text-xs text-muted">
        {s.experts[e.expertId]?.name} · turn #{turn?.seq ?? "?"} v{e.turnVersion} · chars {e.spanStart}–{e.spanEnd}
      </div>
      {!compact ? <div className="mt-1">{e.statement}</div> : null}
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge tone={e.basis === "direct_observation" ? "good" : e.basis === "estimate" ? "warn" : "neutral"}>{human(e.basis)}</Badge>
        {e.links.map((l) => (
          <Badge key={l.claimId} tone={l.relation === "supports" ? "good" : l.relation === "challenges" ? "bad" : "neutral"} title={l.note}>
            {s.claims[l.claimId]?.code} {l.relation} · {human(l.comparability)}
            {l.disputed ? " · flagged" : ""}
          </Badge>
        ))}
        {inactive ? <Badge tone="warn">{e.status}{e.statusReason ? `: ${e.statusReason}` : ""}</Badge> : null}
        {e.reviewStatus !== "unreviewed" ? <Badge tone={e.reviewStatus === "accepted" ? "good" : "warn"}>{e.reviewStatus === "accepted" ? "extraction accepted" : "interpretation flagged"}</Badge> : null}
      </div>
      {!compact && (e.metric || e.value || e.period || e.population) ? (
        <div className="mt-1 text-xs text-muted">
          {[e.metric && `metric: ${e.metric}`, e.value && `value: ${e.value}${e.unit ? ` ${e.unit}` : ""}`, e.period && `period: ${e.period}`, e.population && `population: ${e.population}`, e.calcBasis && `basis: ${e.calcBasis}`].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {!inactive ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <ActionButton size="sm" variant="ghost" disabled={e.reviewStatus === "accepted"} action={() => api.post(`/api/projects/${pid}/evidence/${e.id}/review`, { action: "accept" })}>Accept extraction</ActionButton>
          <Button size="sm" variant="ghost" onClick={() => setNote("")}>Flag / note</Button>
        </div>
      ) : null}
      {note !== null ? (
        <div className="mt-1.5 space-y-1">
          <textarea className={inputCls} rows={2} placeholder="Why is the interpretation wrong, or what should be noted?" value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="flex gap-1">
            <ActionButton size="sm" variant="danger" disabled={!note.trim()} action={async () => { await api.post(`/api/projects/${pid}/evidence/${e.id}/review`, { action: "flag", note }); setNote(null); }}>Flag interpretation</ActionButton>
            <ActionButton size="sm" disabled={!note.trim()} action={async () => { await api.post(`/api/projects/${pid}/evidence/${e.id}/review`, { action: "note", note }); setNote(null); }}>Add note</ActionButton>
            <Button size="sm" variant="ghost" onClick={() => setNote(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EvidencePanel({ iv }: { iv: InterviewRecord }) {
  const { snapshot: s } = useWorkspace();
  const ev = Object.values(s.evidence).filter((e) => e.interviewId === iv.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const findings = Object.values(s.findings).filter((f) => f.interviewId === iv.id);
  return (
    <Card title="Emerging evidence & claim assessments" className="max-h-[70vh] overflow-y-auto">
      <ClaimSummary />
      {findings.length ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs font-semibold text-muted">Proposed interpretations (review on Findings)</div>
          {findings.map((f) => (
            <div key={f.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              {f.text} <Badge tone={f.status === "flagged" ? "warn" : f.status === "accepted" ? "good" : "neutral"}>{f.status}</Badge>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        <div className="text-xs font-semibold text-muted">Observations from this interview ({ev.filter((e) => e.status === "active").length} active)</div>
        {ev.length === 0 ? <Empty>No observations extracted yet.</Empty> : ev.map((e) => <EvidenceItem key={e.id} e={e} />)}
      </div>
    </Card>
  );
}

function ClaimSummary() {
  const { snapshot: s, go } = useWorkspace();
  const claims = activeClaims(s);
  const gaps = claims.filter((c) => c.gaps.length);
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1 text-xs">
        {claims.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <button className="w-6 shrink-0 text-left font-mono text-accent-700" onClick={() => go({ kind: "claim", claimId: c.id })}>{c.code}</button>
            <span className="min-w-0 flex-1">
              {c.assertion}
              <span className="mt-0.5 block">
                <Badge tone={ASSESSMENT_TONE[c.assessment]}>{ASSESSMENT_LABELS[c.assessment]}</Badge>
              </span>
            </span>
          </li>
        ))}
      </ul>
      {gaps.length ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <div className="font-semibold">Evidence gaps</div>
          <ul className="mt-0.5 list-disc pl-4">{gaps.flatMap((c) => c.gaps.map((g, i) => <li key={c.id + i}>{c.code}: {g.description}</li>))}</ul>
        </div>
      ) : null}
    </div>
  );
}

function DecisionLog({ iv }: { iv: InterviewRecord }) {
  const { snapshot: s } = useWorkspace();
  const decisions = Object.values(s.decisions).filter((d) => d.interviewId === iv.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const metrics = Object.values(s.metrics).filter((m) => m.interviewId === iv.id);
  const byName = new Map<string, number[]>();
  for (const m of metrics) byName.set(m.name, [...(byName.get(m.name) ?? []), m.ms]);
  return (
    <details className="rounded-lg border border-line bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">Controller decisions ({decisions.length}) and latency</summary>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {[...byName.entries()].map(([k, v]) => (
          <span key={k} className="rounded bg-surface px-2 py-1">
            {human(k)}: median {v.sort((a, b) => a - b)[Math.floor(v.length / 2)]} ms (n={v.length})
          </span>
        ))}
      </div>
      <ul className="mt-2 space-y-1.5 text-xs">
        {decisions.map((d) => (
          <li key={d.id} className="border-b border-line pb-1.5">
            <Badge tone={d.result === "applied" ? "good" : d.result.startsWith("rejected") || d.result === "error" ? "bad" : "neutral"}>{human(d.result)}</Badge> {human(d.trigger)} · {d.provider} · {d.latencyMs} ms · next: {d.nextAction ?? "—"}
            <div className="text-muted">{d.rationale}</div>
            {d.rejectionReasons.length ? <div className="text-red-700">{d.rejectionReasons.join("; ")}</div> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
