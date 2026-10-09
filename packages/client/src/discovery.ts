/**
 * DiscoveryClient — the client half of the `backend/discovery` API.
 *
 * Portable: uses `fetch` (injectable so tests can point at a spawned service and
 * React Native / Node both work). Handles registration + OTP verification (it
 * keeps the bearer token), key-bundle fetch, and salted-hash contact discovery.
 * It never sees private keys — only public bundles and salted phone hashes.
 */
import type { OneTimePreKeyPublic, PublishedKeyBundle } from "./crypto-provider.js";

export type FetchLike = typeof fetch;

export interface ContactMatch {
  phoneHashB64: string;
  userId: string;
}

/** One device on the caller's own account, for the device-management UI. */
export interface DeviceInfo {
  userId: string;
  deviceId: number;
  primary: boolean;
}

export class DiscoveryError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`discovery ${path} → ${status} ${body}`);
    this.name = "DiscoveryError";
  }
}

export class DiscoveryClient {
  private token: string | null = null; // short-lived access token
  private refresh_: string | null = null; // long-lived refresh token
  private refreshing: Promise<void> | null = null; // de-dupes concurrent refreshes

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** The current access token, if this client has onboarded. */
  get bearerToken(): string | null {
    return this.token;
  }

  /** The current refresh token (persist it alongside the access token). */
  get refreshToken(): string | null {
    return this.refresh_;
  }

  /** Restore a previously persisted access token (legacy single-token path). */
  setToken(token: string): void {
    this.token = token;
  }

  /** Restore persisted access + refresh tokens (e.g. on launch/resume). */
  setTokens(access: string, refresh: string): void {
    this.token = access;
    this.refresh_ = refresh;
  }

  /**
   * Ensure the access token is fresh enough to use, refreshing it from the
   * refresh token if it's missing or within 60s of expiry. No-op when there's
   * no refresh token (legacy / not onboarded).
   */
  async ensureAccess(): Promise<void> {
    if (!this.refresh_) return;
    if (this.token && !expiringSoon(this.token)) return;
    await this.refresh();
  }

  /** Exchange the refresh token for a fresh access (+ rotated refresh) token. */
  async refresh(): Promise<void> {
    if (!this.refresh_) throw new Error("no refresh token");
    // Collapse concurrent refreshes into one in-flight request.
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const resp = await this.post<{ token: string; refreshToken: string }>(
          "/v1/auth/refresh",
          { refreshToken: this.refresh_ },
          false,
        );
        this.token = resp.token;
        if (resp.refreshToken) this.refresh_ = resp.refreshToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * Register public key material for a phone number, then verify the OTP and
   * keep the returned bearer token. Returns the server-assigned user id.
   *
   * In `DISCOVERY_DEV=1` the OTP is echoed back so this completes headlessly;
   * in production `submitOtp` must be called separately with the real SMS code.
   */
  async onboard(
    publishedBundle: PublishedKeyBundle,
    oneTimePreKeys: OneTimePreKeyPublic[],
    phoneNumber: string,
  ): Promise<string> {
    const reg = await this.register(publishedBundle, oneTimePreKeys, phoneNumber);
    if (!reg.devOtp) {
      throw new Error(
        "register did not echo a dev OTP — call submitOtp() with the SMS code instead of onboard()",
      );
    }
    await this.submitOtp(reg.userId, reg.devOtp);
    return reg.userId;
  }

  /** Step 1 of onboarding: upload the bundle + prekey pool for a phone number. */
  async register(
    publishedBundle: PublishedKeyBundle,
    oneTimePreKeys: OneTimePreKeyPublic[],
    phoneNumber: string,
  ): Promise<{ userId: string; otpSent: boolean; devOtp?: string }> {
    // publishedBundle already carries deviceId + registrationId + public keys.
    return this.post("/v1/accounts/register", {
      phoneNumber,
      ...publishedBundle,
      oneTimePreKeys,
    });
  }

  /** Step 2 of onboarding: verify the OTP; stores + returns the bearer token. */
  async submitOtp(userId: string, code: string): Promise<string> {
    const resp = await this.post<{ verified: boolean; token: string; refreshToken: string }>(
      "/v1/accounts/verify",
      { userId, code },
      false,
    );
    if (!resp.verified || !resp.token) throw new Error("OTP verification failed");
    this.token = resp.token;
    this.refresh_ = resp.refreshToken ?? null;
    return resp.token;
  }

  /** Fetch a peer's published bundle, consuming one of their one-time prekeys. */
  fetchBundle(userId: string): Promise<PublishedKeyBundle> {
    return this.get(`/v1/keys/${userId}`);
  }

  // --- multi-device linking ---

  /** Mint a provisioning token so another device can join this account. */
  createLinkToken(): Promise<{ token: string; expiresInSec: number }> {
    return this.post("/v1/devices/link-token", {});
  }

  /**
   * Join an existing account with a provisioning token, uploading this device's
   * own key material. Stores and returns the issued bearer token + account id.
   */
  async linkDevice(
    token: string,
    publishedBundle: PublishedKeyBundle,
    oneTimePreKeys: OneTimePreKeyPublic[],
  ): Promise<{ userId: string; accountId: string; token: string; refreshToken: string }> {
    const resp = await this.post<{
      userId: string;
      accountId: string;
      token: string;
      refreshToken: string;
    }>("/v1/devices/link", { token, ...publishedBundle, oneTimePreKeys }, false);
    if (!resp.token) throw new Error("device link failed");
    this.token = resp.token;
    this.refresh_ = resp.refreshToken ?? null;
    return resp;
  }

  /** List the caller's own devices (primary + linked) for review/revocation. */
  async listMyDevices(): Promise<DeviceInfo[]> {
    const { devices } = await this.get<{ devices: DeviceInfo[] }>("/v1/devices");
    return devices ?? [];
  }

  /** Revoke one linked device from the caller's account (204, no body). */
  async removeDevice(userId: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/devices/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new DiscoveryError(res.status, "/v1/devices", await res.text());
  }

  /** List the device user ids sharing an account (for send-side fanout). */
  async listDevices(accountId: string): Promise<string[]> {
    const { devices } = await this.get<{ devices: string[] }>(
      `/v1/accounts/${accountId}/devices`,
    );
    return devices ?? [];
  }

  /** Resolve a device user id to its account id. */
  async resolveAccount(userId: string): Promise<string> {
    const { accountId } = await this.get<{ accountId: string }>(
      `/v1/accounts/${userId}/account`,
    );
    return accountId;
  }

  /** Replenish our own one-time prekey pool. */
  uploadOneTimePreKeys(oneTimePreKeys: OneTimePreKeyPublic[]): Promise<{ poolSize: number }> {
    return this.put("/v1/keys/upload", { oneTimePreKeys });
  }

  /** How many one-time prekeys we still have on the server. */
  async poolSize(): Promise<number> {
    const { poolSize } = await this.get<{ poolSize: number }>("/v1/keys/pool");
    return poolSize;
  }

  /** The salt clients hash their contacts with before intersect. */
  async getSalt(): Promise<string> {
    const { saltB64 } = await this.get<{ saltB64: string }>("/v1/contacts/salt");
    return saltB64;
  }

  /** Privacy-preserving contact discovery by salted phone hash. */
  async intersect(phoneHashesB64: string[]): Promise<ContactMatch[]> {
    const { matches } = await this.post<{ matches: ContactMatch[] }>(
      "/v1/contacts/intersect",
      { phoneHashesB64 },
    );
    return matches;
  }

  /** Purge the caller's account server-side (204, no body). Clears our token. */
  async deleteAccount(): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/accounts`, { method: "DELETE", headers });
    if (!res.ok) throw new DiscoveryError(res.status, "/v1/accounts", await res.text());
    this.token = null;
  }

  // --- transport ---

  private async post<T>(pathname: string, body: unknown, auth = true): Promise<T> {
    return this.request<T>("POST", pathname, body, auth);
  }

  private async put<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", pathname, body, true);
  }

  private async get<T>(pathname: string): Promise<T> {
    return this.request<T>("GET", pathname, undefined, true);
  }

  private async request<T>(
    method: string,
    pathname: string,
    body: unknown,
    auth: boolean,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // An expired access token → refresh once and retry transparently.
    if (res.status === 401 && auth && !retried && this.refresh_) {
      try {
        await this.refresh();
      } catch {
        throw new DiscoveryError(res.status, pathname, await res.text());
      }
      return this.request<T>(method, pathname, body, auth, true);
    }
    if (!res.ok) throw new DiscoveryError(res.status, pathname, await res.text());
    return (await res.json()) as T;
  }
}

/** True if a signed token's `exp` claim is missing or within 60s. Best-effort
 *  decode of the base64url payload; a malformed token counts as expiring. */
function expiringSoon(token: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return true;
  try {
    const json = decodeBase64Url(token.slice(0, dot));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    if (typeof exp !== "number") return true;
    return exp * 1000 - Date.now() < 60_000;
  } catch {
    return true;
  }
}

function decodeBase64Url(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  if (typeof atob === "function") return atob(b64);
  return Buffer.from(b64, "base64").toString("binary");
}
