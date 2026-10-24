import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Pencil } from "lucide-react";
import { useState } from "react";
import {
  Button,
  buttonVariants,
  Card,
  Input,
  Label,
  SectionTitle,
  Textarea,
} from "@/components/ui-kit";
import { useProject } from "@/lib/store";
import { allHypotheses, allInterviews } from "@/lib/mock-service";

export const Route = createFileRoute("/projects/$projectId/")({
  component: Overview,
});

function Overview() {
  const { projectId } = Route.useParams();
  const { project, update } = useProject(projectId);
  const [editing, setEditing] = useState(false);
  const [company, setCompany] = useState("");
  const [thesis, setThesis] = useState("");
  if (!project) return null;

  const next = (() => {
    switch (project.status) {
      case "Draft":
        return {
          text: "Connect expert networks and add contacts the AI can interview.",
          to: "/projects/$projectId/sources" as const,
          label: "Go to Expert Sources",
        };
      case "Planning":
        return {
          text: "Review the AI-generated research plan and approve it.",
          to: "/projects/$projectId/plan" as const,
          label: "Review Research Plan",
        };
      case "Ready for Interviews":
      case "In Progress":
        return {
          text: "Monitor interviews, review transcripts and add follow-up questions.",
          to: "/projects/$projectId/live" as const,
          label: "Open Live Research",
        };
      default:
        return {
          text: "Interviews are complete. Review the consolidated findings.",
          to: "/projects/$projectId/findings" as const,
          label: "View Findings",
        };
    }
  })();

  const ivs = allInterviews(project);
  const answered = ivs.reduce(
    (n, i) => n + i.questions.filter((q) => q.status === "answered").length,
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card className="p-6">
        <SectionTitle
          title="Investment thesis"
          description="The source document the AI uses to extract hypotheses."
          action={
            !editing && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCompany(project.company);
                  setThesis(project.thesis);
                  setEditing(true);
                }}
              >
                <Pencil /> Edit
              </Button>
            )
          }
        />
        {editing ? (
          <div className="space-y-4">
            <div>
              <Label>Target Company</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div>
              <Label>Investment Thesis</Label>
              <Textarea rows={16} value={thesis} onChange={(e) => setThesis(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  update((p) => ({ ...p, company: company.trim() || p.company, thesis }));
                  setEditing(false);
                }}
              >
                Save changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-line font-serif text-[15px] leading-relaxed text-foreground/90">
            {project.thesis || "No thesis provided."}
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card className="border-primary/30 bg-primary-soft p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Next step</p>
          <p className="mt-2 text-sm">{next.text}</p>
          <Link
            to={next.to}
            params={{ projectId }}
            className={buttonVariants({ size: "sm", className: "mt-4" })}
          >
            {next.label} <ArrowRight />
          </Link>
        </Card>
        <Card className="divide-y text-sm">
          {[
            ["Available experts", project.experts.length],
            ["Hypotheses", allHypotheses(project).length || "—"],
            ["Research round", (project.pastRounds?.length ?? 0) + 1],
            ["Interviews", ivs.length],
            ["Questions answered", answered],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-5 py-3">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium tabular-nums">{v}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
