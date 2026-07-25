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

/**
 * Lifecycle of an outbound message, from the sender's point of view.
 * sending → sent (relay accepted) → delivered (recipient device got it) →
 * read (recipient opened the conversation).
 */
export type MessageStatus = "sending" | "sent" | "delivered" | "read";

/** Client → relay: submit an envelope for routing. */
export interface SendEnvelopeRequest {
  kind: "send";
  envelope: Omit<Envelope, "id">;
  /** Sender-generated correlation id, echoed back in the ack (never delivered). */
  clientRef?: string;
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
  /** Echo of the sender's clientRef, so it can mark that message "sent". */
  clientRef?: string;
}

/**
 * Client → relay: a receipt for a received message. Drops the relay's stored
 * copy and (via `targetId`/`targetDevice`) asks the relay to forward a status
 * update back to the original sender. `status` is "delivered" (auto, on receive)
 * or "read" (when the recipient opens the conversation).
 */
export interface DeliveryReceiptMessage {
  kind: "receipt";
  envelopeId: string;
  status: "delivered" | "read";
  /** The original sender (the receipt's destination). */
  targetId: string;
  targetDevice: number;
}

/** Relay → original sender: the recipient's status update for a message. */
export interface MessageStatusMessage {
  kind: "status";
  envelopeId: string;
  status: "delivered" | "read";
}

/** Any message that can travel over the relay WebSocket. */
export type RelayMessage =
  | SendEnvelopeRequest
  | DeliverEnvelopeMessage
  | EnvelopeAckMessage
  | DeliveryReceiptMessage
  | MessageStatusMessage;
