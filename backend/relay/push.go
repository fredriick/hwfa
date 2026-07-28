package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Pusher wakes a device by its FCM token. Kept as an interface so the hub can be
// tested with a fake and run with pushes disabled (nil) when no credentials are
// configured.
type Pusher interface {
	// Push sends a content-free wake notification to one device token.
	Push(token string) error
}

// fcmPusher sends via the FCM HTTP v1 API using only the standard library: it
// builds an RS256 JWT from the service-account key, exchanges it for an OAuth2
// access token, and posts a data-only (content-free) message. No Firebase Admin
// SDK dependency — deliberate, to keep the backend dependency-light.
type fcmPusher struct {
	projectID   string
	clientEmail string
	privateKey  *rsa.PrivateKey
	httpc       *http.Client

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

// serviceAccount is the subset of a Firebase service-account JSON we need.
type serviceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
}

// newFCMPusher builds a Pusher from a service-account JSON file. Returns
// (nil, nil) when path is empty so push simply stays disabled in dev/tests.
func newFCMPusher(path string) (*fcmPusher, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read service account: %w", err)
	}
	var sa serviceAccount
	if err := json.Unmarshal(data, &sa); err != nil {
		return nil, fmt.Errorf("parse service account: %w", err)
	}
	key, err := parseRSAPrivateKey(sa.PrivateKey)
	if err != nil {
		return nil, err
	}
	return &fcmPusher{
		projectID:   sa.ProjectID,
		clientEmail: sa.ClientEmail,
		privateKey:  key,
		httpc:       &http.Client{Timeout: 10 * time.Second},
	}, nil
}

func parseRSAPrivateKey(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("no PEM block in private key")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("service-account key is not RSA")
	}
	return key, nil
}

// Push sends a data-only FCM message (no notification title/body) so the payload
// is content-free — it only wakes the app, which then syncs over the relay.
func (p *fcmPusher) Push(token string) error {
	access, err := p.token()
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]any{
		"message": map[string]any{
			"token": token,
			"data":  map[string]string{"type": "wake"},
			"android": map[string]any{
				"priority": "high",
			},
		},
	})
	endpoint := "https://fcm.googleapis.com/v1/projects/" + p.projectID + "/messages:send"
	req, _ := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fcm send %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

// token returns a cached OAuth2 access token, refreshing it via the JWT-bearer
// grant when expired.
func (p *fcmPusher) token() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.accessToken != "" && time.Now().Before(p.tokenExpiry) {
		return p.accessToken, nil
	}

	jwt, err := p.signedJWT()
	if err != nil {
		return "", err
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {jwt},
	}
	resp, err := p.httpc.PostForm("https://oauth2.googleapis.com/token", form)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("oauth token exchange failed: %s", out.Error)
	}
	p.accessToken = out.AccessToken
	p.tokenExpiry = time.Now().Add(time.Duration(out.ExpiresIn-60) * time.Second)
	return p.accessToken, nil
}

// signedJWT builds and RS256-signs the service-account assertion for the FCM
// messaging scope.
func (p *fcmPusher) signedJWT() (string, error) {
	now := time.Now()
	header := b64url([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"iss":   p.clientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   "https://oauth2.googleapis.com/token",
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	signingInput := header + "." + b64url(claims)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, p.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + b64url(sig), nil
}

func b64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
