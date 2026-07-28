package main

import (
	"encoding/json"
	"log"
	"os"
	"sync"
)

// Hub is the routing core: it tracks which recipient devices are currently
// connected and holds a store-and-forward queue for offline ones.
//
// The store-and-forward queue optionally persists to a JSON file (RELAY_DATA) so
// undelivered messages survive a relay restart; otherwise it is in-memory. In
// production this is the Postgres `message_queue` table (ciphertext-only,
// 30-day TTL) so delivery also survives horizontal scaling. The relay still
// never inspects Ciphertext — the persisted blob is opaque envelopes.
type Hub struct {
	mu     sync.Mutex
	path   string                // persistence file; "" = in-memory only
	conns  map[string]*Client    // routeKey -> live connection
	queue  map[string][]Envelope // routeKey -> undelivered envelopes
	nextID uint64
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[string]*Client),
		queue: make(map[string][]Envelope),
	}
}

// NewPersistentHub loads the queue from `path` if present, else starts empty and
// writes to that path as messages are queued/flushed.
func NewPersistentHub(path string) *Hub {
	h := NewHub()
	h.path = path
	if err := h.load(); err != nil {
		log.Printf("relay: could not load %s (%v); starting empty", path, err)
	} else {
		queued := 0
		for _, msgs := range h.queue {
			queued += len(msgs)
		}
		if queued > 0 {
			log.Printf("relay: loaded %d queued message(s) from %s", queued, path)
		}
	}
	return h
}

// --- persistence ---

type persistedHub struct {
	NextID uint64                `json:"nextId"`
	Queue  map[string][]Envelope `json:"queue"`
}

// persistLocked writes the queue to disk atomically. Caller must hold h.mu.
func (h *Hub) persistLocked() {
	if h.path == "" {
		return
	}
	data, err := json.MarshalIndent(persistedHub{NextID: h.nextID, Queue: h.queue}, "", "  ")
	if err != nil {
		log.Printf("relay: marshal queue failed: %v", err)
		return
	}
	tmp := h.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		log.Printf("relay: write %s failed: %v", tmp, err)
		return
	}
	if err := os.Rename(tmp, h.path); err != nil {
		log.Printf("relay: rename into %s failed: %v", h.path, err)
	}
}

// load reads the persisted queue into the hub. A missing file is not an error.
func (h *Hub) load() error {
	data, err := os.ReadFile(h.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state persistedHub
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	h.nextID = state.NextID
	if state.Queue != nil {
		h.queue = state.Queue
	}
	return nil
}

// register attaches a client and immediately flushes any queued envelopes that
// accumulated while it was offline.
func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.conns[c.routeKey] = c
	pending := h.queue[c.routeKey]
	if len(pending) > 0 {
		delete(h.queue, c.routeKey)
		h.persistLocked() // drained this recipient's queue
	}
	h.mu.Unlock()

	log.Printf("client connected: %s (%d queued)", c.routeKey, len(pending))
	for _, env := range pending {
		c.send(RelayMessage{Kind: "deliver", Envelope: &env})
	}
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	if h.conns[c.routeKey] == c {
		delete(h.conns, c.routeKey)
	}
	h.mu.Unlock()
	log.Printf("client disconnected: %s", c.routeKey)
}

// route delivers an envelope to a connected recipient, or queues it for later.
// The relay assigns the envelope ID here; it is the single source of truth for
// message identity. It never looks at Ciphertext.
func (h *Hub) route(env Envelope) string {
	key := routeKey(env.RecipientID, env.RecipientDevice)

	h.mu.Lock()
	h.nextID++
	env.ID = "env-" + itoa(int(h.nextID))
	target := h.conns[key]
	if target == nil {
		h.queue[key] = append(h.queue[key], env)
	}
	// Persist so both the queue (offline case) and nextID (envelope-id
	// uniqueness) survive a restart.
	h.persistLocked()
	h.mu.Unlock()

	if target != nil {
		target.send(RelayMessage{Kind: "deliver", Envelope: &env})
		log.Printf("routed %s -> %s (live)", env.ID, key)
	} else {
		log.Printf("queued %s -> %s (offline)", env.ID, key)
	}
	return env.ID
}

// forwardStatus delivers a delivery/read status update to the original sender
// if they are currently connected. Status is best-effort: unlike envelopes it
// is not queued for offline senders (the client re-derives it on reconnect via
// re-delivery / re-reads in a fuller implementation).
func (h *Hub) forwardStatus(userID string, deviceID int, msg RelayMessage) {
	key := routeKey(userID, deviceID)
	h.mu.Lock()
	target := h.conns[key]
	h.mu.Unlock()
	if target != nil {
		target.send(msg)
		log.Printf("status %s (%s) -> %s", msg.EnvelopeID, msg.Status, key)
	}
}
