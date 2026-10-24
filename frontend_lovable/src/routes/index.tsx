import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FolderKanban, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { fmtDate, ProjectStatusBadge } from "@/components/status";
import { Button, buttonVariants, Card, ConfirmDialog, EmptyState } from "@/components/ui-kit";
import { useStore } from "@/lib/store";
import { allInterviews } from "@/lib/mock-service";
import type { DiligenceProject } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projects — Diligence Live" },
      {
        name: "description",
        content:
          "Your commercial due diligence projects, expert interviews and findings in one place.",
      },
      { property: "og:title", content: "Projects — Diligence Live" },
      {
        property: "og:description",
        content:
          "Your commercial due diligence projects, expert interviews and findings in one place.",
      },
    ],
  }),
  component: Projects,
});

function Projects() {
  const { projects, hydrated, removeProject, loadSamples } = useStore();
  const navigate = useNavigate();
  const [pending, setPending] = useState<DiligenceProject | null>(null);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-10 py-10">
        <PageHeader
          title="Projects"
          description="Validate investment theses with AI-led expert interviews."
          actions={
            <Link to="/new" className={buttonVariants()}>
              <Plus /> New Diligence
            </Link>
          }
        />
        {!hydrated ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading projects…</p>
        ) : !projects.length ? (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="Start a new diligence, or load the sample projects to see how research rounds, interviews and findings work."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/new" className={buttonVariants()}>
                  New Diligence
                </Link>
                <Button variant="secondary" onClick={loadSamples}>
                  Load sample projects
                </Button>
              </div>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Target company</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Experts</th>
                  <th className="px-5 py-2.5 text-right font-medium">Interviews</th>
                  <th className="px-5 py-2.5 font-medium">Last updated</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      navigate({ to: "/projects/$projectId", params: { projectId: p.id } })
                    }
                  >
                    <td className="px-5 py-3.5 font-medium">{p.company || "Untitled project"}</td>
                    <td className="px-5 py-3.5">
                      <ProjectStatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{p.experts.length}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {allInterviews(p).length}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{fmtDate(p.updatedAt)}</td>
                    <td className="px-3 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${p.company || "project"}`}
                        title="Delete project"
                        className="size-7 text-muted-foreground hover:bg-danger-soft [&_svg]:size-3.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPending(p);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <ConfirmDialog
          open={!!pending}
          onClose={() => setPending(null)}
          onConfirm={() => {
            if (pending) removeProject(pending.id);
            setPending(null);
          }}
          title={`Delete ${pending?.company || "this project"}?`}
          description="Its expert sources, research plan, interviews and findings are removed from this browser."
          confirmLabel="Delete project"
        />
      </div>
    </AppShell>
  );
}
