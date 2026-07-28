/**
 * App-wide false-positive reporter, backed by the native encrypted store.
 *
 * When a user marks a scam warning as wrong, we record a plaintext-free report
 * (hash + verdict) via @hwfa/client's FalsePositiveReporter. Reports persist in
 * the same Keystore-encrypted store as messages; Phase 2 batches them to a
 * backend retraining endpoint.
 */
import { FalsePositiveReporter, type ReportSink } from '@hwfa/client';
import type { FalsePositiveReport } from '@hwfa/models';
import { getNativeCrypto } from '../crypto/NativeHwfaCrypto';

/** Persists the report log to the native encrypted store. Fails soft. */
const nativeReportSink: ReportSink = {
  async load(): Promise<FalsePositiveReport[]> {
    try {
      const json = await getNativeCrypto().loadReports();
      return json ? (JSON.parse(json) as FalsePositiveReport[]) : [];
    } catch {
      return [];
    }
  },
  async save(reports: FalsePositiveReport[]): Promise<void> {
    try {
      await getNativeCrypto().saveReports(JSON.stringify(reports));
    } catch {
      /* stale native build / write error — retried on the next report */
    }
  },
};

export const falsePositiveReporter = new FalsePositiveReporter(nativeReportSink);
