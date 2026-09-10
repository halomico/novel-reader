import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultOriginalSortOrder,
  normalizeOriginalSort,
  normalizeOriginalSortOrder,
} from "./original-model";

test("original catalog sort defaults match the novel catalog pattern", () => {
  assert.equal(normalizeOriginalSort(undefined), "latest");
  assert.equal(normalizeOriginalSort("popular"), "popular");
  assert.equal(normalizeOriginalSort("name"), "name");
  assert.equal(normalizeOriginalSort("updated"), "latest");
  assert.equal(defaultOriginalSortOrder("latest"), "desc");
  assert.equal(defaultOriginalSortOrder("popular"), "desc");
  assert.equal(defaultOriginalSortOrder("name"), "asc");
  assert.equal(normalizeOriginalSortOrder(undefined, "name"), "asc");
  assert.equal(normalizeOriginalSortOrder("desc", "name"), "desc");
  assert.equal(normalizeOriginalSortOrder("asc", "latest"), "asc");
  assert.equal(normalizeOriginalSortOrder("sideways", "latest"), "desc");
});
