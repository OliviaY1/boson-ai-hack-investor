import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  advanceMockInterview,
  autoLaunchInterviews,
  deriveStatus,
  missingSamples,
  withoutProject,
} from "./mock-service";
import type { DiligenceProject } from "./types";

// v2: projects saved under the earlier key are dropped on purpose, so the demo
// projects that shipped with the prototype no longer appear in a saved list.
const KEY = "diligence-live:v2";
const TICK_MS = 1400;

interface Store {
  projects: DiligenceProject[];
  hydrated: boolean;
  updateProject: (id: string, fn: (p: DiligenceProject) => DiligenceProject) => void;
  addProject: (p: DiligenceProject) => void;
  removeProject: (id: string) => void;
  removeAllProjects: () => void;
  loadSamples: () => void;
}

const Ctx = createContext<Store | null>(null);

const touch = (p: DiligenceProject): DiligenceProject => ({
  ...p,
  status: deriveStatus(p),
  updatedAt: new Date().toISOString(),
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<DiligenceProject[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const tick = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setProjects(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(projects));
  }, [projects, hydrated]);

  // Simulation engine: queued interviews launch themselves, then each running
  // interview advances on its own staggered cadence.
  useEffect(() => {
    const t = setInterval(() => {
      tick.current += 1;
      const n = tick.current;
      setProjects((ps) => {
        let changed = false;
        const next = ps.map((p) => {
          const launched = autoLaunchInterviews(p);
          if (!launched.interviews.some((i) => i.status === "In Progress")) return p;
          const interviews = launched.interviews.map((iv, idx) =>
            iv.status === "In Progress" && (n + idx) % 2 === 0 ? advanceMockInterview(iv) : iv,
          );
          changed = true;
          return touch({ ...launched, interviews });
        });
        return changed ? next : ps;
      });
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  const updateProject = useCallback((id: string, fn: (p: DiligenceProject) => DiligenceProject) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? touch(fn(p)) : p)));
  }, []);
  const addProject = useCallback((p: DiligenceProject) => setProjects((ps) => [p, ...ps]), []);
  const removeProject = useCallback(
    (id: string) => setProjects((ps) => withoutProject(ps, id)),
    [],
  );
  const removeAllProjects = useCallback(() => setProjects([]), []);
  const loadSamples = useCallback(() => setProjects((ps) => [...missingSamples(ps), ...ps]), []);

  const value = useMemo(
    () => ({
      projects,
      hydrated,
      updateProject,
      addProject,
      removeProject,
      removeAllProjects,
      loadSamples,
    }),
    [projects, hydrated, updateProject, addProject, removeProject, removeAllProjects, loadSamples],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used within StoreProvider");
  return s;
}

export function useProject(id: string) {
  const { projects, updateProject, hydrated } = useStore();
  const project = projects.find((p) => p.id === id);
  const update = useCallback(
    (fn: (p: DiligenceProject) => DiligenceProject) => updateProject(id, fn),
    [id, updateProject],
  );
  return { project, update, hydrated };
}
