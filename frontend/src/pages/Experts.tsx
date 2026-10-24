import { useState } from "react";
import type { ExpertRecord } from "../../../shared/contracts";
import { ActionButton, Badge, Button, Card, Empty, Field, inputCls, Notice, SyntheticBadge, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { currentPlan, when } from "../lib/format";
import { useWorkspace } from "../lib/workspace";

const BLANK = { name: "", title: "", organization: "", phone: "", email: "", background: "", sourceSystem: "", sourceRecordId: "" };

export function ExpertsPage() {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const plan = currentPlan(s);
  const experts = Object.values(s.experts).filter((e) => !e.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const rankingFor = (eid: string) => Object.values(s.rankings).find((r) => r.planId === plan?.id && r.expertId === eid);
  const claimCode = (id: string) => s.claims[id]?.code ?? "?";
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [csv, setCsv] = useState<{ imported: number; errors: { row: number; message: string }[] } | null>(null);

  const sorted = [...experts].sort((a, b) => (rankingFor(a.id)?.rank ?? 999) - (rankingFor(b.id)?.rank ?? 999));
  const save = async () => {
    if (!form) return;
    setErr(null);
    try {
      if (editId) await api.patch(`/api/projects/${pid}/experts/${editId}`, form);
      else await api.post(`/api/projects/${pid}/experts`, { ...form, sourceSystem: form.sourceSystem || "manual" });
      setForm(null);
      setEditId(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const edit = (e: ExpertRecord) => {
    setEditId(e.id);
    setForm({ name: e.name, title: e.title, organization: e.organization, phone: e.phone, email: e.email, background: e.background, sourceSystem: e.sourceSystem, sourceRecordId: e.sourceRecordId });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Expert sources</h1>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setErr(null);
                setCsv(null);
                try {
                  setCsv(await api.upload(`/api/projects/${pid}/experts/import`, f));
                } catch (e2: any) {
                  setErr(e2.message);
                }
              }}
            />
          </label>
          <Button variant="primary" onClick={() => { setEditId(null); setForm({ ...BLANK }); }}>Add contact</Button>
        </div>
      </div>
      <p className="text-sm text-muted">CSV columns: name and background are required; title, organization, phone, email, source_system, source_record_id, retrieved_at, and is_synthetic are optional. Re-importing a CRM record with the same source ID updates it.</p>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      {csv ? (
        <Notice tone={csv.errors.length ? "warn" : "good"}>
          Imported {csv.imported} contact(s).
          {csv.errors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {csv.errors.slice(0, 20).map((e) => (
                <li key={e.row}>Row {e.row}: {e.message}</li>
              ))}
              {csv.errors.length > 20 ? <li>…and {csv.errors.length - 20} more rows with errors.</li> : null}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {form ? (
        <Card title={editId ? "Edit contact" : "Add contact"}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Organization"><input className={inputCls} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
            <Field label="Phone (if needed)"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Source system"><input className={inputCls} value={form.sourceSystem} placeholder="manual" onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Field label="Documented background" hint="Rankings may only cite text from this field.">
                <textarea className={inputCls} rows={3} value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={save} disabled={!form.name.trim() || !form.background.trim()}>Save</Button>
            <Button variant="ghost" onClick={() => { setForm(null); setEditId(null); }}>Cancel</Button>
          </div>
        </Card>
      ) : null}
      {experts.length === 0 ? (
        <Empty>No expert contacts yet. Add one or import a CSV. Planning needs at least one contact to recommend experts.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Expert</Th>
                <Th>Documented background</Th>
                <Th>Selection rationale {plan ? `(plan v${plan.version})` : ""}</Th>
                <Th>Source</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const r = rankingFor(e.id);
                return (
                  <tr key={e.id}>
                    <Td className="w-56">
                      <div className="flex items-center gap-1.5 font-medium">
                        {e.name} {e.isSynthetic ? <SyntheticBadge /> : <Badge tone="info">Real contact</Badge>}
                      </div>
                      <div className="text-xs text-muted">{[e.title, e.organization].filter(Boolean).join(", ")}</div>
                      <div className="text-xs text-muted">{[e.phone, e.email].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td className="max-w-md text-xs">{e.background}</Td>
                    <Td className="max-w-md text-xs">
                      {r ? (
                        <>
                          <div className="mb-1 flex flex-wrap items-center gap-1">
                            <Badge tone={r.recommended ? "accent" : "neutral"}>#{r.rank} · score {r.score}{r.recommended ? " · recommended" : ""}</Badge>
                            {r.claimIds.map((c) => <Badge key={c}>{claimCode(c)}</Badge>)}
                          </div>
                          <div>{r.rationale}</div>
                          <div className="mt-1 text-muted">Grounding: <q className="italic">{r.backgroundQuote}</q></div>
                        </>
                      ) : (
                        <span className="text-muted">Not ranked yet (generate the plan).</span>
                      )}
                    </Td>
                    <Td className="w-48 text-xs">
                      <div>{e.source}{e.sourceSystem ? ` · ${e.sourceSystem}` : ""}</div>
                      {e.sourceRecordId ? <div className="font-mono">{e.sourceRecordId}</div> : null}
                      <div className="text-muted">Retrieved {e.retrievedAt ? when(e.retrievedAt) : "—"}</div>
                    </Td>
                    <Td className="w-32 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => edit(e)}>Edit</Button>
                      <ActionButton size="sm" variant="ghost" action={() => api.del(`/api/projects/${pid}/experts/${e.id}`)}>Remove</ActionButton>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
