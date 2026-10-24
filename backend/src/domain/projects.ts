// Projects, thesis documents/passages, and expert contacts.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ExpertInputT } from "../../../shared/contracts";
import { j, now, uid } from "../db/db";
import { normalizeText, splitPassages } from "../ingest/docx";
import { commit, DomainError, type ChangeSet, type Ctx } from "./events";

export function createProject(ctx: Ctx, input: { company: string; objective: string; isSynthetic?: boolean }): string {
  const id = uid("prj");
  const ts = now();
  ctx.db
    .prepare(
      "INSERT INTO projects (id, company, objective, owner, state_revision, thesis_version, is_synthetic, created_at, updated_at) VALUES (?, ?, ?, 'consultant', 0, 0, ?, ?, ?)",
    )
    .run(id, input.company, input.objective, input.isSynthetic ? 1 : 0, ts, ts);
  commit(ctx, id, "project.created", () => null);
  return id;
}

export function requireProject(ctx: Ctx, projectId: string) {
  const p = ctx.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!p) throw new DomainError(404, "Project not found.", "not_found");
  return p;
}

export function updateProject(ctx: Ctx, projectId: string, patch: { company?: string; objective?: string }) {
  requireProject(ctx, projectId);
  commit(ctx, projectId, "project.updated", () => {
    if (patch.company) ctx.db.prepare("UPDATE projects SET company = ? WHERE id = ?").run(patch.company, projectId);
    if (patch.objective) ctx.db.prepare("UPDATE projects SET objective = ? WHERE id = ?").run(patch.objective, projectId);
  });
}

/**
 * Adds a new thesis version. Earlier documents, passages, claims, and evidence are preserved; only the
 * "current" pointer moves. Re-planning against the new version creates a new draft plan.
 */
export function addThesisDocument(
  ctx: Ctx,
  dataDir: string,
  projectId: string,
  input: { kind: "pasted" | "docx"; text: string; filename?: string | null; raw?: Buffer },
): string {
  requireProject(ctx, projectId);
  const text = normalizeText(input.text);
  if (!text) throw new DomainError(400, "The thesis text is empty.", "empty_thesis");
  if (text.length > 400_000) throw new DomainError(400, "The thesis text is too long.", "thesis_too_long");
  const passages = splitPassages(text);
  if (passages.length === 0) throw new DomainError(400, "No passages could be extracted from the thesis.", "empty_thesis");
  const docId = uid("doc");
  let storedPath: string | null = null;
  if (input.raw) {
    storedPath = path.join("uploads", `${docId}.docx`);
    writeFileSync(path.join(dataDir, storedPath), input.raw);
  }
  commit(ctx, projectId, "thesis.added", (cs) => {
    const db = ctx.db;
    const version = (db.prepare("SELECT thesis_version FROM projects WHERE id = ?").get(projectId) as any).thesis_version + 1;
    for (const d of db.prepare("SELECT id FROM source_documents WHERE project_id = ? AND is_current = 1").all(projectId) as any[]) {
      db.prepare("UPDATE source_documents SET is_current = 0 WHERE id = ?").run(d.id);
      cs.touch("documents", d.id);
    }
    db.prepare(
      "INSERT INTO source_documents (id, project_id, kind, filename, stored_path, size_bytes, thesis_version, extracted_text, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
    ).run(docId, projectId, input.kind, input.filename ?? null, storedPath, input.raw?.length ?? Buffer.byteLength(text), version, text, now());
    const ins = db.prepare("INSERT INTO passages (id, document_id, project_id, ordinal, text, start_offset, end_offset) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const p of passages) ins.run(`${docId}_p${p.ordinal}`, docId, projectId, p.ordinal, p.text, p.start, p.end);
    db.prepare("UPDATE projects SET thesis_version = ? WHERE id = ?").run(version, projectId);
    cs.touch("documents", docId);
  });
  return docId;
}

export function currentPassages(ctx: Ctx, projectId: string): { id: string; text: string }[] {
  return ctx.db
    .prepare(
      "SELECT p.id, p.text FROM passages p JOIN source_documents d ON d.id = p.document_id WHERE d.project_id = ? AND d.is_current = 1 ORDER BY p.ordinal",
    )
    .all(projectId) as { id: string; text: string }[];
}

// ---------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------

function insertExpert(ctx: Ctx, cs: ChangeSet, projectId: string, e: ExpertInputT, source: "manual" | "csv" | "demo"): string {
  const id = uid("exp");
  ctx.db
    .prepare(
      `INSERT INTO experts (id, project_id, name, phone, email, title, organization, background, source, source_system, source_record_id, retrieved_at, is_synthetic, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      e.name,
      e.phone,
      e.email,
      e.title,
      e.organization,
      e.background,
      source,
      e.sourceSystem,
      e.sourceRecordId,
      e.retrievedAt ?? (source === "csv" ? now() : null),
      e.isSynthetic || source === "demo" ? 1 : 0,
      now(),
    );
  cs.touch("experts", id);
  return id;
}

export function addExpert(ctx: Ctx, projectId: string, e: ExpertInputT): string {
  requireProject(ctx, projectId);
  return commit(ctx, projectId, "expert.added", (cs) => insertExpert(ctx, cs, projectId, e, "manual")).result;
}

export function importExperts(ctx: Ctx, projectId: string, rows: ExpertInputT[], source: "csv" | "demo"): string[] {
  requireProject(ctx, projectId);
  return commit(ctx, projectId, "experts.imported", (cs) => {
    const ids: string[] = [];
    for (const r of rows) {
      // Re-imports with the same source record id update in place rather than duplicating contacts.
      const existing = r.sourceRecordId
        ? (ctx.db
            .prepare("SELECT id FROM experts WHERE project_id = ? AND source_system = ? AND source_record_id = ? AND deleted = 0")
            .get(projectId, r.sourceSystem, r.sourceRecordId) as { id: string } | undefined)
        : undefined;
      if (existing) {
        ctx.db
          .prepare(
            "UPDATE experts SET name = ?, phone = ?, email = ?, title = ?, organization = ?, background = ?, retrieved_at = ? WHERE id = ?",
          )
          .run(r.name, r.phone, r.email, r.title, r.organization, r.background, r.retrievedAt ?? now(), existing.id);
        cs.touch("experts", existing.id);
        ids.push(existing.id);
      } else ids.push(insertExpert(ctx, cs, projectId, r, source));
    }
    return ids;
  }).result;
}

export function updateExpert(ctx: Ctx, projectId: string, expertId: string, e: Partial<ExpertInputT>) {
  const row = ctx.db.prepare("SELECT * FROM experts WHERE id = ? AND project_id = ?").get(expertId, projectId) as any;
  if (!row) throw new DomainError(404, "Expert not found.", "not_found");
  commit(ctx, projectId, "expert.updated", (cs) => {
    const fields: [string, unknown][] = [
      ["name", e.name],
      ["phone", e.phone],
      ["email", e.email],
      ["title", e.title],
      ["organization", e.organization],
      ["background", e.background],
    ];
    for (const [k, v] of fields) if (v !== undefined) ctx.db.prepare(`UPDATE experts SET ${k} = ? WHERE id = ?`).run(v, expertId);
    ctx.db
      .prepare("INSERT INTO reviews (id, project_id, target_type, target_id, action, actor, rationale, prior_version, created_at) VALUES (?, ?, 'expert', ?, 'edit', 'consultant', '', ?, ?)")
      .run(uid("rev"), projectId, expertId, j(row), now());
    cs.touch("experts", expertId);
  });
}

export function removeExpert(ctx: Ctx, projectId: string, expertId: string) {
  const row = ctx.db.prepare("SELECT * FROM experts WHERE id = ? AND project_id = ?").get(expertId, projectId) as any;
  if (!row) throw new DomainError(404, "Expert not found.", "not_found");
  const active = ctx.db
    .prepare("SELECT 1 FROM interviews WHERE expert_id = ? AND active_slot IS NOT NULL")
    .get(expertId);
  if (active) throw new DomainError(409, "This expert is in an active interview.", "expert_in_interview");
  // Soft delete: historical interviews and evidence keep their attribution.
  commit(ctx, projectId, "expert.removed", (cs) => {
    ctx.db.prepare("UPDATE experts SET deleted = 1 WHERE id = ?").run(expertId);
    cs.touch("experts", expertId);
  });
}
