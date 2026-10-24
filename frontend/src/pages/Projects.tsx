import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectRecord } from "../../../shared/contracts";
import { ActionButton, Button, Card, Empty, Field, inputCls, Notice, SyntheticBadge } from "../components/ui";
import { CapabilityPanel } from "../components/Capabilities";
import { api } from "../lib/api";
import { when } from "../lib/format";

type Row = ProjectRecord & { claims: number; interviews: number; evidence: number };

export function ProjectsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState<{ id: string; project_id: string; lifecycle: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [objective, setObjective] = useState("");
  const [thesis, setThesis] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = () =>
    api
      .get<{ projects: Row[]; activeInterview: typeof active }>("/api/projects")
      .then((r) => {
        setRows(r.projects);
        setActive(r.activeInterview);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Projects</h1>
            <div className="flex-1" />
            <Button onClick={() => nav("/call")}>Test a call</Button>
            <ActionButton
              variant="primary"
              action={async () => {
                const r = await api.post<{ id: string }>("/api/demo/northstar");
                nav(`/projects/${r.id}`);
              }}
            >
              Create Northstar demo
            </ActionButton>
          </div>
          {err ? <Notice tone="bad">{err}</Notice> : null}
          {rows === null ? (
            <Empty>Loading projects…</Empty>
          ) : rows.length === 0 ? (
            <Empty>No projects yet. Create one from a thesis, or load the synthetic Northstar demonstration.</Empty>
          ) : (
            <div className="space-y-2">
              {rows.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-lg border border-line bg-white px-4 py-3 hover:border-accent-600">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.company}</span>
                    {p.isSynthetic ? <SyntheticBadge /> : null}
                    {active?.project_id === p.id ? <span className="text-xs font-medium text-accent-700">Interview {active.lifecycle.replace(/_/g, " ")}</span> : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-sm text-muted">{p.objective}</div>
                  <div className="mt-1 text-xs text-muted">
                    {p.claims} claims · {p.interviews} completed interviews · {p.evidence} active observations · updated {when(p.updatedAt)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <Card title="New project">
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setErr(null);
                try {
                  const r = await api.post<{ id: string }>("/api/projects", { company, objective, thesisText: file ? undefined : thesis });
                  if (file) {
                    try {
                      await api.upload(`/api/projects/${r.id}/thesis/docx`, file);
                    } catch (e2) {
                      setErr(`Project created, but the DOCX was rejected: ${(e2 as Error).message}`);
                      void load();
                      return;
                    }
                  }
                  nav(`/projects/${r.id}`);
                } catch (e2) {
                  setErr((e2 as Error).message);
                }
              }}
            >
              <Field label="Company">
                <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} required maxLength={200} />
              </Field>
              <Field label="Research objective">
                <textarea className={inputCls} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} required maxLength={2000} />
              </Field>
              <Field label="Investment thesis (paste text)" hint="Or attach a .docx below. Uploaded text is treated as untrusted content.">
                <textarea className={inputCls} rows={5} value={thesis} onChange={(e) => setThesis(e.target.value)} disabled={!!file} />
              </Field>
              <Field label="Thesis document (.docx, up to 5 MB)">
                <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
              </Field>
              <Button variant="primary" type="submit" disabled={!company.trim() || !objective.trim()}>
                Create project
              </Button>
            </form>
          </Card>
          <CapabilityPanel />
        </div>
      </main>
    </div>
  );
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="no-print flex h-12 items-center gap-4 border-b border-line bg-white px-6">
      <Link to="/" className="font-semibold tracking-tight">
        Diligence Live
      </Link>
      <div className="flex-1">{children}</div>
    </div>
  );
}
