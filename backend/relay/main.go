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
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Phase 0: allow all origins. Production pins the app origins + uses JWT.
	CheckOrigin: func(r *http.Request) bool { return true },
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

	// /v1/relay?userId=<uuid>&deviceId=<n>
	// Phase 1 replaces the query params with a short-lived JWT (silent refresh).
	mux.HandleFunc("/v1/relay", func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("userId")
		deviceID, err := strconv.Atoi(r.URL.Query().Get("deviceId"))
		if userID == "" || err != nil {
			http.Error(w, "missing userId or deviceId", http.StatusBadRequest)
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
