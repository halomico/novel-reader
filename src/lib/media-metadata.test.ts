import assert from "node:assert/strict";
import test from "node:test";
import { formatMediaDuration } from "./media-metadata";

test("formats media duration for cards and lists", () => {
  assert.equal(formatMediaDuration(5.9), "0:05");
  assert.equal(formatMediaDuration(65), "1:05");
  assert.equal(formatMediaDuration(3_665), "1:01:05");
  assert.equal(formatMediaDuration(null), "--:--");
});
