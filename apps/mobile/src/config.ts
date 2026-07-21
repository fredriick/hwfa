/**
 * Backend endpoints for the mobile client.
 *
 * On the Android emulator, the host machine is reachable at 10.0.2.2 (the
 * emulator's alias for the host loopback) — NOT localhost, which points at the
 * emulator itself. iOS simulators can use localhost directly. Override both via
 * env at build time for real devices / staging / production.
 */
import { Platform } from "react-native";

const HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

/** Relay + Discovery ports, matching backend/relay and backend/discovery. */
const RELAY_PORT = 8090;
const DISCOVERY_PORT = 8091;

export const config = {
  discoveryUrl: `http://${HOST}:${DISCOVERY_PORT}`,
  relayUrl: `ws://${HOST}:${RELAY_PORT}/v1/relay`,
} as const;
