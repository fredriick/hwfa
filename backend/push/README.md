# push — Go service (Phase 1)

APNs / FCM notification triggers. **Not yet implemented** — scaffolded for
Phase 1.

Critical invariant (spec §Push Notifications): push payloads **never** contain
message content. They carry only `{ type, sender_id, thread_id }`. The client
wakes, connects to the relay, fetches + decrypts queued messages, and builds
the notification text on-device.
