/**
 * Scam detection types. All Tier 1 detection runs on-device against decrypted
 * plaintext (see Phase 2). These types are shared by the classifier wrapper,
 * the inline warning UI, and the false-positive reporting flow.
 */

/** Tier 1 training targets — the global scam categories. */
export type ScamCategory =
  | "advance_fee"
  | "investment_fraud"
  | "romance"
  | "job_offer"
  | "impersonation"
  | "phishing"
  | "lottery"
  | "otp_solicitation"
  | "deepfake"
  | "rental_escrow";

/** Human-readable labels for the inline warning banner. */
export const SCAM_CATEGORY_LABELS: Record<ScamCategory, string> = {
  advance_fee: "Advance-fee fraud",
  investment_fraud: "Investment fraud",
  romance: "Romance scam",
  job_offer: "Job offer scam",
  impersonation: "Impersonation",
  phishing: "Phishing link",
  lottery: "Lottery / prize fraud",
  otp_solicitation: "Code / password request",
  deepfake: "Possible deepfake",
  rental_escrow: "Rental / escrow fraud",
};

/** Result of a Tier 1 on-device inference over one message. */
export interface ScamVerdict {
  /** Whether the score crossed the (conservative) launch threshold. */
  flagged: boolean;
  /** Highest-scoring category. */
  category: ScamCategory | null;
  /** Model confidence 0..1. */
  score: number;
  /** Version of the ONNX model that produced this verdict. */
  modelVersion: string;
}

/** Locally logged, batched-upload false-positive report. */
export interface FalsePositiveReport {
  /** Hash of the message text — never the plaintext itself. */
  textHash: string;
  verdict: ScamVerdict;
  reportedAt: number;
}
