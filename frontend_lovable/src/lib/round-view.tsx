/**
 * Which research round the consultant is looking at. View state only — never
 * persisted with the project — so the header indicator and the round-aware
 * pages (Research Plan, Live Research) always agree.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { roundsOf } from "./mock-service";
import type { DiligenceProject } from "./types";

/** Round index to show for a project, given an explicit pick (null = latest round). */
export function roundIndex(p: DiligenceProject, picked: number | null): number {
  const last = Math.max(0, roundsOf(p).length - 1);
  return picked === null ? last : Math.min(Math.max(0, picked), last);
}

interface RoundView {
  /** Round the consultant explicitly chose, or null when they follow the current round. */
  picked: (p: DiligenceProject) => number | null;
  /** Round currently displayed. */
  view: (p: DiligenceProject) => number;
  /** Choose a round explicitly (header switcher, opening an interview). */
  select: (projectId: string, index: number) => void;
  /** Follow the current round again, e.g. after a new round starts. */
  clear: (projectId: string) => void;
}

const Ctx = createContext<RoundView | null>(null);

export function RoundViewProvider({ children }: { children: ReactNode }) {
  const [pick, setPick] = useState<{ projectId: string; index: number | null } | null>(null);

  const picked = useCallback(
    (p: DiligenceProject) => (pick && pick.projectId === p.id ? pick.index : null),
    [pick],
  );
  const view = useCallback((p: DiligenceProject) => roundIndex(p, picked(p)), [picked]);
  const select = useCallback(
    (projectId: string, index: number) => setPick({ projectId, index }),
    [],
  );
  const clear = useCallback(
    (projectId: string) =>
      setPick((cur) => (cur && cur.projectId === projectId ? { ...cur, index: null } : cur)),
    [],
  );

  const value = useMemo(() => ({ picked, view, select, clear }), [picked, view, select, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoundView() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRoundView must be used within RoundViewProvider");
  return c;
}
