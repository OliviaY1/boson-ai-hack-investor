import { useCapabilities } from "../lib/store";
import { Badge, Card } from "./ui";

export function CapabilityPanel() {
  const caps = useCapabilities();
  if (!caps) return null;
  return (
    <Card title="Runtime modes">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span>Reasoning provider</span>
          <Badge tone={caps.reasoningProvider === "anthropic" ? "good" : "warn"}>{caps.reasoningProvider === "anthropic" ? caps.reasoningModel : "Deterministic mock"}</Badge>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>Higgs realtime voice</span>
          <Badge tone={caps.bosonConfigured ? "good" : "neutral"}>{caps.bosonConfigured ? "Configured" : "Voice unavailable"}</Badge>
        </div>
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {caps.modes.map((m) => (
            <li key={m.mode}>
              <div className="flex items-start justify-between gap-2">
                <span className={m.available ? "" : "text-muted"}>{m.label}</span>
                <Badge tone={m.available ? "good" : "neutral"}>{m.available ? "Available" : "Unavailable"}</Badge>
              </div>
              {m.requirement ? <div className="text-xs text-muted">{m.requirement}</div> : null}
            </li>
          ))}
        </ul>
        {!caps.bosonConfigured ? <p className="text-xs text-muted">Voice unavailable: set BOSON_API_KEY on the backend. The synthetic demo and text copilot work without it.</p> : null}
      </div>
    </Card>
  );
}
