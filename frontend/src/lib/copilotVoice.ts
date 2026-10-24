// Consultant private voice: a separate Higgs session with server VAD. The microphone is claimed
// exclusively for the consultant; a local interview test is paused by the backend while active.
import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigationTarget } from "../../../shared/contracts";
import { MicCapture } from "../audio/capture";
import { acquireMic, releaseMic } from "../audio/micOwnership";
import { PcmPlayer } from "../audio/playback";
import { AudioSocket } from "../audio/socket";

export type CopilotVoiceState = "off" | "connecting" | "ready" | "error";

export interface CopilotVoice {
  state: CopilotVoiceState;
  error: string | null;
  assistantSpeaking: boolean;
  level: number;
  lastHeard: string | null;
  enable: (opts: { localTest: boolean; briefing: boolean }) => Promise<void>;
  startBriefing: () => void;
  disable: () => void;
}

export function useCopilotVoice(projectId: string, onNavigate: (t: NavigationTarget) => void): CopilotVoice {
  const [state, setState] = useState<CopilotVoiceState>("off");
  const [error, setError] = useState<string | null>(null);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const r = useRef<{ sock?: AudioSocket; cap?: MicCapture; player?: PcmPlayer; micId?: string; briefOnReady?: boolean }>({});
  const navRef = useRef(onNavigate);
  navRef.current = onNavigate;

  const teardown = useCallback((msg?: string) => {
    const x = r.current;
    r.current = {};
    x.sock?.close();
    void x.cap?.stop();
    void x.player?.close();
    if (x.micId) releaseMic(x.micId);
    setAssistantSpeaking(false);
    setLevel(0);
    if (msg) {
      setError(msg);
      setState("error");
    } else setState("off");
  }, []);

  const enable = useCallback(
    async ({ localTest, briefing }: { localTest: boolean; briefing: boolean }) => {
      if (r.current.sock) {
        if (briefing) r.current.sock.send({ type: "start_briefing" });
        return;
      }
      setError(null);
      setState("connecting");
      const player = new PcmPlayer();
      try {
        await player.activate(); // inside the click gesture: browser audio activation
        const mic = await acquireMic("consultant", (by) => teardown(by === "participant" ? "The microphone was claimed by the participant test session." : undefined));
        r.current = { player, micId: mic.id, briefOnReady: briefing };
        const sock = new AudioSocket();
        r.current.sock = sock;
        let respId = "c0";
        sock.onJson = (m) => {
          switch (m.type) {
            case "ready":
              setState("ready");
              if (r.current.briefOnReady) sock.send({ type: "start_briefing" });
              return;
            case "audio":
              respId = m.responseId ?? respId;
              player.enqueue(respId, m.data);
              return;
            case "flush": {
              const played = player.flush();
              sock.send({ type: "playback", event: "flushed", playedMs: played.get(m.responseId ?? respId) ?? 0 });
              return;
            }
            case "user_text":
              setLastHeard(m.text);
              return;
            case "navigate":
              navRef.current(m.target as NavigationTarget);
              return;
            case "error":
              teardown(m.message);
              return;
          }
        };
        sock.onClose = () => {
          if (r.current.sock === sock) teardown("The voice connection closed.");
        };
        player.onActivity = setAssistantSpeaking;
        await sock.connect(`/ws/copilot?project=${encodeURIComponent(projectId)}&localTest=${localTest ? 1 : 0}`);
        const cap = new MicCapture(mic.stream, { onFrame: (pcm) => sock.sendAudio(pcm), onLevel: setLevel });
        r.current.cap = cap;
        await cap.start();
      } catch (e) {
        teardown((e as Error).message);
      }
    },
    [projectId, teardown],
  );

  useEffect(() => () => teardown(), [teardown]);

  return {
    state,
    error,
    assistantSpeaking,
    level,
    lastHeard,
    enable,
    startBriefing: () => r.current.sock?.send({ type: "start_briefing" }),
    disable: () => teardown(),
  };
}
