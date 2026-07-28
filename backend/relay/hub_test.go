package main

import (
	"path/filepath"
	"testing"
)

func sampleEnvelope(to string) Envelope {
	return Envelope{
		RecipientID:     to,
		RecipientDevice: 1,
		SenderID:        "sender",
		SenderDevice:    1,
		Type:            2,
		Ciphertext:      "opaque",
		Timestamp:       123,
	}
}

// A message queued for an offline recipient must survive a relay restart and be
// delivered when that recipient later connects.
func TestPersistentHub_QueueSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.json")

	// First boot: no connection for "bob", so the message is queued.
	h1 := NewPersistentHub(path)
	id := h1.route(sampleEnvelope("bob"))
	if id == "" {
		t.Fatal("route returned empty id")
	}

	// Second boot: the queue reloads from disk.
	h2 := NewPersistentHub(path)
	if got := len(h2.queue[routeKey("bob", 1)]); got != 1 {
		t.Fatalf("queued message not restored: got %d, want 1", got)
	}
	if h2.queue[routeKey("bob", 1)][0].ID != id {
		t.Fatalf("restored envelope id mismatch: %s != %s", h2.queue[routeKey("bob", 1)][0].ID, id)
	}

	// nextID persisted, so a new message gets a fresh (non-colliding) id.
	id2 := h2.route(sampleEnvelope("carol"))
	if id2 == id {
		t.Fatalf("envelope id reused across restart: %s", id2)
	}
}

// Connecting a recipient drains its queue, and the drain persists (a later
// restart must not re-deliver already-flushed messages).
func TestPersistentHub_FlushPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.json")

	h1 := NewPersistentHub(path)
	h1.route(sampleEnvelope("bob"))

	// A minimal client whose send() is a no-op is enough to trigger the flush.
	c := &Client{hub: h1, routeKey: routeKey("bob", 1), userID: "bob", deviceID: 1, out: make(chan RelayMessage, 4)}
	h1.register(c)

	h2 := NewPersistentHub(path)
	if got := len(h2.queue[routeKey("bob", 1)]); got != 0 {
		t.Fatalf("flushed queue reappeared after restart: got %d, want 0", got)
	}
}

// No path => no disk writes, pure in-memory (headless tests rely on this).
func TestInMemoryHub_NoPath(t *testing.T) {
	h := NewHub()
	h.route(sampleEnvelope("bob"))
	if h.path != "" {
		t.Fatal("in-memory hub should have no path")
	}
}
