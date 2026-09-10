import assert from "node:assert/strict";
import test from "node:test";
import { createNovelSegmentWindow } from "./segments";

test("creates bounded reader windows with stable segment indexes", () => {
  const content = "段".repeat(6_000);
  const window = createNovelSegmentWindow(content, { startSegment: 2, limit: 2 });

  assert.deepEqual(window.segments.map((segment) => segment.segmentIndex), [2, 3]);
  assert.equal(window.startSegment, 2);
  assert.equal(window.previousContent, "段".repeat(1_200));
  assert.equal(window.hasPrevious, true);
  assert.equal(window.hasNext, true);
  assert.equal(window.totalChars, content.length);
});

test("clips previews at the requested character boundary", () => {
  const window = createNovelSegmentWindow("文".repeat(4_000), { charEnd: 2_500 });

  assert.deepEqual(window.segments.map((segment) => segment.charEnd), [1_200, 2_400, 2_500]);
  assert.equal(window.segments.at(-1)?.content.length, 100);
  assert.equal(window.totalChars, 2_500);
  assert.equal(window.hasNext, false);
});

test("stale reader anchors fall back to the final bounded window", () => {
  const window = createNovelSegmentWindow("页".repeat(6_000), { startSegment: 999, limit: 2 });

  assert.deepEqual(window.segments.map((segment) => segment.segmentIndex), [3, 4]);
  assert.equal(window.startSegment, 3);
  assert.equal(window.previousContent, "页".repeat(1_200));
  assert.equal(window.hasPrevious, true);
  assert.equal(window.hasNext, false);
});
