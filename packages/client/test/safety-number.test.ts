import { test } from "node:test";
import assert from "node:assert/strict";
import { safetyNumber } from "../src/safety-number.js";

// Two base64 "identity keys" (arbitrary 33-byte-ish blobs for the test).
const A = Buffer.from("alice-identity-key-material-000001").toString("base64");
const B = Buffer.from("bob-identity-key-material-00000002").toString("base64");

test("safety number is symmetric — both sides compute the same value", () => {
  assert.equal(safetyNumber(A, B), safetyNumber(B, A));
});

test("safety number is deterministic and differs for different peers", () => {
  const C = Buffer.from("carol-identity-key-material-000003").toString("base64");
  assert.equal(safetyNumber(A, B), safetyNumber(A, B));
  assert.notEqual(safetyNumber(A, B), safetyNumber(A, C));
});

test("safety number is 12 groups of 5 digits", () => {
  const sn = safetyNumber(A, B);
  const groups = sn.split(" ");
  assert.equal(groups.length, 12);
  for (const g of groups) assert.match(g, /^\d{5}$/);
});
