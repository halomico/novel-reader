import assert from "node:assert/strict";
import test from "node:test";
import { resolveReaderDragTarget, resolveReaderPageMetrics, splitReaderParagraphs } from "./reader-layout";

test("reader paragraphs keep Chinese paragraph structure and section headings", () => {
  assert.deepEqual(splitReaderParagraphs("第一章 开始\n\n　　第一段。\n第二段。"), [
    { text: "第一章 开始", continued: false, sectionHeading: true },
    { text: "第一段。", continued: false, sectionHeading: false },
    { text: "第二段。", continued: false, sectionHeading: false },
  ]);
});

test("reader drag only advances after an intentional horizontal gesture", () => {
  assert.equal(resolveReaderDragTarget({ startIndex: 3, distance: 18, velocity: 0.1, stride: 360, pageCount: 8 }), 3);
  assert.equal(resolveReaderDragTarget({ startIndex: 3, distance: 70, velocity: 0.2, stride: 360, pageCount: 8 }), 4);
  assert.equal(resolveReaderDragTarget({ startIndex: 3, distance: -24, velocity: -0.5, stride: 360, pageCount: 8 }), 2);
});

test("reader drag exposes adjacent-document boundaries", () => {
  assert.equal(resolveReaderDragTarget({ startIndex: 0, distance: -80, velocity: -0.4, stride: 360, pageCount: 8 }), -1);
  assert.equal(resolveReaderDragTarget({ startIndex: 7, distance: 80, velocity: 0.4, stride: 360, pageCount: 8 }), 8);
});

test("reader page metrics include the moving gap between adjacent pages", () => {
  const metrics = resolveReaderPageMetrics({
    viewportWidth: 346,
    scrollWidth: 13_606,
    scrollLeft: 390,
    pageGap: 44,
  });
  assert.equal(metrics.stride, 390);
  assert.equal(metrics.count, 35);
  assert.equal(metrics.index, 1);
});
