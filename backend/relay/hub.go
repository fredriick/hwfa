package main

import (
	"log"
	"sync"
)

// Hub is the in-memory routing core: it tracks which recipient devices are
// currently connected and holds a store-and-forward queue for offline ones.
//
// For the Phase 0 spike this queue lives in memory. In production it is backed
// by the Postgres `message_queue` table (ciphertext-only, 30-day TTL) so
// delivery survives relay restarts and horizontal scaling.
type Hub struct {
	mu     sync.Mutex
	conns  map[string]*Client   // routeKey -> live connection
	queue  map[string][]Envelope // routeKey -> undelivered envelopes
	nextID uint64
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[string]*Client),
		queue: make(map[string][]Envelope),
	}
}

// register attaches a client and immediately flushes any queued envelopes that
// accumulated while it was offline.
func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.conns[c.routeKey] = c
	pending := h.queue[c.routeKey]
	delete(h.queue, c.routeKey)
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
	h.mu.Unlock()

	if target != nil {
		target.send(RelayMessage{Kind: "deliver", Envelope: &env})
		log.Printf("routed %s -> %s (live)", env.ID, key)
	} else {
		log.Printf("queued %s -> %s (offline)", env.ID, key)
	}
	return env.ID
}
