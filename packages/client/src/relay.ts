/**
 * RelayConnection — thin client over the `backend/relay` WebSocket.
 *
 * Portable across Node and React Native: the WebSocket constructor is injected.
 * React Native and browsers have a global `WebSocket`; Node (< 22, or to avoid
 * the experimental global) passes the `ws` package's constructor. The relay only
 * ever sees opaque `Envelope`s — this class does no crypto.
 */
import type { Envelope, RelayMessage } from "@hwfa/models";

/** Minimal structural type for a WebSocket instance (works for `ws` + DOM). */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener?(type: string, listener: (ev: any) => void): void;
  on?(type: string, listener: (ev: any) => void): void;
}

export interface WebSocketCtor {
  new (url: string): WebSocketLike;
}

export type DeliverHandler = (envelope: Envelope) => void;

export class RelayConnection {
  private ws: WebSocketLike | null = null;

  constructor(
    private readonly relayUrl: string,
    private readonly userId: string,
    private readonly deviceId: number,
    private readonly webSocketCtor: WebSocketCtor,
    private readonly onDeliver: DeliverHandler,
  ) {}

  connect(): Promise<void> {
    const url = `${this.relayUrl}?userId=${encodeURIComponent(this.userId)}&deviceId=${this.deviceId}`;
    const ws = new this.webSocketCtor(url);
    this.ws = ws;

    this.listen(ws, "message", (ev: any) => {
      const raw = typeof ev === "string" ? ev : ev?.data ?? ev;
      const msg = JSON.parse(String(raw)) as RelayMessage;
      if (msg.kind === "deliver" && msg.envelope) {
        this.onDeliver(msg.envelope);
        // Acknowledge so the relay can drop the stored copy.
        this.send({ kind: "receipt", envelopeId: msg.envelope.id });
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.listen(ws, "open", () => resolve());
      this.listen(ws, "error", (ev: any) => reject(ev instanceof Error ? ev : new Error("relay socket error")));
    });
  }

  /** Submit an envelope (server assigns its id). */
  sendEnvelope(envelope: Omit<Envelope, "id">): void {
    this.send({ kind: "send", envelope });
  }

  send(msg: RelayMessage): void {
    if (!this.ws) throw new Error("relay not connected");
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  /** Bridge the two event APIs: `ws` uses .on(), DOM/RN use .addEventListener(). */
  private listen(ws: WebSocketLike, type: string, listener: (ev: any) => void): void {
    if (typeof ws.addEventListener === "function") ws.addEventListener(type, listener);
    else if (typeof ws.on === "function") ws.on(type, listener);
    else throw new Error("WebSocket implementation exposes neither addEventListener nor on");
  }
}
