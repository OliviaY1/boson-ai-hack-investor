// DOCX question-plan export generated from the same canonical snapshot the UI renders.
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { ASSESSMENT_LABELS, type Snapshot } from "../../../shared/contracts";

const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

export async function buildPlanDocx(s: Snapshot): Promise<Buffer> {
  const plan = s.project.currentPlanId ? s.plans[s.project.currentPlanId] : null;
  const claims = Object.values(s.claims).filter((c) => c.status === "active").sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const questions = Object.values(s.questions).filter((q) => q.status === "active").sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const rankings = Object.values(s.rankings).filter((r) => r.planId === plan?.id).sort((a, b) => a.rank - b.rank);
  const claimCode = (id: string) => s.claims[id]?.code ?? id;
  const children: (Paragraph | Table)[] = [];
  if (s.project.isSynthetic) children.push(new Paragraph({ children: [new TextRun({ text: "SYNTHETIC DEMONSTRATION DATA — fictional company and contacts.", bold: true, color: "B00020" })] }));
  children.push(new Paragraph({ text: `Research plan: ${s.project.company}`, heading: HeadingLevel.TITLE }));
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          plan
            ? `Plan version ${plan.version} — ${plan.status}${plan.approvedBy ? ` by ${plan.approvedBy} at ${plan.approvedAt}` : ""}. Thesis version ${plan.thesisVersion}. Exported ${new Date().toISOString()} at state revision ${s.project.stateRevision}.`
            : "No plan generated.",
        ),
      ],
    }),
  );
  children.push(new Paragraph({ text: "Research objective", heading: HeadingLevel.HEADING_1 }), new Paragraph(s.project.objective));
  children.push(new Paragraph({ text: "Testable claims", heading: HeadingLevel.HEADING_1 }));
  for (const c of claims) {
    const passages = c.passageIds
      .map((pid) => Object.values(s.documents).flatMap((d) => d.passages).find((p) => p.id === pid))
      .filter(Boolean)
      .map((p) => `¶${p!.ordinal}: “${p!.text}”`);
    children.push(new Paragraph({ text: `${c.code} (priority ${c.priority}): ${c.assertion}`, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Source: ", bold: true }), new TextRun(passages.join(" ") || "—")] }));
    if (c.metricDefinition) children.push(new Paragraph({ children: [new TextRun({ text: "Metric: ", bold: true }), new TextRun(c.metricDefinition)] }));
    if (c.missingDefinitions.length) children.push(new Paragraph({ children: [new TextRun({ text: "Missing definitions: ", bold: true }), new TextRun(c.missingDefinitions.join("; "))] }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Would support: ", bold: true }), new TextRun(c.evidenceSupporting)] }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Would challenge: ", bold: true }), new TextRun(c.evidenceChallenging)] }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Current assessment: ", bold: true }), new TextRun(ASSESSMENT_LABELS[c.assessment])] }));
  }
  children.push(new Paragraph({ text: "Questions", heading: HeadingLevel.HEADING_1 }));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [cell("Code", true), cell("Priority", true), cell("Question", true), cell("Purpose", true), cell("Claims", true), cell("Origin", true)] }),
        ...questions.map(
          (q) =>
            new TableRow({
              children: [
                cell(`${q.code} r${q.currentRevision}`),
                cell(String(q.priority)),
                cell(q.text),
                cell(q.purpose),
                cell(q.claimIds.map(claimCode).join(", ")),
                cell(q.isOriginal ? "original" : `added (${q.origin})`),
              ],
            }),
        ),
      ],
    }),
  );
  children.push(new Paragraph({ text: "Expert recommendations", heading: HeadingLevel.HEADING_1 }));
  for (const r of rankings) {
    const e = s.experts[r.expertId];
    if (!e) continue;
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${r.rank}. ${e.name}${e.isSynthetic ? " (fictional)" : ""} — score ${r.score}${r.recommended ? ", recommended" : ""}${r.selected ? ", selected" : ""}. `, bold: true }),
          new TextRun(`${r.rationale} Grounding: “${r.backgroundQuote}”. Claims: ${r.claimIds.map(claimCode).join(", ")}.`),
        ],
      }),
    );
  }
  if (plan?.gaps.length) {
    children.push(new Paragraph({ text: "Coverage gaps", heading: HeadingLevel.HEADING_1 }));
    for (const g of plan.gaps) children.push(new Paragraph({ text: `• ${g.description}`, alignment: AlignmentType.LEFT }));
  }
  const doc = new Document({ creator: "Diligence Live", title: `Research plan — ${s.project.company}`, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
