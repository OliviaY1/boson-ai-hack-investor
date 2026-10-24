// Consultant copilot drawer: text chat (always available), private voice, memory, and handoff.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CopilotMessageRecord } from "../../../shared/contracts";
import { api } from "../lib/api";
import type { CopilotVoice } from "../lib/copilotVoice";
import { liveInterview, when } from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import { ActionButton, Badge, Button, cx, inputCls, Notice } from "./ui";

export function CopilotDrawer({ voice, onClose }: { voice: CopilotVoice; onClose: () => void }) {
  const { snapshot: s, caps, go } = useWorkspace();
  const [tab, setTab] = useState<"chat" | "memory">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = useMemo(() => Object.values(s.copilot).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.copilot]);
  const live = liveInterview(s);
  useEffect(() => {
    // Braces matter: scrollIntoView returns a Promise in newer browsers, which must not become a cleanup.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const send = async (m: string) => {
    if (!m.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ navigation: any }>(`/api/projects/${s.project.id}/copilot`, { message: m });
      setText("");
      if (r.navigation) go(r.navigation);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="no-print flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-semibold">Copilot</span>
        <Badge tone="neutral">Private to consultant</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close copilot">
          ✕
        </Button>
      </div>
      <div className="flex gap-1 border-b border-line px-3 pt-1.5 text-sm">
        {(["chat", "memory"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-t-md px-2.5 py-1", tab === t ? "border border-b-white border-line bg-white font-medium -mb-px" : "text-muted")}>
            {t === "chat" ? "Conversation" : "Memory & handoff"}
          </button>
        ))}
      </div>
      <VoiceBar voice={voice} localTest={!!live?.localTest} />
      {tab === "chat" ? (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {msgs.length === 0 ? (
              <div className="text-sm text-muted">
                Ask for status, evidence, or gaps, or tell me what to investigate. Try “Where were we?” or “Which claims lack evidence?”. Reasoning: {caps?.reasoningProvider === "anthropic" ? caps.reasoningModel : "deterministic mock"}.
              </div>
            ) : null}
            {msgs.map((m) => (
              <Message key={m.id} m={m} />
            ))}
            <div ref={endRef} />
          </div>
          {err ? (
            <div className="px-3 pb-2">
              <Notice tone="bad">{err}</Notice>
            </div>
          ) : null}
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <input className={inputCls} placeholder="Message the copilot…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={busy} />
            <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
              {busy ? "…" : "Send"}
            </Button>
          </form>
        </>
      ) : (
        <MemoryPanel />
      )}
    </aside>
  );
}

function Message({ m }: { m: CopilotMessageRecord }) {
  const { go } = useWorkspace();
  if (m.role === "tool")
    return (
      <div className="text-xs text-muted">
        <span className="font-mono">{m.toolName}</span> · {m.text.split("\n")[0].slice(0, 140)}
        {m.navigation ? (
          <button className="ml-1 text-accent-700 underline" onClick={() => go(m.navigation!)}>
            open
          </button>
        ) : null}
      </div>
    );
  const mine = m.role === "consultant";
  return (
    <div className={cx("max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", mine ? "ml-auto bg-accent-50" : "bg-surface")}>
      {m.text}
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        {m.channel === "voice" ? "voice" : "text"} · {m.provider} · {when(m.createdAt)}
        {m.navigation ? (
          <button className="text-accent-700 underline" onClick={() => go(m.navigation!)}>
            Open source
          </button>
        ) : null}
      </div>
    </div>
  );
}

function VoiceBar({ voice, localTest }: { voice: CopilotVoice; localTest: boolean }) {
  const { caps } = useWorkspace();
  if (!caps) return null;
  if (!caps.bosonConfigured) return <div className="border-b border-line px-3 py-2 text-xs text-muted">Voice unavailable: BOSON_API_KEY is not configured on the backend. Text chat works.</div>;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
      {voice.state === "off" || voice.state === "error" ? (
        <Button size="sm" onClick={() => void voice.enable({ localTest, briefing: false })}>
          🎙 Enable private voice
        </Button>
      ) : (
        <>
          <Badge tone={voice.state === "ready" ? "good" : "info"}>{voice.state === "ready" ? (voice.assistantSpeaking ? "Copilot speaking" : "Listening") : "Connecting…"}</Badge>
          <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-surface">
            <span className="block h-full bg-accent-600" style={{ width: `${Math.min(100, voice.level * 600)}%` }} />
          </span>
          <Button size="sm" variant="ghost" onClick={voice.startBriefing} disabled={voice.state !== "ready"}>
            Briefing
          </Button>
          <Button size="sm" variant="ghost" onClick={voice.disable}>
            Stop voice
          </Button>
        </>
      )}
      {localTest && voice.state === "ready" ? <span className="text-amber-700">Local interview test paused while you speak privately.</span> : null}
      {voice.error ? <span className="text-red-700">{voice.error}</span> : null}
    </div>
  );
}

function MemoryPanel() {
  const { snapshot: s } = useWorkspace();
  const pid = s.project.id;
  const memory = Object.values(s.memory).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const handoff = Object.values(s.handoffs).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const changes = s.project.stateRevision - s.project.lastReviewedRevision;
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Project instructions</span>
        </div>
        <p className="mb-2 text-xs text-muted">Explicit instructions the copilot follows in every session. Retiring one keeps its history.</p>
        <ul className="space-y-1.5">
          {memory.filter((m) => m.status === "active").map((m) => (
            <li key={m.id} className="rounded-md border border-line px-2 py-1.5">
              {editing?.id === m.id ? (
                <div className="space-y-1.5">
                  <textarea className={inputCls} rows={2} value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} />
                  <div className="flex gap-1">
                    <ActionButton size="sm" variant="primary" action={async () => { await api.patch(`/api/projects/${pid}/memory/${m.id}`, { text: editing.text }); setEditing(null); }}>Save</ActionButton>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="flex-1">{m.text}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: m.id, text: m.text })}>Edit</Button>
                  <ActionButton size="sm" variant="ghost" action={() => api.del(`/api/projects/${pid}/memory/${m.id}`)}>Retire</ActionButton>
                </div>
              )}
            </li>
          ))}
          {memory.every((m) => m.status !== "active") ? <li className="text-xs text-muted">No active instructions.</li> : null}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await api.post(`/api/projects/${pid}/memory`, { text });
            setText("");
          }}
        >
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an instruction, e.g. “Report churn by clinic”" maxLength={1000} />
          <Button type="submit">Add</Button>
        </form>
        {memory.some((m) => m.status === "retired") ? (
          <details className="mt-2 text-xs text-muted">
            <summary>Retired ({memory.filter((m) => m.status === "retired").length})</summary>
            <ul className="mt-1 space-y-1">{memory.filter((m) => m.status === "retired").map((m) => <li key={m.id}><s>{m.text}</s></li>)}</ul>
          </details>
        ) : null}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Saved handoff</span>
          <ActionButton size="sm" action={() => api.post(`/api/projects/${pid}/handoff`)}>Refresh</ActionButton>
        </div>
        {handoff ? (
          <div className="rounded-md border border-line bg-surface p-2 text-xs">
            <div className="mb-1 text-muted">
              From state revision {handoff.sourceRevision} · {when(handoff.createdAt)} {handoff.stale ? <Badge tone="warn">Outdated: dependencies changed</Badge> : null}
            </div>
            <div className="whitespace-pre-wrap">{handoff.summary}</div>
          </div>
        ) : (
          <div className="text-xs text-muted">No handoff saved yet.</div>
        )}
      </div>
      <div className="flex items-center justify-between rounded-md border border-line p-2">
        <span className="text-xs">{changes > 0 ? `${changes} change(s) since you last marked the project reviewed.` : "Reviewed and up to date."}</span>
        <ActionButton size="sm" action={() => api.post(`/api/projects/${pid}/reviewed`)} disabled={changes <= 0}>Mark reviewed</ActionButton>
      </div>
    </div>
  );
}
