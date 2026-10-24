import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ActionButton, Badge, Button, Card, cx, Empty, Field, inputCls, Notice } from "../components/ui";
import { api } from "../lib/api";
import { activeClaims, activeQuestions, ASSESSMENT_LABELS, ASSESSMENT_TONE, currentDocument, currentPlan, liveInterview, when } from "../lib/format";
import { useWorkspace } from "../lib/workspace";

export function OverviewPage() {
  const ws = useWorkspace();
  const { snapshot: s, caps, voice, unapproved, openCopilot } = ws;
  const pid = s.project.id;
  const [params] = useSearchParams();
  const focusPassage = params.get("passage");
  const doc = currentDocument(s);
  const plan = currentPlan(s);
  const claims = activeClaims(s);
  const questions = activeQuestions(s);
  const interviews = Object.values(s.interviews);
  const ended = interviews.filter((i) => i.lifecycle === "ended");
  const live = liveInterview(s);
  const interrupted = interviews.filter((i) => i.lifecycle === "interrupted");
  const coverageByQ = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of Object.values(s.coverage)) m.set(c.questionId, [...(m.get(c.questionId) ?? []), c.coverage]);
    return m;
  }, [s.coverage]);
  const answeredSomewhere = questions.filter((q) => (coverageByQ.get(q.id) ?? []).some((c) => c === "answered")).length;
  const proposedFindings = Object.values(s.findings).filter((f) => f.status === "proposed").length;
  const unreviewedEvidence = Object.values(s.evidence).filter((e) => e.status === "active" && e.reviewStatus === "unreviewed").length;
  const pendingDirectives = Object.values(s.directives).filter((d) => d.status === "pending").length;
  const claimByPassage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of claims) for (const p of c.passageIds) m.set(p, [...(m.get(p) ?? []), c.code]);
    return m;
  }, [claims]);

  const [editingThesis, setEditingThesis] = useState(false);
  const [thesisText, setThesisText] = useState("");
  const [editingProject, setEditingProject] = useState(false);
  const [company, setCompany] = useState(s.project.company);
  const [objective, setObjective] = useState(s.project.objective);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (focusPassage) document.getElementById(`passage-${focusPassage}`)?.scrollIntoView({ block: "center" });
  }, [focusPassage]);

  const voiceUnavailable = !caps?.bosonConfigured;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editingProject ? (
            <div className="space-y-2">
              <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
              <textarea className={inputCls} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
              <div className="flex gap-2">
                <ActionButton variant="primary" size="sm" action={async () => { await api.patch(`/api/projects/${pid}`, { company, objective }); setEditingProject(false); }}>Save</ActionButton>
                <Button size="sm" variant="ghost" onClick={() => setEditingProject(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">{s.project.company}</h1>
              <p className="mt-1 max-w-3xl text-muted">{s.project.objective}</p>
              <button className="mt-1 text-xs text-accent-700 underline" onClick={() => { setCompany(s.project.company); setObjective(s.project.objective); setEditingProject(true); }}>
                Edit company and objective
              </button>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={voiceUnavailable || voice.state === "connecting"}
              title={voiceUnavailable ? "Requires BOSON_API_KEY on the backend" : undefined}
              onClick={() => {
                openCopilot();
                void voice.enable({ localTest: !!live?.localTest, briefing: true });
              }}
            >
              {voice.state === "ready" ? "Start briefing" : "Enable voice / Start briefing"}
            </Button>
            <ActionButton
              action={async () => {
                openCopilot();
                await api.post(`/api/projects/${pid}/copilot`, { message: "Where were we?" });
              }}
            >
              Text briefing
            </ActionButton>
          </div>
          {voiceUnavailable ? <span className="text-xs text-muted">Voice unavailable: BOSON_API_KEY is not configured. Text briefing works.</span> : null}
          {voice.error ? <span className="max-w-sm text-xs text-red-700">{voice.error}</span> : null}
        </div>
      </div>

      {s.project.isSynthetic ? <Notice tone="warn">Synthetic demonstration project: Northstar Dental Group, its contacts, and its interviews are fictional.</Notice> : null}
      {interrupted.length ? <Notice tone="warn">{interrupted.length} interview(s) were interrupted (disconnect or restart). Open Live Research to resume explicitly.</Notice> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Operational status">
          <dl className="space-y-1.5 text-sm">
            <Row k="Thesis" v={doc ? `Version ${doc.thesisVersion} (${doc.kind === "docx" ? doc.filename : "pasted text"})` : "Not provided"} />
            <Row k="Research plan" v={plan ? `v${plan.version} · ${plan.status}${unapproved ? " · unapproved edits" : ""}` : "Not generated"} />
            <Row k="Interviews" v={`${ended.length} completed${live ? ", 1 in progress" : ""}${interrupted.length ? `, ${interrupted.length} interrupted` : ""}`} />
            <Row k="Last update" v={when(s.project.updatedAt)} />
          </dl>
          <p className="mt-2 text-xs text-muted">Operational progress is not evidence strength.</p>
        </Card>
        <Card title="Research coverage">
          <dl className="space-y-1.5 text-sm">
            <Row k="Questions in plan" v={String(questions.length)} />
            <Row k="Answered in at least one interview" v={`${answeredSomewhere} of ${questions.length}`} />
            <Row k="Unable to answer (some expert)" v={String(questions.filter((q) => (coverageByQ.get(q.id) ?? []).includes("unable_to_answer")).length)} />
            <Row k="Active observations" v={String(Object.values(s.evidence).filter((e) => e.status === "active").length)} />
          </dl>
        </Card>
        <Card title="Outstanding decisions">
          <ul className="space-y-1.5 text-sm">
            {!plan ? <li>Generate a research plan.</li> : null}
            {plan && (plan.status !== "approved" || unapproved) ? <li>Approve the research plan{unapproved ? " (edited since approval)" : ""}.</li> : null}
            {proposedFindings ? <li>Review {proposedFindings} proposed interpretation(s).</li> : null}
            {unreviewedEvidence ? <li>{unreviewedEvidence} extraction(s) not yet reviewed.</li> : null}
            {pendingDirectives ? <li>{pendingDirectives} directive(s) waiting for an interview.</li> : null}
            {plan?.status === "approved" && !live && !unapproved ? <li>Select an expert and start the next interview.</li> : null}
          </ul>
        </Card>
      </div>

      <Card title="Claim assessments (evidence strength)">
        {claims.length === 0 ? (
          <Empty>No claims yet. Generate the research plan to extract testable claims from the thesis.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {claims.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2">
                <span className="w-8 font-mono text-xs text-muted">{c.code}</span>
                <span className="flex-1 text-sm">{c.assertion}</span>
                <Badge tone={ASSESSMENT_TONE[c.assessment]}>{ASSESSMENT_LABELS[c.assessment]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={doc ? `Thesis — original extracted text (v${doc.thesisVersion})` : "Thesis"}
        actions={
          <>
            <label className="cursor-pointer text-xs text-accent-700 underline">
              Upload new DOCX version
              <input
                type="file"
                accept=".docx"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setErr(null);
                  try {
                    await api.upload(`/api/projects/${pid}/thesis/docx`, f);
                  } catch (e2) {
                    setErr((e2 as Error).message);
                  }
                }}
              />
            </label>
            <Button size="sm" onClick={() => { setThesisText(doc?.extractedText ?? ""); setEditingThesis(true); }}>
              Edit thesis
            </Button>
            <ActionButton size="sm" variant={plan ? "secondary" : "primary"} disabled={!doc} action={() => api.post(`/api/projects/${pid}/plan/generate`)} onFail={setErr}>
              {plan ? "Regenerate plan" : "Generate research plan"}
            </ActionButton>
          </>
        }
      >
        {err ? <div className="mb-3"><Notice tone="bad">{err}</Notice></div> : null}
        {editingThesis ? (
          <div className="space-y-2">
            <Notice tone="info">Saving creates thesis version {(doc?.thesisVersion ?? 0) + 1}. Completed interviews, evidence, and claims are preserved; regenerate the plan explicitly to propose updated claims.</Notice>
            <Field label="Thesis text">
              <textarea className={cx(inputCls, "font-mono")} rows={14} value={thesisText} onChange={(e) => setThesisText(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <ActionButton variant="primary" action={async () => { await api.post(`/api/projects/${pid}/thesis`, { text: thesisText }); setEditingThesis(false); }}>Save new version</ActionButton>
              <Button variant="ghost" onClick={() => setEditingThesis(false)}>Cancel</Button>
            </div>
          </div>
        ) : !doc ? (
          <Empty>No thesis yet. Paste text with “Edit thesis” or upload a .docx.</Empty>
        ) : (
          <div className="space-y-2 text-[15px] leading-relaxed">
            {doc.passages.map((p) => {
              const codes = claimByPassage.get(p.id);
              return (
                <p
                  key={p.id}
                  id={`passage-${p.id}`}
                  className={cx("rounded px-2 py-1", codes && "border-l-4 border-accent-600 bg-accent-50/60", focusPassage === p.id && "ring-2 ring-amber-400")}
                >
                  {codes ? <span className="mr-2 font-mono text-xs font-semibold text-accent-700">{codes.join(" ")}</span> : null}
                  {p.text}
                </p>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
