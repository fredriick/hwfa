package main

// Envelope is the only thing the relay ever sees. It routes by recipient
// identity + device but NEVER inspects Ciphertext. This mirrors the TypeScript
// `Envelope` in packages/models/src/envelope.ts — keep the two in sync.
type Envelope struct {
	ID              string `json:"id"`
	RecipientID     string `json:"recipientId"`
	RecipientDevice int    `json:"recipientDevice"`
	SenderID        string `json:"senderId"`
	SenderDevice    int    `json:"senderDevice"`
	Type            int    `json:"type"` // libsignal CiphertextType: 3=PreKey, 2=Whisper
	Ciphertext      string `json:"ciphertext"`
	Timestamp       int64  `json:"timestamp"`
}

// RelayMessage is the tagged-union wire protocol over the WebSocket. Only the
// fields relevant to `Kind` are populated. Mirrors the TS `RelayMessage`.
type RelayMessage struct {
	Kind string `json:"kind"` // "send" | "deliver" | "ack" | "receipt" | "status"

	// send / deliver
	Envelope *Envelope `json:"envelope,omitempty"`

	// ack / receipt / status
	EnvelopeID string `json:"envelopeId,omitempty"`
	AcceptedAt int64  `json:"acceptedAt,omitempty"`
	ClientRef  string `json:"clientRef,omitempty"` // send → echoed in ack

	// receipt: where to forward the status; status: the value forwarded
	Status       string `json:"status,omitempty"` // "delivered" | "read"
	TargetID     string `json:"targetId,omitempty"`
	TargetDevice int    `json:"targetDevice,omitempty"`
}

// routeKey identifies a specific recipient device — the routing granularity,
// since every message is encrypted per-device.
func routeKey(userID string, deviceID int) string {
	return userID + ":" + itoa(deviceID)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
