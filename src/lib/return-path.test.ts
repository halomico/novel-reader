import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUserReturnPath } from "./return-path";

test("keeps safe frontend return paths and rejects redirects outside the user site", () => {
  assert.equal(normalizeUserReturnPath("/media?kind=audio"), "/media?kind=audio");
  assert.equal(normalizeUserReturnPath("/novels?random=test"), "/novels?random=test");
  assert.equal(normalizeUserReturnPath("https://example.com"), "/account?view=growth");
  assert.equal(normalizeUserReturnPath("//example.com"), "/account?view=growth");
  assert.equal(normalizeUserReturnPath("/admin/settings"), "/account?view=growth");
  assert.equal(normalizeUserReturnPath("/login?returnTo=/media"), "/account?view=growth");
});
