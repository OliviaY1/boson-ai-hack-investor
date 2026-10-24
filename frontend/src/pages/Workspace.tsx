import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import type { NavigationTarget } from "../../../shared/contracts";
import { CopilotDrawer } from "../components/Copilot";
import { Badge, Button, cx, Empty, Notice, SyntheticBadge } from "../components/ui";
import { useCopilotVoice } from "../lib/copilotVoice";
import { LIFECYCLE_LABELS, liveInterview } from "../lib/format";
import { useCapabilities, useProject } from "../lib/store";
import { targetPath, WorkspaceContext, type WorkspaceValue } from "../lib/workspace";
import { TopBar } from "./Projects";

const NAV = [
  { to: "", label: "Overview", end: true },
  { to: "experts", label: "Expert Sources" },
  { to: "plan", label: "Research Plan" },
  { to: "live", label: "Live Research" },
  { to: "findings", label: "Findings" },
];

export function Workspace() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { snapshot, unapproved, error, link, reload } = useProject(projectId);
  const caps = useCapabilities();
  const base = `/projects/${projectId}`;
  const go = useCallback((t: NavigationTarget) => nav(targetPath(base, t)), [nav, base]);
  const voice = useCopilotVoice(projectId, go);
  const [copilotOpen, setCopilotOpen] = useState(() => window.innerWidth >= 1280);
  useEffect(() => {
    if (voice.state === "connecting") setCopilotOpen(true);
  }, [voice.state]);

  const value = useMemo<WorkspaceValue | null>(() => (snapshot ? { snapshot, caps, unapproved, base, go, reload, voice, openCopilot: () => setCopilotOpen(true) } : null), [snapshot, caps, unapproved, base, go, reload, voice]);

  if (error && !snapshot)
    return (
      <div className="min-h-full">
        <TopBar />
        <div className="mx-auto max-w-lg p-8">
          <Notice tone="bad">{error}</Notice>
        </div>
      </div>
    );
  if (!value)
    return (
      <div className="min-h-full">
        <TopBar />
        <div className="p-8">
          <Empty>Loading project…</Empty>
        </div>
      </div>
    );
  const s = value.snapshot;
  const live = liveInterview(s);
  return (
    <WorkspaceContext.Provider value={value}>
      <div className="flex h-full flex-col">
        <TopBar>
          <div className="flex items-center gap-3">
            <span className="text-muted">/</span>
            <span className="font-medium">{s.project.company}</span>
            {s.project.isSynthetic ? <SyntheticBadge /> : null}
            {live ? (
              <button onClick={() => nav(`${base}/live`)} className="text-xs">
                <Badge tone="accent">
                  {s.experts[live.expertId]?.name}: {LIFECYCLE_LABELS[live.lifecycle]}
                </Badge>
              </button>
            ) : null}
            <div className="flex-1" />
            <span className={cx("text-xs", link === "live" ? "text-emerald-700" : "text-amber-700")} title="Live update stream">
              {link === "live" ? "● Live" : link === "reconnecting" ? "● Reconnecting…" : "● Connecting…"} · rev {s.project.stateRevision}
            </span>
            {!copilotOpen ? (
              <Button size="sm" onClick={() => setCopilotOpen(true)}>
                Copilot
              </Button>
            ) : null}
          </div>
        </TopBar>
        <nav className="no-print flex gap-1 border-b border-line bg-white px-6">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to ? `${base}/${n.to}` : base}
              end={n.end}
              className={({ isActive }) => cx("border-b-2 px-3 py-2 text-sm", isActive ? "border-accent-600 font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <Outlet />
          </main>
          {copilotOpen ? <CopilotDrawer voice={voice} onClose={() => setCopilotOpen(false)} /> : null}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
