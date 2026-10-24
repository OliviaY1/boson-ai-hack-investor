import type { Assessment } from "@/lib/mock-service";
import type { ExpertSource, InterviewStatus, ProjectStatus } from "@/lib/types";
import { Badge } from "./ui-kit";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone = {
    Draft: "outline",
    Planning: "neutral",
    "Ready for Interviews": "primary",
    "In Progress": "warning",
    Completed: "success",
  } as const;
  return (
    <Badge tone={tone[status]} dot>
      {status}
    </Badge>
  );
}

export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  const tone = {
    "Not Started": "outline",
    "In Progress": "primary",
    Paused: "warning",
    Completed: "success",
  } as const;
  return (
    <Badge tone={tone[status]} dot={status === "In Progress" ? "pulse" : true}>
      {status}
    </Badge>
  );
}

export function AssessmentBadge({ value }: { value: Assessment }) {
  const tone = {
    Supported: "success",
    Contradicted: "danger",
    "Mixed Evidence": "warning",
    "Insufficient Evidence": "outline",
  } as const;
  return (
    <Badge tone={tone[value]} dot>
      {value}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: ExpertSource }) {
  return (
    <Badge tone={source === "Custom" ? "neutral" : "outline"}>
      {source === "Custom" ? "Custom contact" : source}
    </Badge>
  );
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
