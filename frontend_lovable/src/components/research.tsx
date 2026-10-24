import { CheckCircle2, Circle, CircleDot, Layers, Lightbulb, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import type { DiligenceProject, Expert, Finding, Interview, InterviewQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { allHypotheses, roundsOf } from "@/lib/mock-service";
import { useRoundView } from "@/lib/round-view";
import { Badge } from "./ui-kit";
import { InterviewStatusBadge } from "./status";

export const expertOf = (p: DiligenceProject, id: string): Expert | undefined =>
  p.experts.find((e) => e.id === id);
export const hypothesisTitle = (p: DiligenceProject, id: string) =>
  allHypotheses(p).find((h) => h.id === id)?.title ?? id;
export const hypothesisIndex = (p: DiligenceProject, id: string) =>
  allHypotheses(p).findIndex((h) => h.id === id) + 1;

/**
 * Round indicator for the page header. Pages that show one round at a time
 * (Research Plan, Live Research) get a switcher; every other tab gets the same
 * readout so the consultant always knows which round they are in.
 */
export function RoundIndicator({
  project,
  interactive,
}: {
  project: DiligenceProject;
  interactive: boolean;
}) {
  const rounds = roundsOf(project);
  const { view, select } = useRoundView();
  if (!rounds.length) return null;
  // Pages that show one round at a time follow the consultant's pick; the
  // readout on other tabs always describes the current round.
  const value = interactive ? view(project) : rounds.length - 1;
  const ivs = rounds[value]?.interviews.length ?? 0;

  if (!interactive || rounds.length < 2) {
    return (
      <div className="flex items-center gap-2 rounded-full border bg-muted/70 px-3 py-1 text-xs">
        <Layers className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium">
          Round {value + 1}
          {rounds.length > 1 ? ` of ${rounds.length}` : ""}
        </span>
        <span className="text-muted-foreground">
          · {value === rounds.length - 1 ? "Current" : "Completed"}
        </span>
        <span className="hidden whitespace-nowrap text-muted-foreground xl:inline">
          · {ivs} interview{ivs === 1 ? "" : "s"}
        </span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Research round"
      className="inline-flex items-center gap-0.5 rounded-full border bg-muted p-0.5"
    >
      {rounds.map((r, i) => (
        <button
          key={i}
          aria-pressed={i === value}
          onClick={() => select(project.id, i)}
          className={cn(
            "rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            i === value && "bg-card font-medium text-foreground shadow-sm",
          )}
        >
          Round {i + 1}{" "}
          <span className="opacity-70">· {i === rounds.length - 1 ? "Current" : "Completed"}</span>
        </button>
      ))}
    </div>
  );
}

export function HypothesisTag({ project, id }: { project: DiligenceProject; id: string }) {
  return (
    <Badge tone="primary" className="font-normal">
      H{hypothesisIndex(project, id)} · {hypothesisTitle(project, id)}
    </Badge>
  );
}

export function InterviewCard({
  project,
  interview,
  onOpen,
  selected,
}: {
  project: DiligenceProject;
  interview: Interview;
  onOpen: () => void;
  selected?: boolean;
}) {
  const expert = expertOf(project, interview.expertId);
  const answered = interview.questions.filter((q) => q.status === "answered").length;
  const current = interview.questions.find((q) => q.status === "current");
  const latest = interview.findings.at(-1);
  const pct = interview.questions.length ? (answered / interview.questions.length) * 100 : 0;
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex h-full w-full flex-col justify-start rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40",
        selected && "border-primary ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{expert?.name ?? "Unknown expert"}</p>
          <p className="truncate text-xs text-muted-foreground">{expert?.title}</p>
        </div>
        <InterviewStatusBadge status={interview.status} />
      </div>
      <dl className="mt-4 space-y-2.5 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Current topic</dt>
          <dd className="font-medium">{interview.topic}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Current question</dt>
          <dd className="line-clamp-2 text-foreground/90">
            {current?.text ?? (interview.status === "Completed" ? "All questions addressed" : "—")}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>
            {answered} of {interview.questions.length} questions
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {latest && (
        <div
          key={latest.id}
          className="mt-4 flex gap-2 rounded-md bg-highlight/50 p-2.5 text-sm animate-fade-up"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-xs text-muted-foreground">Latest finding</p>
            <p className="font-medium leading-snug">{latest.title}</p>
          </div>
        </div>
      )}
    </button>
  );
}

export function TranscriptViewer({
  project,
  interview,
  highlightTurnId,
}: {
  project: DiligenceProject;
  interview: Interview;
  highlightTurnId?: string | undefined;
}) {
  const expert = expertOf(project, interview.expertId);
  const end = useRef<HTMLDivElement>(null);
  const hl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlightTurnId) hl.current?.scrollIntoView({ block: "center" });
    else end.current?.scrollIntoView({ block: "nearest" });
  }, [interview.transcript.length, highlightTurnId]);

  if (!interview.transcript.length)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        The transcript will appear here once the interview starts.
      </p>
    );

  const quoteFor = (turnId: string) => interview.findings.find((f) => f.turnId === turnId)?.quote;
  return (
    <div className="space-y-4">
      {interview.transcript.map((t) => {
        const q = quoteFor(t.id);
        const isHl = t.id === highlightTurnId;
        const parts = q && t.text.includes(q) ? t.text.split(q) : null;
        return (
          <div
            key={t.id}
            ref={isHl ? hl : undefined}
            className={cn(
              "animate-fade-up rounded-md px-3 py-2",
              isHl && "bg-highlight/40 ring-1 ring-warning/40",
            )}
          >
            <div className="mb-0.5 flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "font-semibold",
                  t.speaker === "ai" ? "text-primary" : "text-foreground",
                )}
              >
                {t.speaker === "ai" ? "AI Interviewer" : `Expert · ${expert?.name ?? ""}`}
              </span>
              <span className="font-mono text-muted-foreground">{t.time}</span>
            </div>
            <p className="text-sm leading-relaxed">
              {parts ? (
                <>
                  {parts[0]}
                  <mark className="rounded-sm bg-highlight px-0.5 text-foreground">{q}</mark>
                  {parts[1]}
                </>
              ) : (
                t.text
              )}
            </p>
          </div>
        );
      })}
      {interview.status === "In Progress" && (
        <p className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-primary" /> Simulated
          conversation in progress
        </p>
      )}
      <div ref={end} />
    </div>
  );
}

export function QuestionStatusList({ questions }: { questions: InterviewQuestion[] }) {
  return (
    <ol className="space-y-1.5">
      {questions.map((q, i) => {
        const Icon =
          q.status === "answered"
            ? CheckCircle2
            : q.status === "current"
              ? CircleDot
              : q.added
                ? Plus
                : Circle;
        return (
          <li
            key={q.id}
            className={cn(
              "flex gap-2.5 rounded-md px-2 py-1.5 text-sm",
              q.status === "current" && "bg-primary-soft",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                q.status === "answered"
                  ? "text-success"
                  : q.status === "current"
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
            />
            <span className={cn("flex-1", q.status === "answered" && "text-muted-foreground")}>
              <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}.</span>
              {q.text}
            </span>
            {q.added && (
              <Badge tone="warning" className="h-fit">
                Added
              </Badge>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function FindingItem({ project, finding }: { project: DiligenceProject; finding: Finding }) {
  return (
    <div className="animate-fade-up rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-snug">{finding.title}</p>
          <p className="text-sm text-muted-foreground">{finding.description}</p>
          <HypothesisTag project={project} id={finding.hypothesisId} />
        </div>
      </div>
    </div>
  );
}
