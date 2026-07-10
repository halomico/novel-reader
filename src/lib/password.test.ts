import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password";

test("creates salted password hashes and verifies the original password", () => {
  const first = hashPassword("correct horse battery staple");
  const second = hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(verifyPassword("correct horse battery staple", first), true);
  assert.equal(verifyPassword("wrong password", first), false);
});

test("rejects malformed or unreasonably cheap password hashes", () => {
  assert.equal(verifyPassword("password", "sha256:value"), false);
  assert.equal(verifyPassword("password", "pbkdf2-sha256:1:salt:hash"), false);
  assert.equal(verifyPassword("password", "pbkdf2-sha256:999999999:salt:hash"), false);
});
