/**
 * In-memory implementations of the five libsignal protocol stores.
 *
 * libsignal keeps all its ratchet/session state in these stores; it never
 * holds state internally. In production each of these is backed by the
 * encrypted `signal_store` table in SQLCipher (see the build spec's local DB
 * layout). For the Phase 0 spike and unit tests, an in-memory map is the
 * correct, honest scope — swapping in a SQLCipher-backed store later does not
 * change any calling code.
 */
import {
  Direction,
  IdentityChange,
  IdentityKeyStore,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  PreKeyRecord,
  PreKeyStore,
  PrivateKey,
  ProtocolAddress,
  PublicKey,
  SessionRecord,
  SessionStore,
  SignedPreKeyRecord,
  SignedPreKeyStore,
} from "@signalapp/libsignal-client";

function addrKey(addr: ProtocolAddress): string {
  return `${addr.name()}.${addr.deviceId()}`;
}

export class InMemorySessionStore extends SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
    this.sessions.set(addrKey(name), record);
  }
  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    return this.sessions.get(addrKey(name)) ?? null;
  }
  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    return addresses.map((a) => {
      const s = this.sessions.get(addrKey(a));
      if (!s) throw new Error(`no session for ${addrKey(a)}`);
      return s;
    });
  }
  hasSession(name: ProtocolAddress): boolean {
    return this.sessions.has(addrKey(name));
  }
}

export class InMemoryIdentityStore extends IdentityKeyStore {
  private known = new Map<string, PublicKey>();

  constructor(
    private readonly identityKey: PrivateKey,
    private readonly registrationId: number,
  ) {
    super();
  }

  async getIdentityKey(): Promise<PrivateKey> {
    return this.identityKey;
  }
  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId;
  }
  async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
    const k = addrKey(name);
    const existing = this.known.get(k);
    this.known.set(k, key);
    if (existing && existing.compare(key) !== 0) return IdentityChange.ReplacedExisting;
    return IdentityChange.NewOrUnchanged;
  }
  async isTrustedIdentity(
    name: ProtocolAddress,
    key: PublicKey,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = this.known.get(addrKey(name));
    // Trust on first use: unknown identities are accepted, known ones must match.
    // The Safety Number UI (Phase 4) lets users verify identities out-of-band.
    return existing ? existing.compare(key) === 0 : true;
  }
  async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
    return this.known.get(addrKey(name)) ?? null;
  }
}

export class InMemoryPreKeyStore extends PreKeyStore {
  private keys = new Map<number, PreKeyRecord>();

  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.keys.set(id, record);
  }
  async getPreKey(id: number): Promise<PreKeyRecord> {
    const r = this.keys.get(id);
    if (!r) throw new Error(`no prekey ${id}`);
    return r;
  }
  async removePreKey(id: number): Promise<void> {
    // One-time prekeys are consumed on first use — this is the "used = true"
    // transition mirrored server-side in the one_time_prekeys table.
    this.keys.delete(id);
  }
  count(): number {
    return this.keys.size;
  }
}

export class InMemorySignedPreKeyStore extends SignedPreKeyStore {
  private keys = new Map<number, SignedPreKeyRecord>();

  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.keys.set(id, record);
  }
  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const r = this.keys.get(id);
    if (!r) throw new Error(`no signed prekey ${id}`);
    return r;
  }
}

export class InMemoryKyberPreKeyStore extends KyberPreKeyStore {
  private keys = new Map<number, KyberPreKeyRecord>();
  private used = new Set<number>();

  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.keys.set(id, record);
  }
  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const r = this.keys.get(id);
    if (!r) throw new Error(`no kyber prekey ${id}`);
    return r;
  }
  async markKyberPreKeyUsed(id: number): Promise<void> {
    this.used.add(id);
  }
  isUsed(id: number): boolean {
    return this.used.has(id);
  }
}

/** Bundles all five stores for one device's libsignal state. */
export class InMemorySignalStores {
  readonly session = new InMemorySessionStore();
  readonly identity: InMemoryIdentityStore;
  readonly preKey = new InMemoryPreKeyStore();
  readonly signedPreKey = new InMemorySignedPreKeyStore();
  readonly kyberPreKey = new InMemoryKyberPreKeyStore();

  constructor(identityKey: PrivateKey, registrationId: number) {
    this.identity = new InMemoryIdentityStore(identityKey, registrationId);
  }
}
