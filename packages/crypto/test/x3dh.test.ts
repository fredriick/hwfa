import { test } from "node:test";
import assert from "node:assert/strict";
import { CiphertextType } from "@hwfa/models";
import {
  decrypt,
  encrypt,
  establishSession,
  generateRegistration,
} from "../src/index.js";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

test("X3DH: first message is a PreKey message and decrypts", async () => {
  const alice = generateRegistration({ deviceId: 1 });
  const bob = generateRegistration({ deviceId: 1 });

  // Alice fetches Bob's published bundle from Discovery and establishes a session.
  await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);

  const enc = await encrypt(alice.stores, BOB, bob.deviceId, "hello bob");
  assert.equal(enc.type, CiphertextType.PreKey, "first message must carry X3DH");

  const out = await decrypt(bob.stores, ALICE, alice.deviceId, enc);
  assert.equal(out, "hello bob");
});

test("Double Ratchet: subsequent messages are Whisper messages, bidirectional", async () => {
  const alice = generateRegistration();
  const bob = generateRegistration();
  await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);

  // First message establishes the session on Bob's side.
  const first = await encrypt(alice.stores, BOB, bob.deviceId, "msg 1");
  assert.equal(await decrypt(bob.stores, ALICE, alice.deviceId, first), "msg 1");

  // Now Bob has a session; his reply is a normal Whisper (ratchet) message.
  const reply = await encrypt(bob.stores, ALICE, alice.deviceId, "reply 1");
  assert.equal(reply.type, CiphertextType.Whisper);
  assert.equal(await decrypt(alice.stores, BOB, bob.deviceId, reply), "reply 1");

  // A second Alice→Bob message is also a Whisper now that the session is up.
  const second = await encrypt(alice.stores, BOB, bob.deviceId, "msg 2");
  assert.equal(second.type, CiphertextType.Whisper);
  assert.equal(await decrypt(bob.stores, ALICE, alice.deviceId, second), "msg 2");
});

test("Double Ratchet: every message uses a fresh key (ciphertexts differ)", async () => {
  const alice = generateRegistration();
  const bob = generateRegistration();
  await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);

  const a = await encrypt(alice.stores, BOB, bob.deviceId, "same plaintext");
  const b = await encrypt(alice.stores, BOB, bob.deviceId, "same plaintext");
  assert.notEqual(
    a.ciphertextB64,
    b.ciphertextB64,
    "identical plaintext must not produce identical ciphertext",
  );
});

test("Out-of-order delivery still decrypts (ratchet skipped-key handling)", async () => {
  const alice = generateRegistration();
  const bob = generateRegistration();
  await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);

  // Prime Bob's session with the first PreKey message.
  const m1 = await encrypt(alice.stores, BOB, bob.deviceId, "one");
  assert.equal(await decrypt(bob.stores, ALICE, alice.deviceId, m1), "one");

  const m2 = await encrypt(alice.stores, BOB, bob.deviceId, "two");
  const m3 = await encrypt(alice.stores, BOB, bob.deviceId, "three");

  // Deliver out of order: m3 before m2.
  assert.equal(await decrypt(bob.stores, ALICE, alice.deviceId, m3), "three");
  assert.equal(await decrypt(bob.stores, ALICE, alice.deviceId, m2), "two");
});

test("One-time prekey is consumed after first inbound session", async () => {
  const alice = generateRegistration();
  const bob = generateRegistration({ oneTimePreKeyCount: 3 });
  const before = bob.stores.preKey.count();

  await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);
  const m = await encrypt(alice.stores, BOB, bob.deviceId, "consume a prekey");
  await decrypt(bob.stores, ALICE, alice.deviceId, m);

  assert.equal(bob.stores.preKey.count(), before - 1, "prekey pool must shrink by one");
});
