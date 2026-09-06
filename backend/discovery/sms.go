package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// SMSGateway sends the one-time password to a phone number. Registration calls
// it after minting the OTP; the raw number never leaves this call (the store
// keeps only a salted hash).
type SMSGateway interface {
	// SendOTP delivers `code` to `phone` (E.164). A nil error means accepted for
	// delivery, not that it was received.
	SendOTP(ctx context.Context, phone, code string) error
}

// logGateway is the default when no provider is configured: it does not send an
// SMS, matching the Phase-1 spike behaviour (the OTP is already logged, and with
// DISCOVERY_DEV=1 echoed to headless tests). Never rely on this in production.
type logGateway struct{}

func (logGateway) SendOTP(_ context.Context, phone, _ string) error {
	log.Printf("discovery: SMS gateway not configured — OTP for %s not sent", phone)
	return nil
}

// textBeeGateway sends via TextBee.dev, which turns an Android phone into an SMS
// gateway: POST the message to the account's device with an x-api-key header.
// See https://textbee.dev — chosen over Termii / Africa's Talking for Phase 1.
type textBeeGateway struct {
	apiKey   string
	deviceID string
	baseURL  string // overridable for tests; defaults to TextBee production.
	client   *http.Client
	// message renders the SMS body for a code; overridable, defaults to a
	// standard verification line.
	message func(code string) string
}

const textBeeBaseURL = "https://api.textbee.dev/api/v1"

func newTextBeeGateway(apiKey, deviceID string) *textBeeGateway {
	return &textBeeGateway{
		apiKey:   apiKey,
		deviceID: deviceID,
		baseURL:  textBeeBaseURL,
		client:   &http.Client{Timeout: 15 * time.Second},
		message: func(code string) string {
			return fmt.Sprintf("Your Hwfa verification code is %s", code)
		},
	}
}

// textBeeRequest is the send-sms body. `deviceId` is optional per the API (it
// falls back to the account default), but we always set it to be explicit.
type textBeeRequest struct {
	Recipients []string `json:"recipients"`
	Message    string   `json:"message"`
	DeviceID   string   `json:"deviceId,omitempty"`
}

func (g *textBeeGateway) SendOTP(ctx context.Context, phone, code string) error {
	body, err := json.Marshal(textBeeRequest{
		Recipients: []string{phone},
		Message:    g.message(code),
		DeviceID:   g.deviceID,
	})
	if err != nil {
		return fmt.Errorf("marshal sms request: %w", err)
	}

	url := g.baseURL + "/gateway/send-sms"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build sms request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", g.apiKey)

	resp, err := g.client.Do(req)
	if err != nil {
		return fmt.Errorf("send sms: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Cap the error body so a huge/hostile response can't blow up the log.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("sms gateway returned %d: %s", resp.StatusCode, bytes.TrimSpace(snippet))
	}
	return nil
}

// gatewayFromEnv returns a TextBee gateway when TEXTBEE_API_KEY and
// TEXTBEE_DEVICE_ID are both set, otherwise the no-op log gateway. This keeps
// dev and headless tests working with no external dependency, and turns on real
// delivery purely via configuration.
func gatewayFromEnv() SMSGateway {
	apiKey := os.Getenv("TEXTBEE_API_KEY")
	deviceID := os.Getenv("TEXTBEE_DEVICE_ID")
	if apiKey != "" && deviceID != "" {
		log.Printf("discovery: SMS via TextBee device %s", deviceID)
		return newTextBeeGateway(apiKey, deviceID)
	}
	return logGateway{}
}
