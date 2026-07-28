package main

import (
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
)

// Client wraps one authenticated WebSocket connection. gorilla/websocket allows
// only a single concurrent writer, so all writes funnel through `out` and are
// drained by a dedicated writer goroutine.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	routeKey string
	userID   string
	deviceID int
	out      chan RelayMessage
}

func newClient(hub *Hub, conn *websocket.Conn, userID string, deviceID int) *Client {
	return &Client{
		hub:      hub,
		conn:     conn,
		routeKey: routeKey(userID, deviceID),
		userID:   userID,
		deviceID: deviceID,
		out:      make(chan RelayMessage, 64),
	}
}

func (c *Client) send(msg RelayMessage) {
	select {
	case c.out <- msg:
	default:
		log.Printf("send buffer full, dropping message for %s", c.routeKey)
	}
}

// writePump is the single writer for this connection.
func (c *Client) writePump() {
	for msg := range c.out {
		if err := c.conn.WriteJSON(msg); err != nil {
			log.Printf("write error for %s: %v", c.routeKey, err)
			return
		}
	}
}

// readPump reads client frames until the connection closes. It only ever acts
// on envelope metadata — it treats Ciphertext as opaque.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister(c)
		close(c.out)
		_ = c.conn.Close()
	}()

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg RelayMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("bad message from %s: %v", c.routeKey, err)
			continue
		}

		switch msg.Kind {
		case "send":
			if msg.Envelope == nil {
				continue
			}
			env := *msg.Envelope
			// Trust the authenticated sender identity, not the client-claimed one.
			env.SenderID = c.userID
			env.SenderDevice = c.deviceID
			id := c.hub.route(env)
			c.send(RelayMessage{Kind: "ack", EnvelopeID: id, AcceptedAt: nowMillis(), ClientRef: msg.ClientRef})
		case "register-push":
			// Bind the device's FCM token to this authenticated connection.
			if msg.Token != "" {
				c.hub.registerPushToken(c.routeKey, msg.Token)
			}
		case "receipt":
			// The recipient confirmed delivery/read. In production this also
			// deletes the row from the Postgres message_queue; the in-memory
			// queue already dropped it on delivery. Forward the status back to
			// the original sender (best-effort — dropped if they're offline).
			if msg.TargetID != "" && (msg.Status == "delivered" || msg.Status == "read") {
				c.hub.forwardStatus(msg.TargetID, msg.TargetDevice, RelayMessage{
					Kind:       "status",
					EnvelopeID: msg.EnvelopeID,
					Status:     msg.Status,
				})
			}
		default:
			log.Printf("ignoring message kind %q from %s", msg.Kind, c.routeKey)
		}
	}
}
