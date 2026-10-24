// Printable HTML findings report rendered from the canonical snapshot.
import { ASSESSMENT_LABELS, type EvidenceRecord, type Snapshot } from "../../../shared/contracts";
import { buildSynthesis } from "../../../shared/synthesis";

const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderReport(s: Snapshot): string {
  const syn = buildSynthesis(s);
  const name = (id: string) => s.experts[id]?.name ?? "unknown";
  const ref = (e: EvidenceRecord) => {
    const t = s.turns[e.turnId];
    return `<span class="ref">[${esc(e.id)} · ${esc(name(e.expertId))} · turn ${t?.seq ?? "?"} v${e.turnVersion} · chars ${e.spanStart}–${e.spanEnd}]</span>`;
  };
  const obs = (e: EvidenceRecord, claimId: string) => {
    const l = e.links.find((x) => x.claimId === claimId)!;
    return `<li><q>${esc(e.quote)}</q> — ${esc(e.statement)} <em>(${esc(e.basis.replace(/_/g, " "))}; ${esc(l.comparability.replace(/_/g, " "))}${l.disputed ? "; interpretation flagged" : ""}${e.reviewStatus === "accepted" ? "; extraction accepted" : ""})</em> ${ref(e)}</li>`;
  };
  const findings = Object.values(s.findings);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Findings report — ${esc(s.project.company)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2328;max-width:900px;margin:32px auto;padding:0 16px;background:#fff}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #d0d7de;padding-bottom:4px}h3{font-size:15px;margin:18px 0 6px}
.meta{color:#57606a}.banner{background:#fff4e5;border:1px solid #f0b46a;padding:8px 12px;border-radius:6px;margin:12px 0;font-weight:600}
.ref{color:#57606a;font-size:12px}.badge{display:inline-block;border:1px solid #d0d7de;border-radius:10px;padding:0 8px;font-size:12px;margin-left:6px}
li{margin:4px 0}q{font-style:italic}@media print{body{margin:0}a{color:inherit}}
</style></head><body>
<h1>Findings report — ${esc(s.project.company)}</h1>
<div class="meta">Generated ${esc(new Date().toISOString())} from state revision ${s.project.stateRevision}. ${esc(s.project.objective)}</div>
${s.project.isSynthetic ? '<div class="banner">SYNTHETIC DEMONSTRATION DATA — fictional company, contacts, and interviews.</div>' : ""}
<h2>Executive synthesis</h2>
<ul>${syn.headline.map((h) => `<li>${esc(h)}</li>`).join("") || "<li>No findings yet.</li>"}</ul>
<p class="meta">${esc(syn.operational)}</p>
<h3>Limits</h3><ul>${syn.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<h3>Unresolved questions</h3><ul>${syn.unresolved.map((l) => `<li>${esc(l)}</li>`).join("") || "<li>None recorded.</li>"}</ul>
<h2>Interpretations</h2>
${findings.length ? `<ul>${findings.map((f) => `<li>${esc(f.text)} <span class="badge">${esc(f.status)}</span>${f.reviewNote ? `<br><span class="meta">Consultant: ${esc(f.reviewNote)}</span>` : ""}${f.nextEvidenceNeeded ? `<br><span class="meta">Next evidence needed: ${esc(f.nextEvidenceNeeded)}</span>` : ""}<br><span class="ref">Evidence: ${f.evidenceIds.map(esc).join(", ")}</span></li>`).join("")}</ul>` : "<p>None.</p>"}
<h2>Claim-by-claim assessment</h2>
${syn.claims
  .map(
    (c) => `<h3>${esc(c.claim.code)}: ${esc(c.claim.assertion)} <span class="badge">${esc(ASSESSMENT_LABELS[c.claim.assessment])}</span></h3>
<p class="meta">${esc(c.claim.assessmentRationale)}</p>
${c.supporting.length ? `<b>Supporting</b><ul>${c.supporting.map((e) => obs(e, c.claim.id)).join("")}</ul>` : ""}
${c.challenging.length ? `<b>Challenging</b><ul>${c.challenging.map((e) => obs(e, c.claim.id)).join("")}</ul>` : ""}
${c.unresolved.length ? `<b>Unresolved</b><ul>${c.unresolved.map((e) => obs(e, c.claim.id)).join("")}</ul>` : ""}
${c.inactive.length ? `<b>Superseded, retracted, or invalidated</b><ul>${c.inactive.map((e) => `<li><s>${esc(e.quote)}</s> — ${esc(e.status)}${e.statusReason ? ` (${esc(e.statusReason)})` : ""} ${ref(e)}</li>`).join("")}</ul>` : ""}
${c.claim.gaps.length ? `<b>Evidence gaps</b><ul>${c.claim.gaps.map((g) => `<li>${esc(g.description)}</li>`).join("")}</ul>` : ""}`,
  )
  .join("")}
<h2>Interviews</h2>
<ul>${Object.values(s.interviews)
    .map((i) => `<li>${esc(name(i.expertId))} — ${esc(i.mode)} — ${esc(i.lifecycle)}${i.terminationReason ? ` (${esc(i.terminationReason)})` : ""}; consent ${esc(i.consent)}</li>`)
    .join("")}</ul>
</body></html>`;
}
