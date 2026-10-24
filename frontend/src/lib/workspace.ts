import { createContext, useContext } from "react";
import type { Capabilities, NavigationTarget, Snapshot } from "../../../shared/contracts";
import type { CopilotVoice } from "./copilotVoice";

export interface WorkspaceValue {
  snapshot: Snapshot;
  caps: Capabilities | null;
  unapproved: boolean;
  base: string;
  go: (t: NavigationTarget) => void;
  reload: () => Promise<unknown>;
  voice: CopilotVoice;
  openCopilot: () => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace outside workspace");
  return v;
}

export function targetPath(base: string, t: NavigationTarget): string {
  switch (t.kind) {
    case "turn":
      return `${base}/live?interview=${t.interviewId}&turn=${t.turnId}&v=${t.version}&s=${t.spanStart}&e=${t.spanEnd}`;
    case "passage":
      return `${base}?passage=${t.passageId}`;
    case "claim":
      return `${base}/plan?claim=${t.claimId}`;
    case "page":
      return t.page === "overview" ? base : `${base}/${t.page}`;
  }
}
