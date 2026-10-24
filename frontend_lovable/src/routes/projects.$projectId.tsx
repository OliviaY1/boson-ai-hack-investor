import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ProjectStatusBadge } from "@/components/status";
import { RoundIndicator } from "@/components/research";
import { buttonVariants, EmptyState } from "@/components/ui-kit";
import { useProject } from "@/lib/store";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Diligence Project — Diligence Live" },
      {
        name: "description",
        content: "Plan, run and review expert interviews for a diligence project.",
      },
      { property: "og:title", content: "Diligence Project — Diligence Live" },
      {
        property: "og:description",
        content: "Plan, run and review expert interviews for a diligence project.",
      },
    ],
  }),
  component: ProjectLayout,
});

const tabs = [
  { to: "/projects/$projectId", label: "Overview", exact: true },
  { to: "/projects/$projectId/sources", label: "Expert Sources" },
  { to: "/projects/$projectId/plan", label: "Research Plan" },
  { to: "/projects/$projectId/live", label: "Live Research" },
  { to: "/projects/$projectId/findings", label: "Findings" },
] as const;

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const { project, hydrated } = useProject(projectId);
  const { pathname } = useLocation();
  const roundAware = /\/(plan|live)$/.test(pathname);

  return (
    <AppShell>
      {!project ? (
        <div className="mx-auto max-w-xl px-10 py-20">
          {hydrated ? (
            <EmptyState
              title="Project not found"
              description="This project may have been removed or reset."
              action={
                <Link to="/" className={buttonVariants({ variant: "secondary" })}>
                  Back to Projects
                </Link>
              }
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Loading project…</p>
          )}
        </div>
      ) : (
        <>
          <header className="sticky top-0 z-30 border-b bg-background/95 px-10 pt-6 backdrop-blur">
            <div className="text-xs text-muted-foreground">
              <Link to="/" className="hover:text-foreground">
                Projects
              </Link>{" "}
              / {project.company}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <h1 className="font-serif text-2xl font-medium tracking-tight">
                {project.company || "Untitled project"}
              </h1>
              <ProjectStatusBadge status={project.status} />
              <div className="ml-auto">
                <RoundIndicator project={project} interactive={roundAware} />
              </div>
            </div>
            <nav className="-mb-px mt-4 flex gap-6">
              {tabs.map((t, i) => (
                <Link
                  key={t.to}
                  to={t.to}
                  params={{ projectId }}
                  activeOptions={{ exact: "exact" in t }}
                  className="border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "!border-primary !text-foreground font-medium" }}
                >
                  <span className="mr-1.5 font-mono text-xs opacity-60">{i + 1}</span>
                  {t.label}
                </Link>
              ))}
            </nav>
          </header>
          <div className="mx-auto max-w-6xl px-10 py-8">
            <Outlet />
          </div>
        </>
      )}
    </AppShell>
  );
}
