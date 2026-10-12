package main

import (
	"strings"
	"testing"
	"time"
)

// Validates the presigner against AWS's official SigV4 query-string example
// ("GET Object" presigned URL) from the S3 docs, so we know the signature math
// is correct before it ever talks to R2.
//
//   https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
func TestPresign_AWSOfficialVector(t *testing.T) {
	cfg := signerConfig{
		accessKeyID:     "AKIAIOSFODNN7EXAMPLE",
		secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		region:          "us-east-1",
		service:         "s3",
		host:            "examplebucket.s3.amazonaws.com",
	}
	when := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)

	url := presign(cfg, "GET", "/test.txt", 86400*time.Second, when)

	const wantSig = "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
	if !strings.Contains(url, "X-Amz-Signature="+wantSig) {
		t.Fatalf("signature mismatch.\n got: %s\nwant X-Amz-Signature=%s", url, wantSig)
	}
	// Sanity on the other required query parts.
	for _, part := range []string{
		"X-Amz-Algorithm=AWS4-HMAC-SHA256",
		"X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request",
		"X-Amz-Date=20130524T000000Z",
		"X-Amz-Expires=86400",
		"X-Amz-SignedHeaders=host",
	} {
		if !strings.Contains(url, part) {
			t.Errorf("presigned URL missing %q\n got: %s", part, url)
		}
	}
}

// A PUT presign for an R2-style path-style endpoint produces a well-formed URL.
func TestPresign_R2PutShape(t *testing.T) {
	cfg := signerConfig{
		accessKeyID:     "test-key",
		secretAccessKey: "test-secret",
		region:          "auto",
		service:         "s3",
		host:            "acct123.r2.cloudflarestorage.com",
	}
	url := presign(cfg, "PUT", "/hwfa-media/obj-abc", 15*time.Minute, time.Now())
	if !strings.HasPrefix(url, "https://acct123.r2.cloudflarestorage.com/hwfa-media/obj-abc?") {
		t.Fatalf("unexpected URL prefix: %s", url)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Fatalf("missing signature: %s", url)
	}
}

// A custom scheme/host (for an S3-compatible store set via MEDIA_S3_ENDPOINT)
// is honored; the default stays https. The signature is over the host only, so
// the scheme choice must not change it — the two signatures below must match.
func TestPresign_SchemeOverride(t *testing.T) {
	base := signerConfig{
		accessKeyID:     "test-key",
		secretAccessKey: "test-secret",
		region:          "auto",
		service:         "s3",
		host:            "localhost:9099",
	}
	when := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)

	https := presign(base, "PUT", "/hwfa-media/obj", 15*time.Minute, when)
	if !strings.HasPrefix(https, "https://localhost:9099/hwfa-media/obj?") {
		t.Fatalf("empty scheme should default to https, got: %s", https)
	}

	httpCfg := base
	httpCfg.scheme = "http"
	httpURL := presign(httpCfg, "PUT", "/hwfa-media/obj", 15*time.Minute, when)
	if !strings.HasPrefix(httpURL, "http://localhost:9099/hwfa-media/obj?") {
		t.Fatalf("scheme=http should be honored, got: %s", httpURL)
	}

	sig := func(u string) string { _, s, _ := strings.Cut(u, "X-Amz-Signature="); return s }
	if sig(https) != sig(httpURL) {
		t.Fatalf("scheme must not affect the signature:\n https=%s\n http =%s", https, httpURL)
	}
}
