// Command discovery is Hwfa's user-lookup and public-key-directory service.
//
// It is the "phone book": clients register a phone number (verified by OTP) and
// upload their PUBLIC key material; peers fetch that material to start an E2EE
// session. It handles no plaintext and no private keys. Phone numbers are
// stored only as salted hashes, and contact discovery is a hash intersection so
// the server never learns which unregistered numbers a client queried.
//
// Phase 1 scope: in-memory store instead of Postgres, opaque bearer tokens
// instead of JWTs, and a stubbed SMS gateway (OTP is logged; with
// DISCOVERY_DEV=1 it is echoed in the register response for headless tests).
// The API surface and privacy properties are the real thing.
package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	addr := os.Getenv("DISCOVERY_ADDR")
	if addr == "" {
		addr = ":8091"
	}

	// DISCOVERY_DATA=<file> persists registrations (and the salt) across restarts;
	// unset keeps the store purely in-memory (as headless tests expect).
	var store *Store
	if dataPath := os.Getenv("DISCOVERY_DATA"); dataPath != "" {
		store = NewPersistentStore(dataPath)
	} else {
		store = NewStore()
	}

	h := &handlers{
		store:  store,
		devOTP: os.Getenv("DISCOVERY_DEV") == "1",
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("POST /v1/accounts/register", h.register)
	mux.HandleFunc("POST /v1/accounts/verify", h.verify)
	mux.HandleFunc("GET /v1/keys/{userId}", h.fetchKeys)
	mux.HandleFunc("PUT /v1/keys/upload", h.uploadKeys)
	mux.HandleFunc("GET /v1/contacts/salt", h.salt)
	mux.HandleFunc("POST /v1/contacts/intersect", h.intersect)

	if h.devOTP {
		log.Printf("discovery: DEV mode — OTP echoed in register responses")
	}
	log.Printf("Hwfa discovery listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
