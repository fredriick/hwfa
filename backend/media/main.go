// Command media issues presigned Cloudflare R2 URLs for encrypted attachments.
//
// The client encrypts media with a random AES-256 key (see packages/client
// media/), uploads the ciphertext straight to R2 via a presigned PUT, and puts
// the key + object locator inside the E2EE message body. Peers fetch the
// ciphertext via a presigned GET and decrypt locally. This service only signs
// URLs — it never sees plaintext, key material, or the bytes themselves.
//
// Config (env): R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// When unset, the endpoints return 503 so the service still starts (and tests
// run) without credentials.
package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"
)

const (
	uploadExpiry   = 15 * time.Minute
	downloadExpiry = 60 * time.Minute
)

// locatorPattern guards the download path against traversal / injection: object
// keys are opaque ids we mint, so only these characters are ever valid.
var locatorPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type server struct {
	cfg    signerConfig
	bucket string
	ready  bool // false when R2 is not configured
}

func newServer() *server {
	accountID := os.Getenv("R2_ACCOUNT_ID")
	bucket := os.Getenv("R2_BUCKET")
	access := os.Getenv("R2_ACCESS_KEY_ID")
	secret := os.Getenv("R2_SECRET_ACCESS_KEY")
	ready := accountID != "" && bucket != "" && access != "" && secret != ""
	return &server{
		cfg: signerConfig{
			accessKeyID:     access,
			secretAccessKey: secret,
			region:          "auto", // R2 requires "auto"
			service:         "s3",
			host:            accountID + ".r2.cloudflarestorage.com",
		},
		bucket: bucket,
		ready:  ready,
	}
}

func (s *server) objectPath(key string) string {
	return "/" + s.bucket + "/" + key
}

type uploadURLResponse struct {
	URL       string `json:"url"`
	Locator   string `json:"locator"`
	ExpiresIn int    `json:"expiresIn"`
}

// POST /v1/media/upload-url — mint an object key + a presigned PUT URL.
func (s *server) uploadURL(w http.ResponseWriter, _ *http.Request) {
	if !s.ready {
		http.Error(w, `{"error":"media storage not configured"}`, http.StatusServiceUnavailable)
		return
	}
	key := newObjectKey()
	url := presign(s.cfg, http.MethodPut, s.objectPath(key), uploadExpiry, time.Now())
	writeJSON(w, uploadURLResponse{URL: url, Locator: key, ExpiresIn: int(uploadExpiry.Seconds())})
}

type downloadURLResponse struct {
	URL       string `json:"url"`
	ExpiresIn int    `json:"expiresIn"`
}

// GET /v1/media/download-url?locator=<key> — presign a GET for an object.
func (s *server) downloadURL(w http.ResponseWriter, r *http.Request) {
	if !s.ready {
		http.Error(w, `{"error":"media storage not configured"}`, http.StatusServiceUnavailable)
		return
	}
	locator := r.URL.Query().Get("locator")
	if !locatorPattern.MatchString(locator) {
		http.Error(w, `{"error":"invalid locator"}`, http.StatusBadRequest)
		return
	}
	url := presign(s.cfg, http.MethodGet, s.objectPath(locator), downloadExpiry, time.Now())
	writeJSON(w, downloadURLResponse{URL: url, ExpiresIn: int(downloadExpiry.Seconds())})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// newObjectKey returns a random, URL-safe object id (128-bit).
func newObjectKey() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("media: cannot read random object key: " + err.Error())
	}
	return fmt.Sprintf("%x", b)
}

func main() {
	addr := os.Getenv("MEDIA_ADDR")
	if addr == "" {
		addr = ":8092"
	}
	s := newServer()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /v1/media/upload-url", s.uploadURL)
	mux.HandleFunc("GET /v1/media/download-url", s.downloadURL)

	if s.ready {
		log.Printf("Hwfa media listening on %s (R2 bucket %q)", addr, s.bucket)
	} else {
		log.Printf("Hwfa media listening on %s (R2 NOT configured — endpoints return 503)", addr)
	}
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
