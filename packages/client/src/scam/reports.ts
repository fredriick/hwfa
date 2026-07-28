/**
 * False-positive report log (Tier-0/Tier-1 feedback).
 *
 * When a user marks a scam warning as wrong, we record a report — never the
 * plaintext, only a salted-ish hash of it plus the verdict — so the model can be
 * retrained. Phase 2 batches these to a backend endpoint; for now they collect
 * in an injectable local store. Keeping the plaintext out of the report means the
 * log is safe at rest and safe to upload.
 */
import type { FalsePositiveReport, ScamVerdict } from "@hwfa/models";
import { sha256 } from "../sha256.js";

/** Persistence seam for the report log (RN: native store; Node/tests: memory). */
export interface ReportSink {
  load(): Promise<FalsePositiveReport[]>;
  save(reports: FalsePositiveReport[]): Promise<void>;
}

/** Default in-memory sink (tests, Node). */
export class MemoryReportSink implements ReportSink {
  private reports: FalsePositiveReport[] = [];
  async load(): Promise<FalsePositiveReport[]> {
    return this.reports;
  }
  async save(reports: FalsePositiveReport[]): Promise<void> {
    this.reports = reports;
  }
}

/** base64(sha256(text)) — a stable, plaintext-free id for a reported message. */
export function hashText(text: string): string {
  return bytesToBase64(sha256(utf8Encode(text)));
}

/**
 * Collects false-positive reports and hands them off in batches. `flush`
 * returns the pending batch and clears it; the caller uploads it (Phase 2) and,
 * on failure, can `restore` it to retry later.
 */
export class FalsePositiveReporter {
  private pending: FalsePositiveReport[] = [];
  private loaded = false;

  constructor(private readonly sink: ReportSink = new MemoryReportSink()) {}

  /** Record a wrongly-flagged message. Stores only its hash + the verdict. */
  async report(text: string, verdict: ScamVerdict): Promise<void> {
    await this.ensureLoaded();
    this.pending.push({ textHash: hashText(text), verdict, reportedAt: Date.now() });
    await this.sink.save(this.pending);
  }

  /** How many reports are waiting to be uploaded. */
  async pendingCount(): Promise<number> {
    await this.ensureLoaded();
    return this.pending.length;
  }

  /** Take the pending batch (clearing it). Caller uploads; restore() on failure. */
  async flush(): Promise<FalsePositiveReport[]> {
    await this.ensureLoaded();
    const batch = this.pending;
    this.pending = [];
    await this.sink.save(this.pending);
    return batch;
  }

  /** Put a failed-upload batch back at the front of the queue. */
  async restore(batch: FalsePositiveReport[]): Promise<void> {
    await this.ensureLoaded();
    this.pending = [...batch, ...this.pending];
    await this.sink.save(this.pending);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.pending = await this.sink.load();
    this.loaded = true;
  }
}

// --- local base64 / utf8 (same approach as client.ts; no globals needed) ---

function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((code & 0x3ff) << 10) + (lo & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
