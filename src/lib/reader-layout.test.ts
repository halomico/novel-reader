import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeReaderEntryEdge,
  isReaderResumeNavigation,
  normalizeReaderNavigationTitle,
  resolveReaderEntryEdge,
  resolveReaderDragTarget,
  resolveReaderEntryPage,
  resolveReaderPageMetrics,
  shouldPrefetchReaderRoute,
  splitReaderParagraphs,
} from "./reader-layout";

test("resume query marks a continue-reading navigation", () => {
  assert.equal(isReaderResumeNavigation("resume=1"), true);
  assert.equal(isReaderResumeNavigation("?resume=1&from=%2Factivity"), true);
  assert.equal(isReaderResumeNavigation("from=%2Factivity"), false);
  assert.equal(isReaderResumeNavigation(""), false);
});

test("reader entry edges can only be consumed by their destination route", () => {
  const stored = encodeReaderEntryEdge("/books/8/chapters/20?from=reader", "end");
  assert.equal(resolveReaderEntryEdge(stored, "/books/8/chapters/19?from=reader"), null);
  assert.equal(resolveReaderEntryEdge(stored, "/books/8/chapters/20?from=reader"), "end");
  assert.equal(resolveReaderEntryEdge("end", "/books/8/chapters/20?from=reader"), null);
});

test("reader entry edges land on the intended adjacent-document page", () => {
  assert.equal(resolveReaderEntryPage({ entryEdge: "start", pageCount: 30 }), 0);
  assert.equal(resolveReaderEntryPage({ entryEdge: "end", pageCount: 30 }), 29);
  assert.equal(resolveReaderEntryPage({ entryEdge: null, progressRatio: 0.5, pageCount: 30 }), 15);
  assert.equal(resolveReaderEntryPage({ entryEdge: null, pageCount: 30 }), 0);
});

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

test("reader page metrics preserve fractional CSS column widths", () => {
  const metrics = resolveReaderPageMetrics({
    viewportWidth: 375.2,
    scrollWidth: 22_887,
    scrollLeft: 7_504,
    pageGap: 0,
  });
  assert.equal(metrics.stride, 375.2);
  assert.equal(metrics.index, 20);
});

test("reader navigation removes a repeated numeric source prefix", () => {
  assert.equal(
    normalizeReaderNavigationTitle("0981-千城测试纪事0981-银沙堡归途石"),
    "0981-千城测试纪事 · 银沙堡归途石",
  );
  assert.equal(normalizeReaderNavigationTitle("普通标题"), "普通标题");
});

test("reader route prefetch respects document and network budgets", () => {
  assert.equal(shouldPrefetchReaderRoute({ contentBytes: 32_000 }), true);
  assert.equal(shouldPrefetchReaderRoute({ contentBytes: 300_000 }), false);
  assert.equal(shouldPrefetchReaderRoute({ contentBytes: 32_000, saveData: true }), false);
  assert.equal(shouldPrefetchReaderRoute({ contentBytes: 32_000, effectiveType: "2g" }), false);
  assert.equal(shouldPrefetchReaderRoute({ contentBytes: 32_000, visible: false }), false);
});
