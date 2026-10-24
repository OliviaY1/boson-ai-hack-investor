// Project state: one consistent snapshot plus committed server events applied in revision order.
import { useCallback, useEffect, useRef, useState } from "react";
import { applyEvent } from "../../../shared/applyEvent";
import type { Capabilities, Snapshot, StateEvent } from "../../../shared/contracts";
import { api } from "./api";

export type LinkState = "connecting" | "live" | "reconnecting" | "offline";

export function useProject(projectId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [unapproved, setUnapproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkState>("connecting");
  const revRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const pending = useRef<StateEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ snapshot: Snapshot; planHasUnapprovedChanges: boolean }>(`/api/projects/${projectId}/snapshot`);
      revRef.current = r.snapshot.project.stateRevision;
      setSnapshot(r.snapshot);
      setUnapproved(r.planHasUnapprovedChanges);
      setError(null);
      return r.snapshot.project.stateRevision;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [projectId]);

  const connect = useCallback(
    (after: number) => {
      esRef.current?.close();
      const es = new EventSource(`/api/projects/${projectId}/events?after=${after}`);
      esRef.current = es;
      es.onopen = () => setLink("live");
      es.addEventListener("state", (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as StateEvent;
        if (ev.revision <= revRef.current) return; // already applied
        if (ev.revision !== revRef.current + 1) {
          // Gap in the event sequence: refetch a consistent snapshot and resume from its cursor.
          es.close();
          void load().then((rev) => rev !== null && connect(rev));
          return;
        }
        revRef.current = ev.revision;
        pending.current.push(ev);
        queueMicrotask(flush);
      });
      es.onerror = () => {
        setLink("reconnecting");
        es.close();
        setTimeout(() => {
          if (esRef.current === es) connect(revRef.current);
        }, 1500);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, load],
  );

  const flush = useCallback(() => {
    const evs = pending.current.splice(0);
    if (!evs.length) return;
    setSnapshot((s) => (s ? evs.reduce(applyEvent, s) : s));
    if (evs.some((e) => /^plan\.|^question\.|^claim\.|^ranking\./.test(e.type)))
      void api
        .get<{ planHasUnapprovedChanges: boolean }>(`/api/projects/${projectId}/snapshot`)
        .then((r) => setUnapproved(r.planHasUnapprovedChanges))
        .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    void load().then((rev) => {
      if (!cancelled && rev !== null) connect(rev);
    });
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [projectId, load, connect]);

  return { snapshot, unapproved, error, link, reload: load };
}

let capsPromise: Promise<Capabilities> | null = null;
export function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    capsPromise ??= api.get<Capabilities>("/api/config");
    capsPromise.then(setCaps).catch(() => (capsPromise = null));
  }, []);
  return caps;
}
