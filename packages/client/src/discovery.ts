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
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** The bearer token issued at verify time, if this client has onboarded. */
  get bearerToken(): string | null {
    return this.token;
  }

  /** Restore a previously persisted token (e.g. from secure storage on launch). */
  setToken(token: string): void {
    this.token = token;
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
    const resp = await this.post<{ verified: boolean; token: string }>(
      "/v1/accounts/verify",
      { userId, code },
      false,
    );
    if (!resp.verified || !resp.token) throw new Error("OTP verification failed");
    this.token = resp.token;
    return resp.token;
  }

  /** Fetch a peer's published bundle, consuming one of their one-time prekeys. */
  fetchBundle(userId: string): Promise<PublishedKeyBundle> {
    return this.get(`/v1/keys/${userId}`);
  }

  /** Replenish our own one-time prekey pool. */
  uploadOneTimePreKeys(oneTimePreKeys: OneTimePreKeyPublic[]): Promise<{ poolSize: number }> {
    return this.put("/v1/keys/upload", { oneTimePreKeys });
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
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new DiscoveryError(res.status, pathname, await res.text());
    return (await res.json()) as T;
  }
}
