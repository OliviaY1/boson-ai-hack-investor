import { useState } from "react";
import type { FindingRecord } from "../../../shared/contracts";
import { buildSynthesis } from "../../../shared/synthesis";
import { ActionButton, Badge, Button, Card, Empty, Field, inputCls, Notice, SyntheticBadge } from "../components/ui";
import { api } from "../lib/api";
import { ASSESSMENT_LABELS, ASSESSMENT_TONE, human } from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import { EvidenceItem } from "./Live";

export function FindingsPage() {
  const { snapshot: s } = useWorkspace();
  const syn = buildSynthesis(s);
  const findings = Object.values(s.findings).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pid = s.project.id;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Findings</h1>
        {s.project.isSynthetic ? <SyntheticBadge /> : null}
        <div className="flex-1" />
        <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface" href={`/api/projects/${pid}/report.html`} target="_blank" rel="noreferrer">
          Printable report
        </a>
        <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface" href={`/api/projects/${pid}/plan.docx`}>
          Question plan (DOCX)
        </a>
      </div>

      <Card title="Executive synthesis">
        {syn.headline.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{syn.headline.map((h, i) => <li key={i}>{h}</li>)}</ul>
        ) : (
          <Empty>No findings yet. Run an interview to gather evidence.</Empty>
        )}
        <p className="mt-2 text-xs text-muted">{syn.operational}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Limits</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">{syn.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Unresolved questions</div>
            {syn.unresolved.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{syn.unresolved.map((l, i) => <li key={i}>{l}</li>)}</ul> : <div className="text-sm text-muted">None recorded.</div>}
          </div>
        </div>
      </Card>

      <Card title={`Interpretations (${findings.length})`}>
        <p className="mb-2 text-xs text-muted">Proposed by the controller from cited observations. Accepting records your judgment; it does not turn an estimate into a verified fact.</p>
        {findings.length === 0 ? <Empty>No interpretations proposed yet.</Empty> : <div className="space-y-3">{findings.map((f) => <FindingView key={f.id} f={f} />)}</div>}
      </Card>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Claim-by-claim assessment</h2>
        {syn.claims.map((c) => (
          <Card
            key={c.claim.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-accent-700">{c.claim.code}</span> {c.claim.assertion}
              </span>
            }
            actions={<Badge tone={ASSESSMENT_TONE[c.claim.assessment]}>{ASSESSMENT_LABELS[c.claim.assessment]}</Badge>}
          >
            <p className="mb-2 text-xs text-muted">{c.claim.assessmentRationale}</p>
            {[
              ["Supporting", c.supporting],
              ["Challenging", c.challenging],
              ["Unresolved", c.unresolved],
            ].map(([label, list]) =>
              (list as typeof c.supporting).length ? (
                <div key={label as string} className="mb-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label as string}</div>
                  <div className="space-y-1.5">{(list as typeof c.supporting).map((e) => <EvidenceItem key={e.id} e={e} />)}</div>
                </div>
              ) : null,
            )}
            {c.inactive.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted">Superseded, retracted, or invalidated ({c.inactive.length}) — kept for history</summary>
                <div className="mt-1 space-y-1.5">{c.inactive.map((e) => <EvidenceItem key={e.id} e={e} compact />)}</div>
              </details>
            ) : null}
            {c.claim.gaps.length ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                {c.claim.gaps.map((g, i) => <div key={i}>Gap: {g.description}</div>)}
              </div>
            ) : null}
            {!c.supporting.length && !c.challenging.length && !c.unresolved.length ? <div className="text-sm text-muted">No interview evidence yet.</div> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

function FindingView({ f }: { f: FindingRecord }) {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const [mode, setMode] = useState<"flag" | "note" | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="flex-1 font-medium">{f.text}</span>
        <Badge>{human(f.kind)}</Badge>
        <Badge tone={f.status === "accepted" ? "good" : f.status === "flagged" ? "warn" : "neutral"}>{f.status}</Badge>
      </div>
      <div className="mt-1 text-xs text-muted">Claims: {f.claimIds.map((id) => s.claims[id]?.code).join(", ") || "—"}</div>
      {f.reviewNote ? <div className="mt-1 text-sm">Consultant: {f.reviewNote}</div> : null}
      {f.nextEvidenceNeeded ? <div className="mt-1 text-sm">Next evidence needed: {f.nextEvidenceNeeded}</div> : null}
      <div className="mt-2 space-y-1.5">
        {f.evidenceIds.map((id) => (s.evidence[id] ? <EvidenceItem key={id} e={s.evidence[id]} compact /> : <div key={id} className="text-xs text-muted">{id} (unavailable)</div>))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <ActionButton size="sm" disabled={f.status === "accepted"} action={() => api.post(`/api/projects/${pid}/findings/${f.id}/review`, { action: "accept" })}>Accept interpretation</ActionButton>
        <Button size="sm" variant="danger" onClick={() => setMode("flag")}>Flag overstated interpretation</Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("note")}>Add note</Button>
      </div>
      {mode ? (
        <div className="mt-2 space-y-2 rounded-md bg-surface p-2">
          <Field label={mode === "flag" ? "What is overstated?" : "Note"}>
            <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {mode === "flag" ? (
            <Field label="Next evidence needed">
              <input className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder="e.g. Clinic-level cancellation logs matched to vacancy dates" />
            </Field>
          ) : null}
          {err ? <Notice tone="bad">{err}</Notice> : null}
          <div className="flex gap-1">
            <ActionButton
              size="sm"
              variant="primary"
              disabled={!note.trim()}
              onFail={setErr}
              action={async () => {
                await api.post(`/api/projects/${pid}/findings/${f.id}/review`, { action: mode, note, nextEvidence: mode === "flag" && next.trim() ? next : null });
                setMode(null);
                setNote("");
                setNext("");
              }}
            >
              Save
            </ActionButton>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
