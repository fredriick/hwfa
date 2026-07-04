# discovery — Go service (Phase 1)

User lookup, key directory, and groups. **Not yet implemented** — scaffolded
here so Phase 1 has a home.

Planned endpoints (see spec §Discovery API):

```
POST /v1/accounts/register         register phone, upload initial key bundle
POST /v1/accounts/verify           verify OTP
GET  /v1/keys/{userId}             fetch public key bundle for a user
PUT  /v1/keys/upload               replenish one-time prekey pool
GET  /v1/contacts/intersect        privacy-preserving contact discovery
POST /v1/groups                    create group
PUT  /v1/groups/{groupId}/members  add or remove members
```

The key bundle it serves is exactly the `PublishedKeyBundle` shape already
defined in `packages/crypto/src/identity.ts`, and the storage schema is the
`accounts` / `key_bundles` / `one_time_prekeys` tables in the spec.
