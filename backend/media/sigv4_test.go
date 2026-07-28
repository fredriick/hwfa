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
