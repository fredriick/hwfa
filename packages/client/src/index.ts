/**
 * @hwfa/client — the portable client core.
 *
 * Everything here runs anywhere `fetch` + `WebSocket` exist (Node, React Native,
 * browser). It carries NO dependency on libsignal: all crypto is behind
 * `CryptoProvider`. For the Node/libsignal implementation import
 * `@hwfa/client/node`; React Native supplies its own native provider.
 */
export { HwfaClient, hashPhone } from "./client.js";
export type {
  HwfaClientOptions,
  IncomingText,
  TextHandler,
} from "./client.js";
export { DiscoveryClient, DiscoveryError } from "./discovery.js";
export type { ContactMatch, FetchLike } from "./discovery.js";
export { RelayConnection } from "./relay.js";
export type {
  WebSocketCtor,
  WebSocketLike,
  DeliverHandler,
  AckHandler,
  StatusHandler,
  RelayHandlers,
} from "./relay.js";
export type {
  CryptoProvider,
  GenerateRegistrationOptions,
  LocalRegistration,
  EncryptedMessage,
  OneTimePreKeyPublic,
  PublishedKeyBundle,
} from "./crypto-provider.js";
export {
  HeuristicScamDetector,
  heuristicScamDetector,
  HEURISTIC_MODEL_VERSION,
} from "./scam/detector.js";
export type { ScamDetector } from "./scam/detector.js";
