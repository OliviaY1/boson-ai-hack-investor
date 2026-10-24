// Applies one committed state event to a snapshot. Used by the UI store and by reconnection tests.
import type { CollectionName, Snapshot, StateEvent } from "./contracts";

export function applyEvent(s: Snapshot, e: StateEvent): Snapshot {
  const next: Snapshot = { ...s, project: e.project };
  for (const [col, rows] of Object.entries(e.upserts) as [CollectionName, { id: string }[]][]) {
    const copy = { ...(next[col] as Record<string, unknown>) };
    for (const r of rows) copy[r.id] = r;
    (next as unknown as Record<string, unknown>)[col] = copy;
  }
  for (const [col, ids] of Object.entries(e.removed) as [CollectionName, string[]][]) {
    const copy = { ...(next[col] as Record<string, unknown>) };
    for (const id of ids) delete copy[id];
    (next as unknown as Record<string, unknown>)[col] = copy;
  }
  return next;
}
