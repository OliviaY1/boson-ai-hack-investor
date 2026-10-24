import type { Assessment, Coverage, DeliveryState, Lifecycle, Snapshot } from "../../../shared/contracts";
import { ASSESSMENT_LABELS } from "../../../shared/contracts";
import { codeSort } from "../../../shared/synthesis";

export { ASSESSMENT_LABELS, codeSort };

export const COVERAGE_LABELS: Record<Coverage, string> = {
  pending: "Pending",
  partially_answered: "Partially answered",
  answered: "Answered",
  unable_to_answer: "Unable to answer",
  skipped: "Skipped",
};

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  queued: "Queued",
  speaking: "Speaking",
  completed: "Delivered",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  failed: "Failed",
  unknown: "Delivery unknown",
};

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  ready: "Ready",
  awaiting_participant: "Waiting for participant",
  consent_pending: "Awaiting consent",
  active: "In progress",
  paused: "Paused (no new questions)",
  ended: "Ended",
  interrupted: "Interrupted (resumable)",
};

export const INTERRUPTION_REASONS: Record<string, string> = {
  backend_restart: "the backend restarted",
  participant_disconnected: "the participant disconnected",
  provider_disconnected: "the voice provider closed the connection",
  provider_unavailable: "the voice provider could not start a session",
  provider_unresponsive: "the voice provider stopped responding",
};

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info";

export const ASSESSMENT_TONE: Record<Assessment, Tone> = {
  unassessed: "neutral",
  supported_by_interview: "good",
  contradicted_by_interview: "bad",
  mixed_evidence: "warn",
  inconclusive: "info",
};

export const COVERAGE_TONE: Record<Coverage, Tone> = {
  pending: "neutral",
  partially_answered: "info",
  answered: "good",
  unable_to_answer: "warn",
  skipped: "neutral",
};

export function when(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function duration(fromIso: string | null, toIso: string | null, nowMs = Date.now()) {
  if (!fromIso) return "0:00";
  const ms = (toIso ? new Date(toIso).getTime() : nowMs) - new Date(fromIso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function human(s: string) {
  return s.replace(/_/g, " ");
}

export function activeClaims(s: Snapshot) {
  return Object.values(s.claims).filter((c) => c.status === "active").sort(codeSort);
}

export function activeQuestions(s: Snapshot) {
  return Object.values(s.questions).filter((q) => q.status === "active").sort(codeSort);
}

export function currentPlan(s: Snapshot) {
  return s.project.currentPlanId ? s.plans[s.project.currentPlanId] ?? null : null;
}

export function currentDocument(s: Snapshot) {
  return Object.values(s.documents).find((d) => d.isCurrent) ?? null;
}

export function liveInterview(s: Snapshot) {
  const live = Object.values(s.interviews).filter((i) => ["awaiting_participant", "consent_pending", "active", "paused"].includes(i.lifecycle));
  return live[0] ?? null;
}
