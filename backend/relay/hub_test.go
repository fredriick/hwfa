package main

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
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
	if h2.queue[routeKey("bob", 1)][0].Env.ID != id {
		t.Fatalf("restored envelope id mismatch: %s != %s", h2.queue[routeKey("bob", 1)][0].Env.ID, id)
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

// A queued envelope older than the TTL is not delivered when the recipient
// connects — it's pruned on flush.
func TestHub_ExpiredQueueEntryPruned(t *testing.T) {
	h := NewHub()
	h.route(sampleEnvelope("bob")) // bob offline → queued now
	key := routeKey("bob", 1)

	// Backdate the queued entry past the TTL.
	h.mu.Lock()
	h.queue[key][0].EnqueuedAt = nowMillis() - queueTTL.Milliseconds() - 1000
	h.mu.Unlock()

	c := &Client{hub: h, routeKey: key, userID: "bob", deviceID: 1, out: make(chan RelayMessage, 4)}
	h.register(c)

	select {
	case msg := <-c.out:
		t.Fatalf("expired message should not be delivered, got %+v", msg)
	default:
		// nothing delivered — correct
	}
}

// A recipient's queue is capped: once it exceeds the cap, only the newest are
// retained.
func TestHub_QueueCappedPerRecipient(t *testing.T) {
	h := NewHub()
	for i := 0; i < maxQueuePerRecipient+50; i++ {
		h.route(sampleEnvelope("bob")) // bob offline → all queued
	}
	if got := len(h.queue[routeKey("bob", 1)]); got != maxQueuePerRecipient {
		t.Fatalf("queue not capped: got %d, want %d", got, maxQueuePerRecipient)
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

type fakePusher struct {
	mu     sync.Mutex
	tokens []string
}

func (f *fakePusher) Push(token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens = append(f.tokens, token)
	return nil
}

func (f *fakePusher) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.tokens)
}

// A message queued for a registered-but-offline recipient triggers exactly one
// content-free push to that device's token.
func TestHub_OfflineQueueTriggersPush(t *testing.T) {
	h := NewHub()
	fp := &fakePusher{}
	h.attachPusher(fp)
	h.registerPushToken(routeKey("bob", 1), "bob-fcm-token")

	h.route(sampleEnvelope("bob")) // bob is offline

	// Push fires in a goroutine; give it a moment.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && fp.count() == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if got := fp.count(); got != 1 {
		t.Fatalf("expected 1 push, got %d", got)
	}
	if fp.tokens[0] != "bob-fcm-token" {
		t.Fatalf("pushed wrong token: %s", fp.tokens[0])
	}
}

// A message to a recipient with no registered token must not attempt a push.
func TestHub_NoTokenNoPush(t *testing.T) {
	h := NewHub()
	fp := &fakePusher{}
	h.attachPusher(fp)

	h.route(sampleEnvelope("carol")) // offline, no token registered

	time.Sleep(200 * time.Millisecond)
	if fp.count() != 0 {
		t.Fatalf("expected no push, got %d", fp.count())
	}
}
