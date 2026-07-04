# media — Go service (Phase 1)

Signed upload/download URL generation for Cloudflare R2. **Not yet
implemented** — scaffolded for Phase 1.

```
POST /v1/media/upload-url     returns signed R2 upload URL
GET  /v1/media/download-url   returns signed R2 download URL
```

The client encrypts media with a random AES-256 key before upload; that key
travels inside the E2EE message body (`MediaReference` in
`packages/models/src/message.ts`). The server stores only ciphertext blobs and
cannot decrypt them even with direct R2 access.
