// Command relay is Hwfa's WebSocket message-routing service.
//
// It accepts authenticated client connections, routes encrypted envelopes by
// recipient user + device, and queues messages for offline recipients
// (store-and-forward). It NEVER decrypts or inspects ciphertext — only envelope
// metadata (to / from / timestamp / size).
//
// Phase 0 scope: query-param identity instead of JWT, in-memory queue instead
// of Postgres. The wire protocol and routing semantics are the real thing.
package main

import (
	"log"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"hwfa/authtoken"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// CheckOrigin is set in main() from the environment (see originAllowed).
}

// originAllowed decides whether a WebSocket upgrade may proceed. In dev, any
// origin is fine. In production, native mobile clients (which send no Origin
// header) are allowed, and any browser Origin must be in the allowlist
// (HWFA_ALLOWED_ORIGINS) — so a hostile web page can't open relay sockets.
func originAllowed(origin string, prod bool, allowed []string) bool {
	if !prod {
		return true
	}
	if origin == "" {
		return true // native app: no Origin header
	}
	return slices.Contains(allowed, origin)
}

func allowedOriginsFromEnv() []string {
	raw := strings.Split(os.Getenv("HWFA_ALLOWED_ORIGINS"), ",")
	out := make([]string, 0, len(raw))
	for _, o := range raw {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func nowMillis() int64 { return time.Now().UnixMilli() }

func main() {
	addr := os.Getenv("RELAY_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	// RELAY_DATA=<file> persists the offline message queue across restarts;
	// unset keeps it in-memory (as headless tests expect).
	var hub *Hub
	if dataPath := os.Getenv("RELAY_DATA"); dataPath != "" {
		hub = NewPersistentHub(dataPath)
	} else {
		hub = NewHub()
	}

	// FCM_SERVICE_ACCOUNT_JSON=<file> enables offline push wake-ups; unset keeps
	// push disabled (dev/tests). The key stays server-side only.
	if saPath := os.Getenv("FCM_SERVICE_ACCOUNT_JSON"); saPath != "" {
		pusher, err := newFCMPusher(saPath)
		if err != nil {
			log.Fatalf("push init failed: %v", err)
		}
		hub.attachPusher(pusher)
		log.Printf("push enabled (FCM project via %s)", saPath)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	secret := authtoken.SecretFromEnv()

	prod := authtoken.IsProduction()
	allowedOrigins := allowedOriginsFromEnv()
	upgrader.CheckOrigin = func(r *http.Request) bool {
		return originAllowed(r.Header.Get("Origin"), prod, allowedOrigins)
	}

	// /v1/relay?token=<signed>&deviceId=<n>
	// The identity comes from the verified token — NOT a client-supplied userId —
	// so a client can only connect as (and send/receive as) itself.
	mux.HandleFunc("/v1/relay", func(w http.ResponseWriter, r *http.Request) {
		deviceID, err := strconv.Atoi(r.URL.Query().Get("deviceId"))
		if err != nil {
			http.Error(w, "missing deviceId", http.StatusBadRequest)
			return
		}
		userID, ok := authtoken.Verify(secret, r.URL.Query().Get("token"))
		if !ok {
			http.Error(w, "missing or invalid token", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("upgrade failed: %v", err)
			return
		}

		client := newClient(hub, conn, userID, deviceID)
		hub.register(client)
		go client.writePump()
		client.readPump() // blocks until the connection closes
	})

	log.Printf("Hwfa relay listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
