import assert from "node:assert/strict";
import test from "node:test";
import { getPaginationItems } from "./Pagination";

test("full pagination preserves the original first, middle and final windows", () => {
  assert.deepEqual(getPaginationItems(1, 2_070), [1, 2, 3, 4, 5, "ellipsis", 2_070]);
  assert.deepEqual(getPaginationItems(200, 2_070), [1, "ellipsis", 199, 200, 201, 202, "ellipsis", 2_070]);
  assert.deepEqual(getPaginationItems(2_069, 2_070), [1, "ellipsis", 2_066, 2_067, 2_068, 2_069, 2_070]);
});

test("pagination clamps malformed or out-of-range current pages", () => {
  assert.deepEqual(getPaginationItems(-10, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPaginationItems(99, 8), [1, "ellipsis", 4, 5, 6, 7, 8]);
});
