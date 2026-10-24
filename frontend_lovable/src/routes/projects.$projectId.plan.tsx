import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ClipboardList,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { expertOf, HypothesisTag } from "@/components/research";
import { SourceBadge } from "@/components/status";
import {
  Button,
  buttonVariants,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  SectionTitle,
  Textarea,
} from "@/components/ui-kit";
import { createInterviewsFromPlan, roundsOf, uid } from "@/lib/mock-service";
import { useProject } from "@/lib/store";
import { useRoundView } from "@/lib/round-view";
import type { DiligenceProject, PlanExpert } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$projectId/plan")({
  component: PlanPage,
});

function PlanPage() {
  const { projectId } = Route.useParams();
  const { project, update } = useProject(projectId);
  const navigate = useNavigate();
  const { view } = useRoundView();
  if (!project) return null;
  const rounds = roundsOf(project);
  const viewIdx = view(project);
  const isPast = viewIdx < rounds.length - 1;
  const plan = rounds[viewIdx]?.plan;
  if (!plan)
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="No research plan yet"
        description="Set up expert sources, then generate a plan from the investment thesis."
        action={
          <Link
            to="/projects/$projectId/sources"
            params={{ projectId }}
            className={buttonVariants()}
          >
            Go to Expert Sources
          </Link>
        }
      />
    );

  const locked = isPast || project.interviews.some((i) => i.status !== "Not Started");
  const roundNo = viewIdx + 1;
  const setPlanExpert = (expertId: string, fn: (pe: PlanExpert) => PlanExpert) =>
    update((p) => ({
      ...p,
      plan: {
        ...p.plan!,
        approved: false,
        experts: p.plan!.experts.map((pe) => (pe.expertId === expertId ? fn(pe) : pe)),
      },
    }));

  const approve = () => {
    if (!locked)
      update((p) => ({
        ...p,
        plan: { ...p.plan!, approved: true },
        interviews: createInterviewsFromPlan(p.plan!),
      }));
    navigate({ to: "/projects/$projectId/live", params: { projectId } });
  };

  return (
    <div className="space-y-10">
      {locked && (
        <div className="flex items-center gap-2 rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
          <Lock className="size-4" />{" "}
          {isPast
            ? `Round ${roundNo} is complete. This plan is shown for reference.`
            : "Research is underway, so this plan is read-only. Add follow-up questions from Live Research."}
        </div>
      )}
      {roundNo > 1 && !isPast && !plan.approved && (
        <div className="rounded-md border border-primary/30 bg-primary-soft px-4 py-3 text-sm">
          <span className="font-medium">
            Round {roundNo} plan, proposed from Round {roundNo - 1} findings.
          </span>{" "}
          Review the new expert guides and questions below, then approve to start the next
          interviews.
        </div>
      )}

      <section>
        <SectionTitle
          title="Recommended experts"
          description="Experts selected to validate each hypothesis, with proposed interview guides."
        />
        <div className="space-y-3">
          {plan.experts.map((pe) => (
            <PlanExpertCard
              key={pe.expertId}
              project={project}
              pe={pe}
              locked={locked}
              onChange={(fn) => setPlanExpert(pe.expertId, fn)}
              onRemove={() =>
                update((p) => ({
                  ...p,
                  plan: {
                    ...p.plan!,
                    approved: false,
                    experts: p.plan!.experts.filter((x) => x.expertId !== pe.expertId),
                  },
                }))
              }
            />
          ))}
          {!plan.experts.length && (
            <EmptyState
              title="No experts selected"
              description="Add experts on the Expert Sources tab, then regenerate the plan."
            />
          )}
        </div>
      </section>

      {!isPast && (
        <Card className="flex items-center justify-between gap-6 border-primary/30 p-5">
          <div>
            <p className="font-medium">
              {plan.approved ? "Plan approved" : "Human approval required"}
            </p>
            <p className="text-sm text-muted-foreground">
              Approving creates {plan.experts.length} simulated interview sessions. No real calls
              will be placed.
            </p>
          </div>
          <Button size="lg" disabled={!plan.experts.length} onClick={approve}>
            {locked
              ? "Go to Live Research"
              : roundNo > 1
                ? `Approve & Start Round ${roundNo}`
                : "Approve & Start Research"}{" "}
            <ArrowRight />
          </Button>
        </Card>
      )}
    </div>
  );
}

function PlanExpertCard({
  project,
  pe,
  locked,
  onChange,
  onRemove,
}: {
  project: DiligenceProject;
  pe: PlanExpert;
  locked: boolean;
  onChange: (fn: (pe: PlanExpert) => PlanExpert) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [newQ, setNewQ] = useState("");
  const [editObj, setEditObj] = useState(false);
  const [obj, setObj] = useState(pe.objectives);
  const [confirm, setConfirm] = useState(false);
  const e = expertOf(project, pe.expertId);

  const move = (i: number, d: number) =>
    onChange((x) => {
      const q = [...x.questions];
      [q[i], q[i + d]] = [q[i + d]!, q[i]!];
      return { ...x, questions: q };
    });

  return (
    <Card>
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{e?.name ?? "Removed expert"}</p>
            {e && <SourceBadge source={e.source} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {e?.title} — {e?.description}
          </p>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Reason for selection</p>
              <p>{pe.reason}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Validates</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {pe.hypothesisIds.map((h) => (
                  <HypothesisTag key={h} project={project} id={h} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!locked && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove expert"
              onClick={() => setConfirm(true)}
            >
              <X />
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
            {pe.questions.length} questions{" "}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>
      {open && (
        <div className="space-y-5 border-t bg-muted/30 px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Interview objectives
              </p>
              {!locked && !editObj && (
                <Button
                  variant="link"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setObj(pe.objectives);
                    setEditObj(true);
                  }}
                >
                  Edit
                </Button>
              )}
            </div>
            {editObj ? (
              <div className="flex gap-2">
                <Textarea rows={2} value={obj} onChange={(ev) => setObj(ev.target.value)} />
                <Button
                  size="sm"
                  onClick={() => {
                    onChange((x) => ({ ...x, objectives: obj }));
                    setEditObj(false);
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-sm">{pe.objectives}</p>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Proposed questions
            </p>
            <ol className="space-y-1">
              {pe.questions.map((q, i) => (
                <li
                  key={q.id}
                  className="group flex items-start gap-3 rounded-md bg-card px-3 py-2 text-sm ring-1 ring-border"
                >
                  <span className="mt-0.5 font-mono text-xs text-muted-foreground">{i + 1}.</span>
                  {editingId === q.id ? (
                    <div className="flex flex-1 gap-2">
                      <Input
                        autoFocus
                        value={text}
                        onChange={(ev) => setText(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && text.trim()) {
                            onChange((x) => ({
                              ...x,
                              questions: x.questions.map((y) =>
                                y.id === q.id ? { ...y, text } : y,
                              ),
                            }));
                            setEditingId(null);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!text.trim()}
                        onClick={() => {
                          onChange((x) => ({
                            ...x,
                            questions: x.questions.map((y) => (y.id === q.id ? { ...y, text } : y)),
                          }));
                          setEditingId(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <span className="flex-1">{q.text}</span>
                  )}
                  {!locked && editingId !== q.id && (
                    <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move down"
                        disabled={i === pe.questions.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit question"
                        onClick={() => {
                          setEditingId(q.id);
                          setText(q.text);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete question"
                        onClick={() =>
                          onChange((x) => ({
                            ...x,
                            questions: x.questions.filter((y) => y.id !== q.id),
                          }))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {!locked && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  if (!newQ.trim()) return;
                  onChange((x) => ({
                    ...x,
                    questions: [...x.questions, { id: uid("q"), text: newQ.trim() }],
                  }));
                  setNewQ("");
                }}
              >
                <Input
                  value={newQ}
                  onChange={(ev) => setNewQ(ev.target.value)}
                  placeholder="Add a question"
                />
                <Button type="submit" variant="secondary" disabled={!newQ.trim()}>
                  <Plus /> Add
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={onRemove}
        title={`Remove ${e?.name} from the plan?`}
        description="Their interview guide will be discarded."
        confirmLabel="Remove"
      />
    </Card>
  );
}
