# media — Go service (Phase 1)

Presigned upload/download URL generation for Cloudflare R2. **Implemented**
(stdlib-only AWS SigV4; no S3 SDK dependency).

```
POST /v1/media/upload-url                 -> { url, locator, expiresIn }  presigned R2 PUT
GET  /v1/media/download-url?locator=<key> -> { url, expiresIn }           presigned R2 GET
GET  /healthz
```

The client encrypts media with a random AES-256 key before upload; that key
travels inside the E2EE message body (`MediaReference`, `packages/client`
media/). The server stores only ciphertext blobs and cannot decrypt them even
with direct R2 access. This service never proxies bytes — it only signs URLs, so
the client PUTs/GETs the object directly against R2.

## Config (env)

| Var                    | Notes                                        |
| ---------------------- | -------------------------------------------- |
| `R2_ACCOUNT_ID`        | Cloudflare account id (used for the R2 host) |
| `R2_BUCKET`            | e.g. `hwfa-media`                            |
| `R2_ACCESS_KEY_ID`     | R2 API token access key id                   |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret                          |
| `MEDIA_ADDR`           | listen address (default `:8092`)             |

When R2 vars are unset the service still starts, but the two endpoints return
`503` — so it runs in dev/CI without credentials. Put real values in the
gitignored `.env.local` (see `.env.example`).

## Run

```
R2_ACCOUNT_ID=... R2_BUCKET=hwfa-media R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... go run .
```

The SigV4 signer is verified against AWS's official presigned-URL test vector
(`sigv4_test.go`).
