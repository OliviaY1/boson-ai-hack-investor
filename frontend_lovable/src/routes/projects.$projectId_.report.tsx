import { createFileRoute, Link } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { expertOf, hypothesisTitle } from "@/components/research";
import { fmtDate } from "@/components/status";
import { Button, buttonVariants } from "@/components/ui-kit";
import { allInterviews, generateMockFindings } from "@/lib/mock-service";
import { useProject } from "@/lib/store";

export const Route = createFileRoute("/projects/$projectId_/report")({
  head: () => ({
    meta: [
      { title: "Diligence Report — Diligence Live" },
      { name: "description", content: "Printable commercial diligence findings report." },
      { property: "og:title", content: "Diligence Report — Diligence Live" },
      { property: "og:description", content: "Printable commercial diligence findings report." },
    ],
  }),
  component: Report,
});

function Report() {
  const { projectId } = Route.useParams();
  const { project, hydrated } = useProject(projectId);
  if (!project)
    return (
      <p className="p-10 text-sm text-muted-foreground">
        {hydrated ? "Project not found." : "Loading…"}
      </p>
    );
  const r = generateMockFindings(project);
  const src = (interviewId: string) => {
    const iv = allInterviews(project).find((i) => i.id === interviewId);
    return iv ? expertOf(project, iv.expertId) : undefined;
  };

  return (
    <div className="min-h-screen bg-muted/50 py-10 print:bg-card print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[800px] justify-between">
        <Link
          to="/projects/$projectId/findings"
          params={{ projectId }}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Back to Findings
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>
      <article className="mx-auto max-w-[800px] bg-card px-14 py-12 shadow-sm print:shadow-none">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Commercial Due Diligence · Simulated demo output
        </p>
        <h1 className="mt-2 font-serif text-4xl">{project.company}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Expert interview findings · {fmtDate(project.updatedAt)} · {allInterviews(project).length}{" "}
          interviews · {(project.pastRounds?.length ?? 0) + 1} research round(s)
        </p>

        <h2 className="mt-10 border-b pb-2 font-serif text-xl">Executive summary</h2>
        <p className="mt-3 font-medium">{r.overall}.</p>
        <p className="mt-2 text-sm leading-relaxed">
          Positive evidence:{" "}
          {r.findings
            .filter((f) => f.sentiment === "support")
            .map((f) => f.title.toLowerCase())
            .join("; ") || "none"}
          . Principal risks:{" "}
          {r.findings
            .filter((f) => f.sentiment === "contradict")
            .map((f) => f.title.toLowerCase())
            .join("; ") || "none"}
          .
        </p>

        <h2 className="mt-10 border-b pb-2 font-serif text-xl">Thesis validation</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2">Hypothesis</th>
              <th className="py-2">Assessment</th>
              <th className="py-2">Sources</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.validation.map((v) => (
              <tr key={v.hypothesis.id}>
                <td className="py-2 pr-4">{v.hypothesis.title}</td>
                <td className="py-2 pr-4 font-medium">{v.assessment}</td>
                <td className="py-2 text-muted-foreground">
                  {[...new Set(v.findings.map((f) => src(f.interviewId)?.name))].join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mt-10 border-b pb-2 font-serif text-xl">Key findings</h2>
        <div className="mt-3 space-y-5">
          {r.findings.map((f, i) => (
            <div key={f.id} className="break-inside-avoid">
              <p className="font-medium">
                {i + 1}. {f.title}
              </p>
              <p className="text-sm text-muted-foreground">
                {f.description}{" "}
                <span className="italic">Related: {hypothesisTitle(project, f.hypothesisId)}.</span>
              </p>
              <blockquote className="mt-1.5 border-l-2 pl-3 font-serif italic">
                “{f.quote}” — {src(f.interviewId)?.name}, {src(f.interviewId)?.title}
              </blockquote>
              {project.reviews[f.id]?.status && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Consultant review: {project.reviews[f.id]?.status}
                  {project.reviews[f.id]?.note ? ` — ${project.reviews[f.id]?.note}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>

        <h2 className="mt-10 border-b pb-2 font-serif text-xl">Research gaps</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {r.gaps.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
        <p className="mt-12 text-xs text-muted-foreground">
          This report was generated from simulated interviews for demonstration purposes and does
          not represent real research.
        </p>
      </article>
    </div>
  );
}
