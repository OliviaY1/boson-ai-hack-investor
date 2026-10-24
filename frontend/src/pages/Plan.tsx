import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ClaimRecord, QuestionRecord } from "../../../shared/contracts";
import { ActionButton, Badge, Button, Card, cx, Empty, Field, inputCls, Notice, SyntheticBadge, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { activeClaims, activeQuestions, ASSESSMENT_LABELS, ASSESSMENT_TONE, currentDocument, currentPlan, when } from "../lib/format";
import { useWorkspace } from "../lib/workspace";

export function PlanPage() {
  const { snapshot: s, unapproved, base } = useWorkspace();
  const pid = s.project.id;
  const plan = currentPlan(s);
  const claims = activeClaims(s);
  const questions = activeQuestions(s);
  const rankings = Object.values(s.rankings).filter((r) => r.planId === plan?.id).sort((a, b) => a.rank - b.rank);
  const [params] = useSearchParams();
  const focusClaim = params.get("claim");
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (focusClaim) document.getElementById(`claim-${focusClaim}`)?.scrollIntoView({ block: "center" });
  }, [focusClaim]);

  if (!plan)
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="text-lg font-semibold">Research plan</h1>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Empty>
          No plan yet.{" "}
          {currentDocument(s) ? (
            <ActionButton variant="primary" size="sm" action={() => api.post(`/api/projects/${pid}/plan/generate`)} onFail={setErr}>Generate research plan</ActionButton>
          ) : (
            <>Add a thesis on the <Link className="text-accent-700 underline" to={base}>Overview</Link> first.</>
          )}
        </Empty>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Research plan v{plan.version}</h1>
        <Badge tone={plan.status === "approved" && !unapproved ? "good" : "warn"}>{plan.status === "approved" ? (unapproved ? "Approved · edited since approval" : "Approved") : "Draft"}</Badge>
        {s.project.isSynthetic ? <SyntheticBadge /> : null}
        <span className="text-xs text-muted">
          Produced by {plan.producedBy}
          {plan.approvedAt ? ` · approved by ${plan.approvedBy} ${when(plan.approvedAt)}` : ""}
        </span>
        <div className="flex-1" />
        <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface" href={`/api/projects/${pid}/plan.docx`}>
          Export DOCX
        </a>
        <ActionButton variant="primary" disabled={plan.status === "approved" && !unapproved} action={() => api.post(`/api/projects/${pid}/plan/approve`, { reviewer: "consultant" })} onFail={setErr}>
          {plan.status === "approved" && unapproved ? `Approve as v${plan.version + 1}` : "Approve plan"}
        </ActionButton>
      </div>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <p className="text-sm text-muted">Approving records this plan version. Starting an interview is a separate step on Live Research. Edits during a live interview reach the controller immediately; stale decisions are discarded.</p>

      <Card title={`Testable claims (${claims.length})`}>
        <div className="space-y-3">
          {claims.map((c) => (
            <ClaimRow key={c.id} c={c} focused={focusClaim === c.id} />
          ))}
        </div>
      </Card>

      <Card title="Recommended experts">
        {rankings.length === 0 ? (
          <Empty>No expert pool to rank. Add contacts on Expert Sources, then regenerate the plan.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Select</Th>
                <Th>Expert</Th>
                <Th>Why (grounded in documented background)</Th>
                <Th>Claims</Th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => {
                const e = s.experts[r.expertId];
                return (
                  <tr key={r.id} className={r.recommended ? "" : "text-muted"}>
                    <Td className="w-16">
                      <input type="checkbox" checked={r.selected} onChange={(ev) => void api.post(`/api/projects/${pid}/rankings/${r.id}`, { selected: ev.target.checked }).catch((x) => setErr(x.message))} />
                    </Td>
                    <Td className="w-56">
                      <div className="font-medium text-ink">#{r.rank} {e?.name ?? "removed contact"}</div>
                      <div className="text-xs">score {r.score}{r.recommended ? " · recommended" : ""}</div>
                    </Td>
                    <Td>
                      {r.rationale}
                      <div className="mt-1 text-xs">Background quote: <q className="italic">{r.backgroundQuote}</q></div>
                    </Td>
                    <Td className="w-28">{r.claimIds.map((id) => s.claims[id]?.code).filter(Boolean).join(", ")}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Interview questions (${questions.length})`} actions={<Button size="sm" onClick={() => setAdding(true)}>Add question</Button>}>
        {adding ? <NewQuestion onDone={() => setAdding(false)} /> : null}
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Question</Th>
              <Th>Priority</Th>
              <Th>Claims</Th>
              <Th>Origin</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} />
            ))}
          </tbody>
        </table>
        {Object.values(s.questions).some((q) => q.status === "removed") ? (
          <details className="mt-2 text-xs text-muted">
            <summary>Removed questions</summary>
            <ul className="mt-1 space-y-1">
              {Object.values(s.questions).filter((q) => q.status === "removed").map((q) => (
                <li key={q.id}>
                  <s>{q.code}: {q.text}</s>{" "}
                  <button className="text-accent-700 underline" onClick={() => void api.patch(`/api/projects/${pid}/questions/${q.id}`, { status: "active" })}>Restore</button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card title="Open gaps">
        {plan.gaps.length === 0 && claims.every((c) => c.gaps.length === 0) ? (
          <Empty>No gaps recorded.</Empty>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {plan.gaps.map((g, i) => (
              <li key={`p${i}`}>{g.description} <span className="text-xs text-muted">({g.claimIds.map((id) => s.claims[id]?.code).join(", ")})</span></li>
            ))}
            {claims.flatMap((c) => c.gaps.map((g, i) => <li key={`${c.id}${i}`}><span className="font-mono text-xs">{c.code}</span> {g.description} <span className="text-xs text-muted">({g.source})</span></li>))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ClaimRow({ c, focused }: { c: ClaimRecord; focused: boolean }) {
  const { snapshot: s, base } = useWorkspace();
  const [edit, setEdit] = useState<{ assertion: string; priority: number; scopeDefinition: string; metricDefinition: string } | null>(null);
  const passages = Object.values(s.documents).flatMap((d) => d.passages).filter((p) => c.passageIds.includes(p.id));
  return (
    <div id={`claim-${c.id}`} className={cx("rounded-md border border-line p-3", focused && "ring-2 ring-amber-400")}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-mono text-xs font-semibold text-accent-700">{c.code}</span>
        <span className="flex-1 font-medium">{c.assertion}</span>
        <Badge>P{c.priority}</Badge>
        <Badge tone={ASSESSMENT_TONE[c.assessment]}>{ASSESSMENT_LABELS[c.assessment]}</Badge>
        <Button size="sm" variant="ghost" onClick={() => setEdit({ assertion: c.assertion, priority: c.priority, scopeDefinition: c.scopeDefinition, metricDefinition: c.metricDefinition })}>Edit</Button>
      </div>
      {edit ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div className="md:col-span-2"><Field label="Assertion"><textarea className={inputCls} rows={2} value={edit.assertion} onChange={(e) => setEdit({ ...edit, assertion: e.target.value })} /></Field></div>
          <Field label="Scope definition"><input className={inputCls} value={edit.scopeDefinition} onChange={(e) => setEdit({ ...edit, scopeDefinition: e.target.value })} /></Field>
          <Field label="Metric definition"><input className={inputCls} value={edit.metricDefinition} onChange={(e) => setEdit({ ...edit, metricDefinition: e.target.value })} /></Field>
          <Field label="Priority"><select className={inputCls} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <div className="flex items-end gap-2">
            <ActionButton variant="primary" size="sm" action={async () => { await api.patch(`/api/projects/${s.project.id}/claims/${c.id}`, edit); setEdit(null); }}>Save</ActionButton>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
          <div><span className="text-muted">Scope:</span> {c.scopeDefinition || "—"}</div>
          <div><span className="text-muted">Metric:</span> {c.metricDefinition || "—"}</div>
          <div><span className="text-muted">Would support:</span> {c.evidenceSupporting || "—"}</div>
          <div><span className="text-muted">Would challenge:</span> {c.evidenceChallenging || "—"}</div>
          {c.missingDefinitions.length ? <div className="md:col-span-2"><span className="text-muted">Missing definitions:</span> {c.missingDefinitions.join("; ")}</div> : null}
        </div>
      )}
      <div className="mt-2 space-y-1">
        {passages.map((p) => (
          <Link key={p.id} to={`${base}?passage=${p.id}`} className="block rounded border-l-4 border-accent-100 bg-surface px-2 py-1 text-xs text-muted hover:border-accent-600">
            Source passage ¶{p.ordinal + 1}: “{p.text.slice(0, 220)}{p.text.length > 220 ? "…" : ""}”
          </Link>
        ))}
        {passages.length === 0 ? <div className="text-xs text-amber-700">No source passage linked.</div> : null}
      </div>
    </div>
  );
}

function QuestionRow({ q }: { q: QuestionRecord }) {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const [edit, setEdit] = useState<{ text: string; purpose: string } | null>(null);
  return (
    <tr>
      <Td className="w-14 font-mono text-xs">{q.code}</Td>
      <Td>
        {edit ? (
          <div className="space-y-1.5">
            <textarea className={inputCls} rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            <input className={inputCls} value={edit.purpose} placeholder="Purpose" onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} />
            <div className="flex gap-1">
              <ActionButton size="sm" variant="primary" action={async () => { await api.patch(`/api/projects/${pid}/questions/${q.id}`, edit); setEdit(null); }}>Save revision</ActionButton>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div>{q.text}</div>
            <div className="text-xs text-muted">{q.purpose}{q.currentRevision > 1 ? ` · revision ${q.currentRevision}` : ""}</div>
          </>
        )}
      </Td>
      <Td className="w-24">
        <select className={inputCls} value={q.priority} onChange={(e) => void api.patch(`/api/projects/${pid}/questions/${q.id}`, { priority: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>P{n}</option>)}
        </select>
      </Td>
      <Td className="w-24 text-xs">{q.claimIds.map((id) => s.claims[id]?.code).filter(Boolean).join(", ")}</Td>
      <Td className="w-32">
        <Badge tone={q.isOriginal ? "neutral" : "accent"}>{q.isOriginal ? "Original" : `Added (${q.origin})`}</Badge>
      </Td>
      <Td className="w-32 whitespace-nowrap">
        <Button size="sm" variant="ghost" onClick={() => setEdit({ text: q.text, purpose: q.purpose })}>Edit</Button>
        <ActionButton size="sm" variant="ghost" action={() => api.patch(`/api/projects/${pid}/questions/${q.id}`, { status: "removed" })}>Remove</ActionButton>
      </Td>
    </tr>
  );
}

export function NewQuestion({ onDone, interviewId = null }: { onDone: () => void; interviewId?: string | null }) {
  const { snapshot: s } = useWorkspace();
  const claims = activeClaims(s);
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState("");
  const [priority, setPriority] = useState(1);
  const [claimIds, setClaimIds] = useState<string[]>([]);
  return (
    <div className="mb-3 space-y-2 rounded-md border border-line bg-surface p-3">
      <Field label="Question (asked verbatim; keep it neutral and non-leading)"><textarea className={inputCls} rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <Field label="Purpose"><input className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>Priority <select className="ml-1 rounded border border-line px-1 py-0.5" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>P{n}</option>)}</select></label>
        {claims.map((c) => (
          <label key={c.id} className="inline-flex items-center gap-1 text-xs">
            <input type="checkbox" checked={claimIds.includes(c.id)} onChange={(e) => setClaimIds(e.target.checked ? [...claimIds, c.id] : claimIds.filter((x) => x !== c.id))} />
            {c.code}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <ActionButton variant="primary" size="sm" disabled={text.trim().length < 3} action={async () => { await api.post(`/api/projects/${s.project.id}/questions`, { text, purpose, priority, claimIds, interviewId }); onDone(); }}>Add question</ActionButton>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
