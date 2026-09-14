/**
 * Backend endpoints for the mobile client.
 *
 * Where the host machine's backend lives depends on how you're running the app.
 * Set DEV_HOST below for your setup (leave it null to use the per-platform
 * default, which targets the Android emulator):
 *
 *   • Android emulator (default): 10.0.2.2 is the emulator's alias for the host
 *     loopback — NOT localhost, which points at the emulator itself.
 *   • iOS simulator: localhost works directly.
 *   • Real device over USB: run `adb reverse` for each port so the device
 *     tunnels to the host, then set DEV_HOST = 'localhost':
 *         adb reverse tcp:8091 tcp:8091   # discovery
 *         adb reverse tcp:8190 tcp:8190   # relay
 *         adb reverse tcp:8092 tcp:8092   # media
 *   • Real device over Wi‑Fi (same network, no USB): set DEV_HOST to your
 *     computer's LAN IP, e.g. '192.168.1.20'.
 */
import { Platform } from "react-native";

/** Override the backend host for your dev setup; null → per-platform default. */
const DEV_HOST: string | null = null;

const HOST = DEV_HOST ?? (Platform.OS === "android" ? "10.0.2.2" : "localhost");

/**
 * Relay + Discovery + Media ports, matching backend/relay, backend/discovery,
 * and backend/media. Relay is on 8190 (not 8090) to dodge a Wondershare
 * "NativePush" helper that respawns onto IPv4 8090 on this machine and steals
 * the socket.
 */
const RELAY_PORT = 8190;
const DISCOVERY_PORT = 8091;
const MEDIA_PORT = 8092;

export const config = {
  discoveryUrl: `http://${HOST}:${DISCOVERY_PORT}`,
  relayUrl: `ws://${HOST}:${RELAY_PORT}/v1/relay`,
  mediaUrl: `http://${HOST}:${MEDIA_PORT}`,
} as const;
