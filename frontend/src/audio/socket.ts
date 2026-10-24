// WebSocket link for audio sessions: JSON control messages plus binary PCM16 frames.
export class AudioSocket {
  private ws: WebSocket | null = null;
  onJson: (m: any) => void = () => undefined;
  onClose: (code: number, reason: string) => void = () => undefined;

  connect(path: string): Promise<void> {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}${path}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            this.onJson(JSON.parse(ev.data));
          } catch {
            /* ignore */
          }
        }
      };
      ws.onclose = (ev) => {
        if (!opened) reject(new Error(ev.code === 1006 ? "The voice connection was refused (check that voice is configured and the link is valid)." : `Connection closed (${ev.code})`));
        this.onClose(ev.code, ev.reason);
      };
    });
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(m: unknown) {
    if (this.open) this.ws!.send(JSON.stringify(m));
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.open) this.ws!.send(pcm);
  }

  close() {
    try {
      this.ws?.close(1000);
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
