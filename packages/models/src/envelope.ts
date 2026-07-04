/**
 * Envelope — the only thing the relay ever sees.
 *
 * The relay routes by recipient identity + device but never inspects
 * `ciphertext`. This shape is mirrored by `backend/relay` in Go
 * (see backend/relay/envelope.go). Keep the two in sync.
 */

/** Ciphertext message types produced by libsignal's `signalEncrypt`. */
export enum CiphertextType {
  /** PreKeySignalMessage — the first message in a new session (carries X3DH). */
  PreKey = 3,
  /** SignalMessage — a normal Double Ratchet message in an established session. */
  Whisper = 2,
}

/**
 * The wire envelope. `ciphertext` is base64-encoded opaque bytes; the relay
 * treats it as an opaque blob and never decrypts it.
 */
export interface Envelope {
  /** Server-assigned unique id, used for delivery receipts / dedup. */
  id: string;
  /** Recipient account (UUID). */
  recipientId: string;
  /** Recipient device id — messages are encrypted per-device. */
  recipientDevice: number;
  /** Sender account (UUID). */
  senderId: string;
  /** Sender device id. */
  senderDevice: number;
  /** libsignal ciphertext type — tells the recipient which decrypt path to use. */
  type: CiphertextType;
  /** Base64-encoded opaque ciphertext. The relay never decrypts this. */
  ciphertext: string;
  /** Epoch milliseconds when the sender created the envelope. */
  timestamp: number;
}

/** Client → relay: submit an envelope for routing. */
export interface SendEnvelopeRequest {
  kind: "send";
  envelope: Omit<Envelope, "id">;
}

/** Relay → recipient client: deliver a queued/live envelope. */
export interface DeliverEnvelopeMessage {
  kind: "deliver";
  envelope: Envelope;
}

/** Relay → sender client: acknowledge acceptance of a submitted envelope. */
export interface EnvelopeAckMessage {
  kind: "ack";
  envelopeId: string;
  acceptedAt: number;
}

/** Client → relay: acknowledge successful receipt so the relay can drop it. */
export interface DeliveryReceiptMessage {
  kind: "receipt";
  envelopeId: string;
}

/** Any message that can travel over the relay WebSocket. */
export type RelayMessage =
  | SendEnvelopeRequest
  | DeliverEnvelopeMessage
  | EnvelopeAckMessage
  | DeliveryReceiptMessage;
