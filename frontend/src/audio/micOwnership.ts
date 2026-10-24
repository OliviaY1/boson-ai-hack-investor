// One active owner of the local microphone across every tab of this origin: the participant
// (local interview test) or the consultant's private copilot voice. Claiming the mic stops the
// previous owner's capture before the new one starts; separate WebSockets alone are not isolation.
export type MicRole = "participant" | "consultant";

interface Owner {
  id: string;
  role: MicRole;
  stream: MediaStream;
  onRevoked: (by: MicRole) => void;
}

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("diligence-live-mic") : null;
let owner: Owner | null = null;
const listeners = new Set<(m: { type: "claimed" | "released"; role: MicRole }) => void>();

function stopOwner(by: MicRole) {
  if (!owner) return;
  const o = owner;
  owner = null;
  o.stream.getTracks().forEach((t) => t.stop());
  o.onRevoked(by);
}

channel?.addEventListener("message", (ev) => {
  const m = ev.data as { type: "claimed" | "released"; role: MicRole };
  if (m.type === "claimed") stopOwner(m.role);
  listeners.forEach((l) => l(m));
});

export function onMicChange(fn: (m: { type: "claimed" | "released"; role: MicRole }) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class MicError extends Error {
  constructor(
    message: string,
    readonly kind: "denied" | "missing" | "unsupported" | "other",
  ) {
    super(message);
  }
}

export async function acquireMic(role: MicRole, onRevoked: (by: MicRole) => void): Promise<{ id: string; stream: MediaStream }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("This browser does not support microphone capture (a secure context such as localhost or HTTPS is required).", "unsupported");
  stopOwner(role); // this tab
  channel?.postMessage({ type: "claimed", role }); // other tabs stop their capture
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("Microphone permission was denied. Allow microphone access in the browser and try again; text controls remain available.", "denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("No microphone was found on this device.", "missing");
    throw new MicError(`The microphone could not be started: ${(e as Error).message}`, "other");
  }
  const id = crypto.randomUUID();
  owner = { id, role, stream, onRevoked };
  return { id, stream };
}

export function releaseMic(id: string) {
  if (owner?.id !== id) return;
  const role = owner.role;
  owner.stream.getTracks().forEach((t) => t.stop());
  owner = null;
  channel?.postMessage({ type: "released", role });
}

export function currentMicRole(): MicRole | null {
  return owner?.role ?? null;
}
