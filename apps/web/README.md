# web — React web client (Phase 5, post-launch)

**Not yet scaffolded.** The web client is a *linked device*, not an independent
account (mirrors WhatsApp Web / Telegram Web). It reuses `@hwfa/crypto`,
`@hwfa/models`, and `@hwfa/ui` from the monorepo, with libsignal compiled to
WebAssembly and IndexedDB for the local encrypted cache.
