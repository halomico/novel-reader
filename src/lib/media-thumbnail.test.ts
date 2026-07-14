import assert from "node:assert/strict";
import test from "node:test";
import { thumbnailSeekSeconds } from "./media-thumbnail";

test("chooses the one-third point for video thumbnails", () => {
  assert.equal(thumbnailSeekSeconds(90), 30);
  assert.equal(thumbnailSeekSeconds(1.5), 0.5);
  assert.equal(thumbnailSeekSeconds(0), 0);
  assert.equal(thumbnailSeekSeconds(Number.NaN), 0);
});

test("supports configured and evenly spaced thumbnail positions", () => {
  assert.equal(thumbnailSeekSeconds(100, 0.25), 25);
  assert.equal(thumbnailSeekSeconds(100, 0.5), 50);
  assert.equal(thumbnailSeekSeconds(100, 1), 0);
});
