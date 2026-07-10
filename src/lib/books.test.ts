import assert from "node:assert/strict";
import test from "node:test";
import { normalizePageSize } from "./books";

test("honors the configured catalog range up to 100 books", () => {
  assert.equal(normalizePageSize(75), 75);
  assert.equal(normalizePageSize(100), 100);
  assert.equal(normalizePageSize(101), 100);
});
