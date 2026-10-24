// Transactional commit helper: apply changes, bump the project's state revision, persist one
// state event, and publish it to live subscribers only after the transaction commits.
import type { CollectionName, StateEvent } from "../../../shared/contracts";
import { now, uid, type DB } from "../db/db";
import { loadProject, loadRecord } from "./records";

export class ChangeSet {
  touched = new Map<CollectionName, Set<string>>();
  removed = new Map<CollectionName, Set<string>>();
  touch(c: CollectionName, id: string) {
    if (!this.touched.has(c)) this.touched.set(c, new Set());
    this.touched.get(c)!.add(id);
    return this;
  }
  remove(c: CollectionName, id: string) {
    if (!this.removed.has(c)) this.removed.set(c, new Set());
    this.removed.get(c)!.add(id);
    return this;
  }
}

type Listener = (e: StateEvent) => void;

export class EventHub {
  private subs = new Map<string, Set<Listener>>();
  private globalSubs = new Set<Listener>();
  subscribe(projectId: string, l: Listener): () => void {
    if (!this.subs.has(projectId)) this.subs.set(projectId, new Set());
    this.subs.get(projectId)!.add(l);
    return () => this.subs.get(projectId)?.delete(l);
  }
  subscribeAll(l: Listener): () => void {
    this.globalSubs.add(l);
    return () => this.globalSubs.delete(l);
  }
  publish(e: StateEvent) {
    for (const l of this.subs.get(e.projectId) ?? []) {
      try {
        l(e);
      } catch (err) {
        console.error("[events] listener failed", err);
      }
    }
    for (const l of this.globalSubs) {
      try {
        l(e);
      } catch (err) {
        console.error("[events] global listener failed", err);
      }
    }
  }
}

export interface Ctx {
  db: DB;
  hub: EventHub;
}

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "domain_error",
  ) {
    super(message);
  }
}

export function commit<T>(ctx: Ctx, projectId: string, type: string, fn: (cs: ChangeSet) => T): { result: T; event: StateEvent } {
  const { db } = ctx;
  const run = db.transaction(() => {
    const cs = new ChangeSet();
    const result = fn(cs);
    const ts = now();
    const upd = db
      .prepare("UPDATE projects SET state_revision = state_revision + 1, updated_at = ? WHERE id = ? RETURNING state_revision")
      .get(ts, projectId) as { state_revision: number } | undefined;
    if (!upd) throw new DomainError(404, "Project not found");
    const latestHandoff = db
      .prepare("SELECT id FROM session_handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as { id: string } | undefined;
    if (latestHandoff) cs.touch("handoffs", latestHandoff.id);
    const upserts: StateEvent["upserts"] = {};
    for (const [c, ids] of cs.touched) {
      const recs = [...ids].map((id) => loadRecord(db, c, id)).filter(Boolean);
      (upserts as any)[c] = recs;
    }
    const removed: StateEvent["removed"] = {};
    for (const [c, ids] of cs.removed) removed[c] = [...ids];
    const event: StateEvent = {
      id: uid("evt"),
      projectId,
      revision: upd.state_revision,
      type,
      createdAt: ts,
      project: loadProject(db, projectId)!,
      upserts,
      removed,
    };
    db.prepare("INSERT INTO state_events (id, project_id, revision, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      event.id,
      projectId,
      event.revision,
      type,
      JSON.stringify(event),
      ts,
    );
    return { result, event };
  });
  const out = run();
  ctx.hub.publish(out.event);
  return out;
}

export function eventsAfter(db: DB, projectId: string, afterRevision: number, limit = 500): StateEvent[] {
  return (
    db
      .prepare("SELECT payload FROM state_events WHERE project_id = ? AND revision > ? ORDER BY revision LIMIT ?")
      .all(projectId, afterRevision, limit) as { payload: string }[]
  ).map((r) => JSON.parse(r.payload));
}
