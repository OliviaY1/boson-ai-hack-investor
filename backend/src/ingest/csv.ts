// Expert contact CSV import: validated row by row with clear error feedback.
import { parse } from "csv-parse/sync";
import { ExpertInput, type ExpertInputT } from "../../../shared/contracts";
import { DomainError } from "../domain/events";

export const CSV_LIMITS = { maxBytes: 1024 * 1024, maxRows: 2000 };

export interface CsvImportResult {
  valid: { row: number; expert: ExpertInputT }[];
  errors: { row: number; message: string }[];
}

const ALIASES: Record<string, string> = {
  name: "name",
  full_name: "name",
  phone: "phone",
  email: "email",
  title: "title",
  role: "title",
  organization: "organization",
  company: "organization",
  background: "background",
  bio: "background",
  source_system: "sourceSystem",
  source_record_id: "sourceRecordId",
  source_id: "sourceRecordId",
  retrieved_at: "retrievedAt",
  is_synthetic: "isSynthetic",
};

export function parseExpertCsv(buf: Buffer): CsvImportResult {
  if (buf.length === 0) throw new DomainError(400, "The CSV file is empty.", "invalid_csv");
  if (buf.length > CSV_LIMITS.maxBytes) throw new DomainError(413, "The CSV exceeds the 1 MB limit.", "upload_too_large");
  const text = buf.toString("utf8");
  if (text.includes("\u0000")) throw new DomainError(400, "The file does not look like a text CSV.", "invalid_csv");
  let rows: Record<string, string>[];
  try {
    rows = parse(text, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase().replace(/\s+/g, "_")), skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    throw new DomainError(400, `CSV could not be parsed: ${(e as Error).message}`, "invalid_csv");
  }
  if (rows.length === 0) throw new DomainError(400, "The CSV has a header but no contact rows.", "invalid_csv");
  if (rows.length > CSV_LIMITS.maxRows) throw new DomainError(400, `The CSV has more than ${CSV_LIMITS.maxRows} rows.`, "invalid_csv");
  const headers = Object.keys(rows[0]);
  if (!headers.includes("name") && !headers.includes("full_name")) {
    throw new DomainError(400, "The CSV must include a 'name' column.", "invalid_csv");
  }
  if (!headers.includes("background") && !headers.includes("bio")) {
    throw new DomainError(400, "The CSV must include a 'background' column describing documented experience.", "invalid_csv");
  }
  const result: CsvImportResult = { valid: [], errors: [] };
  rows.forEach((raw, i) => {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = ALIASES[k];
      if (!key) continue;
      mapped[key] = key === "isSynthetic" ? /^(true|1|yes)$/i.test(v) : v;
    }
    if (mapped.retrievedAt === "") mapped.retrievedAt = null;
    const parsed = ExpertInput.safeParse(mapped);
    if (parsed.success) result.valid.push({ row: i + 2, expert: parsed.data });
    else
      result.errors.push({
        row: i + 2,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`).join("; "),
      });
  });
  return result;
}
