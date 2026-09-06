package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The TextBee gateway must POST to /gateway/send-sms with the API key header and
// a body carrying the recipient, message, and device id.
func TestTextBeeGatewaySendsExpectedRequest(t *testing.T) {
	var gotPath, gotKey, gotContentType string
	var gotBody textBeeRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("x-api-key")
		gotContentType = r.Header.Get("Content-Type")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"success":true}}`))
	}))
	defer srv.Close()

	g := newTextBeeGateway("secret-key", "device-123")
	g.baseURL = srv.URL // point the client at the stub, not production.

	if err := g.SendOTP(context.Background(), "+2348011112222", "654321"); err != nil {
		t.Fatalf("SendOTP: %v", err)
	}

	if gotPath != "/gateway/send-sms" {
		t.Errorf("path = %q, want /gateway/send-sms", gotPath)
	}
	if gotKey != "secret-key" {
		t.Errorf("x-api-key = %q, want secret-key", gotKey)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotContentType)
	}
	if len(gotBody.Recipients) != 1 || gotBody.Recipients[0] != "+2348011112222" {
		t.Errorf("recipients = %v, want [+2348011112222]", gotBody.Recipients)
	}
	if gotBody.DeviceID != "device-123" {
		t.Errorf("deviceId = %q, want device-123", gotBody.DeviceID)
	}
	if gotBody.Message == "" {
		t.Error("message is empty")
	}
}

// A non-2xx response from the gateway must surface as an error (so the caller
// logs a failed delivery rather than assuming success).
func TestTextBeeGatewayReturnsErrorOnFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	g := newTextBeeGateway("bad-key", "device-123")
	g.baseURL = srv.URL

	if err := g.SendOTP(context.Background(), "+2348011112222", "654321"); err == nil {
		t.Fatal("expected an error for a 401 response, got nil")
	}
}

// With neither env var set, the factory returns the no-op log gateway; with both
// set, the TextBee gateway.
func TestGatewayFromEnv(t *testing.T) {
	t.Setenv("TEXTBEE_API_KEY", "")
	t.Setenv("TEXTBEE_DEVICE_ID", "")
	if _, ok := gatewayFromEnv().(logGateway); !ok {
		t.Error("unconfigured env should yield the log gateway")
	}

	t.Setenv("TEXTBEE_API_KEY", "k")
	t.Setenv("TEXTBEE_DEVICE_ID", "d")
	if _, ok := gatewayFromEnv().(*textBeeGateway); !ok {
		t.Error("configured env should yield the TextBee gateway")
	}
}
