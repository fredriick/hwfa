package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
	"time"
)

// AWS Signature Version 4 query-string ("presigned URL") signing, implemented
// with the standard library only. Cloudflare R2 is S3-compatible and accepts
// SigV4 with region "auto". A presigned URL lets the client PUT/GET the object
// directly against R2, so this service never proxies media bytes — it only signs.

// signerConfig holds the credentials + target for presigning.
type signerConfig struct {
	accessKeyID     string
	secretAccessKey string
	region          string // R2: "auto"
	service         string // "s3"
	host            string // "<account-id>.r2.cloudflarestorage.com"
}

// presign builds a presigned URL for `method` on `path` (e.g. "/bucket/key"),
// valid for `expires`. `now` is injectable for deterministic tests.
func presign(cfg signerConfig, method, path string, expires time.Duration, now time.Time) string {
	amzDate := now.UTC().Format("20060102T150405Z")
	dateStamp := now.UTC().Format("20060102")
	credentialScope := dateStamp + "/" + cfg.region + "/" + cfg.service + "/aws4_request"

	// Canonical query string (keys sorted; values RFC3986-encoded, "/" encoded).
	params := map[string]string{
		"X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
		"X-Amz-Credential":    cfg.accessKeyID + "/" + credentialScope,
		"X-Amz-Date":          amzDate,
		"X-Amz-Expires":       strconv.Itoa(int(expires.Seconds())),
		"X-Amz-SignedHeaders": "host",
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var qs strings.Builder
	for i, k := range keys {
		if i > 0 {
			qs.WriteByte('&')
		}
		qs.WriteString(awsURIEncode(k, true))
		qs.WriteByte('=')
		qs.WriteString(awsURIEncode(params[k], true))
	}
	canonicalQuery := qs.String()

	canonicalURI := awsURIEncodePath(path)
	canonicalHeaders := "host:" + cfg.host + "\n"
	signedHeaders := "host"
	payloadHash := "UNSIGNED-PAYLOAD"

	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		hexSHA256(canonicalRequest),
	}, "\n")

	signingKey := deriveSigningKey(cfg.secretAccessKey, dateStamp, cfg.region, cfg.service)
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	return "https://" + cfg.host + canonicalURI + "?" + canonicalQuery + "&X-Amz-Signature=" + signature
}

func deriveSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func hexSHA256(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

// awsURIEncode encodes per AWS SigV4 rules: unreserved chars pass through; "/"
// is encoded only when encodeSlash is true (query values yes, path no).
func awsURIEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return b.String()
}

// awsURIEncodePath encodes a path, preserving the "/" separators.
func awsURIEncodePath(path string) string {
	return awsURIEncode(path, false)
}
