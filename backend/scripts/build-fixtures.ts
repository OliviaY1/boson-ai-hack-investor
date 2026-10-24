// Regenerates the synthetic Northstar demonstration fixtures (thesis DOCX and contact CSV).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { NORTHSTAR_EXPERTS, NORTHSTAR_THESIS_PARAGRAPHS } from "../src/providers/northstarFixture";

const out = path.resolve(process.argv[2] ?? "fixtures/northstar");
mkdirSync(out, { recursive: true });

const [title, ...body] = NORTHSTAR_THESIS_PARAGRAPHS;
const doc = new Document({
  creator: "Diligence Live demo fixture",
  title: "Northstar Dental Group investment thesis (synthetic)",
  description: "Fictional demonstration document. No real company is represented.",
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
        ...body.map((p) => new Paragraph({ children: [new TextRun(p)] })),
      ],
    },
  ],
});
writeFileSync(path.join(out, "northstar_thesis.docx"), await Packer.toBuffer(doc));

const cols = ["name", "title", "organization", "phone", "email", "background", "source_system", "source_record_id", "retrieved_at", "is_synthetic"] as const;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rows = NORTHSTAR_EXPERTS.map((e) =>
  [e.name, e.title, e.organization, e.phone, e.email, e.background, "demo-crm", e.sourceRecordId, "2026-01-15T09:00:00Z", "true"].map(cell).join(","),
);
writeFileSync(path.join(out, "contacts.csv"), [cols.join(","), ...rows].join("\n") + "\n");
console.log(`Wrote ${path.join(out, "northstar_thesis.docx")} and contacts.csv (${rows.length} synthetic contacts).`);
