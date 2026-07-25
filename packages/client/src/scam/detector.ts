/**
 * Tier-0 heuristic scam detector — a portable, dependency-free placeholder for
 * the Phase-2 Tier-1 ONNX classifier.
 *
 * It runs on decrypted plaintext, entirely on-device, and returns the shared
 * `ScamVerdict` shape. Because it sits behind the `ScamDetector` seam, the ONNX
 * model can replace it later without touching the client or the UI — same
 * interface, same verdict type, same inline-warning rendering.
 *
 * This is rule-based (weighted keyword/pattern signals per category), not ML. It
 * is deliberately specific to keep false positives low at a conservative launch
 * threshold; it will miss novel phrasings the trained model would catch. Treat
 * it as a functional stand-in that proves the end-to-end pipeline.
 */
import type { ScamCategory, ScamVerdict } from "@hwfa/models";

/** The seam the ONNX Tier-1 classifier will implement in Phase 2. */
export interface ScamDetector {
  analyze(text: string): ScamVerdict;
}

export const HEURISTIC_MODEL_VERSION = "heuristic-0";

/** Score at/above which a message is flagged. Conservative by design. */
const FLAG_THRESHOLD = 0.5;

interface Signal {
  category: ScamCategory;
  weight: number;
  pattern: RegExp;
}

/** Strong signals are near-diagnostic on their own; weak ones need company. */
const STRONG = 0.55;
const WEAK = 0.3;

const SIGNALS: Signal[] = [
  // Advance-fee / 419
  { category: "advance_fee", weight: STRONG, pattern: /\b(next of kin|beneficiary|inheritance|estate)\b.{0,60}\b(fund|money|million|transfer|claim)\b/i },
  { category: "advance_fee", weight: STRONG, pattern: /\b(clearance|processing|release|transfer)\s+fee\b/i },
  { category: "advance_fee", weight: WEAK, pattern: /\b(barrister|late (mr|mrs)|deceased client|unclaimed (fund|deposit))\b/i },

  // Investment / crypto fraud
  { category: "investment_fraud", weight: STRONG, pattern: /\b(guaranteed|guarantee[ds]?)\b.{0,25}\b(returns?|profit|roi)\b/i },
  { category: "investment_fraud", weight: STRONG, pattern: /\b(double|triple|\d{2,4}\s?%)\b.{0,25}\b(your )?(money|investment|returns?|profit)\b/i },
  { category: "investment_fraud", weight: WEAK, pattern: /\b(crypto|bitcoin|forex|trading platform)\b.{0,25}\b(opportunity|invest|signals?|profit)\b/i },

  // Romance (requires a financial ask to flag — avoids flagging affection)
  { category: "romance", weight: STRONG, pattern: /\b(stuck|stranded)\b.{0,30}\b(abroad|overseas|airport|hospital)\b/i },
  { category: "romance", weight: STRONG, pattern: /\bneed\b.{0,25}\b(money|funds?|help)\b.{0,25}\b(flight|ticket|visa|customs|surgery)\b/i },

  // Job offer scams
  { category: "job_offer", weight: STRONG, pattern: /\b(registration|training|equipment|starter)\s+fee\b/i },
  { category: "job_offer", weight: WEAK, pattern: /\b(work from home|part[- ]time)\b.{0,30}\b(earn|\$|per day|daily|weekly)\b/i },
  { category: "job_offer", weight: WEAK, pattern: /\bno experience (needed|required)\b.{0,30}\b(earn|\$|income)\b/i },

  // Impersonation (bank / agency / tech / family emergency)
  { category: "impersonation", weight: STRONG, pattern: /\b(your )?(account|card)\b.{0,25}\b(suspended|locked|compromised|blocked|frozen)\b/i },
  { category: "impersonation", weight: WEAK, pattern: /\b(microsoft|apple|amazon|irs|hmrc|social security)\b.{0,30}\b(support|refund|verify|agent)\b/i },

  // Phishing links
  { category: "phishing", weight: STRONG, pattern: /\b(verify|confirm|update|reactivate)\b.{0,30}\b(account|password|details|identity)\b.{0,30}(https?:\/\/|www\.|bit\.ly|tinyurl)/i },
  { category: "phishing", weight: WEAK, pattern: /\b(bit\.ly|tinyurl|t\.co)\/\S+/i },
  { category: "phishing", weight: WEAK, pattern: /\bclick (here|the link)\b.{0,25}\b(verify|login|log in|confirm|claim)\b/i },

  // Lottery / prize
  { category: "lottery", weight: STRONG, pattern: /\b(you('| ha)ve won|congratulations)\b.{0,40}\b(prize|lottery|winner|award|\$?\d)/i },
  { category: "lottery", weight: WEAK, pattern: /\b(claim|collect)\b.{0,20}\b(your )?(prize|reward|winnings)\b/i },

  // OTP / credential solicitation
  { category: "otp_solicitation", weight: STRONG, pattern: /\b(otp|one[- ]time (code|password|pin)|verification code|security code|2fa code)\b.{0,30}\b(share|send|read|tell|give|forward|what)/i },
  // Verb-first: require a *qualified* code word — bare "code" (e.g. "code
  // snippet") is too ambiguous and caused false positives.
  { category: "otp_solicitation", weight: STRONG, pattern: /\b(share|send|tell|read|forward|give)\b.{0,20}\b(the |your )?(otp|verification code|security code|one[- ]time (code|pin|password)|2fa code|pin|password)\b/i },

  // Rental / escrow
  { category: "rental_escrow", weight: STRONG, pattern: /\b(deposit|wire|western union|money order)\b.{0,30}\b(before|to secure|to reserve|to hold)\b.{0,20}\b(apartment|room|property|rental|keys?)\b/i },
  { category: "rental_escrow", weight: WEAK, pattern: /\b(landlord|owner|agent)\b.{0,30}\b(abroad|overseas|out of (the )?country)\b/i },
];

/** Amplifiers add urgency/payment/secrecy risk to whichever category matched. */
const AMPLIFIERS: RegExp[] = [
  /\b(urgent(ly)?|immediately|right now|act now|within \d+ (hours?|minutes?)|before it'?s too late)\b/i,
  /\b(gift card|itunes card|steam card|western union|moneygram|wire transfer|bitcoin|usdt|crypto wallet)\b/i,
  /\b(don'?t tell|keep (this|it) (secret|confidential|between us)|do not share this)\b/i,
];

const AMPLIFIER_BONUS = 0.15;

/** The default on-device detector (heuristic Tier-0). */
export class HeuristicScamDetector implements ScamDetector {
  analyze(text: string): ScamVerdict {
    const empty: ScamVerdict = {
      flagged: false,
      category: null,
      score: 0,
      modelVersion: HEURISTIC_MODEL_VERSION,
    };
    if (!text) return empty;

    const scores = new Map<ScamCategory, number>();
    for (const signal of SIGNALS) {
      if (signal.pattern.test(text)) {
        scores.set(signal.category, (scores.get(signal.category) ?? 0) + signal.weight);
      }
    }
    if (scores.size === 0) return empty;

    let topCategory: ScamCategory | null = null;
    let topScore = 0;
    for (const [category, score] of scores) {
      if (score > topScore) {
        topScore = score;
        topCategory = category;
      }
    }

    // Amplifiers only raise an already-matched category — never flag on their own.
    const amplifiers = AMPLIFIERS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
    const score = Math.min(1, topScore + amplifiers * AMPLIFIER_BONUS);

    return {
      flagged: score >= FLAG_THRESHOLD,
      category: topCategory,
      score: Number(score.toFixed(2)),
      modelVersion: HEURISTIC_MODEL_VERSION,
    };
  }
}

/** Shared default instance. */
export const heuristicScamDetector = new HeuristicScamDetector();
