/**
 * Unit tests for the Tier-0 heuristic scam detector.
 *
 * Covers a positive example per category (should flag with the right label) and
 * a set of benign messages that must NOT flag — the conservative-threshold /
 * low-false-positive requirement from the spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicScamDetector, HEURISTIC_MODEL_VERSION } from "../src/scam/detector.js";
import type { ScamCategory } from "@hwfa/models";

const scams: Array<[ScamCategory, string]> = [
  ["advance_fee", "I am a barrister with an unclaimed inheritance fund; send a clearance fee to release your funds."],
  ["investment_fraud", "Join our crypto trading platform — guaranteed 300% returns on your investment, no risk!"],
  ["romance", "My love, I am stranded abroad at the airport and need money for a flight home urgently."],
  ["job_offer", "Work from home and earn $500 per day! Just pay a small registration fee to start."],
  ["impersonation", "This is your bank. Your account has been suspended. Verify immediately to unlock it."],
  ["phishing", "Confirm your account details now: http://secure-login-verify.example/login before it's too late."],
  ["lottery", "Congratulations! You have won a $1,000,000 prize in our lottery. Claim your winnings today."],
  ["otp_solicitation", "I sent a verification code to your phone — please read me the code so I can confirm it."],
];

test("flags each scam category with the expected label", () => {
  for (const [category, text] of scams) {
    const verdict = heuristicScamDetector.analyze(text);
    assert.equal(verdict.flagged, true, `should flag: ${text}`);
    assert.equal(verdict.category, category, `category for: ${text}`);
    assert.ok(verdict.score >= 0.5, `score >= 0.5 for: ${text}`);
    assert.equal(verdict.modelVersion, HEURISTIC_MODEL_VERSION);
  }
});

test("does not flag benign everyday messages", () => {
  const benign = [
    "Hey, are we still on for lunch tomorrow at noon?",
    "Thanks for sending the report — I'll review it tonight.",
    "I love you too, see you this weekend ❤️",
    "Can you send me the code snippet from the meeting?",
    "The apartment viewing is at 3pm, let me know if that works.",
    "Happy birthday! Hope you win big at the game today 🎉",
  ];
  for (const text of benign) {
    const verdict = heuristicScamDetector.analyze(text);
    assert.equal(verdict.flagged, false, `should NOT flag: ${text}`);
  }
});

test("empty text is never flagged", () => {
  const verdict = heuristicScamDetector.analyze("");
  assert.equal(verdict.flagged, false);
  assert.equal(verdict.category, null);
  assert.equal(verdict.score, 0);
});
