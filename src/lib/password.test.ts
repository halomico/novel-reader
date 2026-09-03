import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { hashPassword, hashPasswordAsync, passwordNeedsRehash, verifyPassword, verifyPasswordAsync } from "./password";

test("synchronous administrator compatibility hashes remain salted and verifiable", () => {
  const first = hashPassword("correct horse battery staple");
  const second = hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(verifyPassword("correct horse battery staple", first), true);
  assert.equal(verifyPassword("wrong password", first), false);
});

test("normal user passwords use asynchronous scrypt and reject malformed hashes", async () => {
  const hash = await hashPasswordAsync("a long memorable user passphrase");
  assert.match(hash, /^scrypt:v1:/u);
  assert.equal(await verifyPasswordAsync("a long memorable user passphrase", hash), true);
  assert.equal(await verifyPasswordAsync("incorrect", hash), false);
  assert.equal(await verifyPasswordAsync("anything", "broken"), false);
  assert.equal(passwordNeedsRehash(hash), false);
});

test("legacy PBKDF2 users remain valid and are marked for upgrade", async () => {
  const salt = "legacy-salt";
  const iterations = 20_000;
  const expected = crypto.pbkdf2Sync("legacy-password", salt, iterations, 32, "sha256").toString("base64url");
  const legacy = `pbkdf2-sha256:${iterations}:${salt}:${expected}`;
  assert.equal(await verifyPasswordAsync("legacy-password", legacy), true);
  assert.equal(passwordNeedsRehash(legacy), true);
});
