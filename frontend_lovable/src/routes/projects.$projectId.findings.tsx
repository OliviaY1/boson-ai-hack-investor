import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Compass, FileText } from "lucide-react";
import { expertOf } from "@/components/research";
import { AssessmentBadge } from "@/components/status";
import { Badge, Button, buttonVariants, Card, EmptyState, SectionTitle } from "@/components/ui-kit";
import {
  allHypotheses,
  allInterviews,
  canRecommendNextRound,
  generateMockFindings,
  generateNextRoundPlan,
  startNextRound,
} from "@/lib/mock-service";
import { useProject } from "@/lib/store";
import { useRoundView } from "@/lib/round-view";
import type { DiligenceProject, Finding } from "@/lib/types";

export const Route = createFileRoute("/projects/$projectId/findings")({
  head: () => ({
    meta: [
      { title: "Research Findings — Diligence Live" },
      {
        name: "description",
        content:
          "Review expert evidence, investment thesis assessments and recommended next research rounds.",
      },
      { property: "og:title", content: "Research Findings — Diligence Live" },
      {
        property: "og:description",
        content:
          "Review expert evidence, investment thesis assessments and recommended next research rounds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FindingsPage,
});

export const sourceName = (p: DiligenceProject, f: Finding) => {
  const iv = allInterviews(p).find((i) => i.id === f.interviewId);
  return iv ? expertOf(p, iv.expertId) : undefined;
};

function FindingsPage() {
  const { projectId } = Route.useParams();
  const { project, update } = useProject(projectId);
  const navigate = useNavigate();
  const { clear: clearRound } = useRoundView();
  if (!project) return null;
  const r = generateMockFindings(project);
  const allDone =
    project.interviews.length > 0 && project.interviews.every((i) => i.status === "Completed");
  const roundNo = (project.pastRounds?.length ?? 0) + 1;

  if (!r.findings.length && !allDone)
    return (
      <EmptyState
        icon={<FileText />}
        title="No findings yet"
        description="Findings are consolidated as interviews progress. Start the simulation from Live Research."
        action={
          <Link to="/projects/$projectId/live" params={{ projectId }} className={buttonVariants()}>
            Open Live Research
          </Link>
        }
      />
    );

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-2">
        <Badge tone="warning">Simulated findings · Demo</Badge>
        {roundNo > 1 && <Badge tone="outline">Consolidated across all research rounds</Badge>}
        {!allDone && project.interviews.length > 0 && (
          <Badge tone="outline">Interim — interviews still running</Badge>
        )}
      </div>

      <section>
        <SectionTitle title="Investment thesis validation" />
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">Hypothesis</th>
                <th className="px-5 py-2.5 font-medium">Assessment</th>
                <th className="px-5 py-2.5 font-medium">Key evidence</th>
                <th className="px-5 py-2.5 font-medium">Sources</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.validation.map((v, i) => (
                <tr key={v.hypothesis.id} className="align-top">
                  <td className="px-5 py-3 font-medium">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">H{i + 1}</span>
                    {v.hypothesis.title}
                    {v.hypothesis.origin && (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        Round {v.hypothesis.round} · {v.hypothesis.origin}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <AssessmentBadge value={v.assessment} />
                    {v.history.length > 1 && v.history.some((a) => a !== v.assessment) && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {v.history
                          .map((a, k) => `R${v.startRound + k}: ${a.replace(" Evidence", "")}`)
                          .join(" → ")}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {v.findings.map((f) => f.title).join("; ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {[...new Set(v.findings.map((f) => sourceName(project, f)?.name))].join(", ") ||
                      "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Research gaps"
          description="Assumptions that remain unverified or need follow-up interviews."
        />
        <Card className="divide-y text-sm">
          {r.gaps.length ? (
            r.gaps.map((g, i) => (
              <p key={i} className="flex gap-2 px-4 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                {g}
              </p>
            ))
          ) : (
            <p className="px-4 py-3 text-muted-foreground">No open gaps.</p>
          )}
        </Card>
      </section>

      {canRecommendNextRound(project) && (
        <NextRoundCard
          project={project}
          onCreate={() => {
            update(startNextRound);
            clearRound(projectId);
            navigate({ to: "/projects/$projectId/plan", params: { projectId } });
          }}
        />
      )}
    </div>
  );
}

function NextRoundCard({ project, onCreate }: { project: DiligenceProject; onCreate: () => void }) {
  const { plan } = generateNextRoundPlan(project);
  const roundNo = (project.pastRounds?.length ?? 0) + 2;
  const findings = generateMockFindings(project).findings;
  const existing = allHypotheses(project);
  return (
    <section>
      <SectionTitle
        title="Recommended next round"
        description={`Based on these findings, the AI proposes Round ${roundNo} to explore new and unresolved parts of the thesis.`}
        action={<Badge tone="warning">AI suggestion · requires approval</Badge>}
      />
      <Card className="border-primary/30">
        <div className="space-y-5 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            New hypotheses to explore
          </p>
          {plan.hypotheses.map((h, i) => (
            <div key={h.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  H{existing.length + i + 1}
                </span>
                <p className="font-medium">{h.title}</p>
                {h.origin && (
                  <Badge
                    tone={h.origin.startsWith("New") ? "warning" : "primary"}
                    className="font-normal"
                  >
                    {h.origin}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{h.description}</p>
              {!!h.basisFindingIds?.length && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Prompted by:{" "}
                  {h.basisFindingIds
                    .map((id) => findings.find((f) => f.id === id)?.title)
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 border-t bg-primary-soft/50 px-5 py-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Compass className="size-4 text-primary" /> The Round {roundNo} plan proposes{" "}
            {plan.experts.length} experts with new interview questions. You can edit everything
            before approving.
          </p>
          <Button onClick={onCreate}>
            Create Round {roundNo} Plan <ArrowRight />
          </Button>
        </div>
      </Card>
    </section>
  );
}
