import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorFromBlocks,
  anchorFromLine,
  lineFromAnchor,
  markdownBlockLines,
  scrollTopFromBlocks,
  TOP_ANCHOR,
} from "./view-anchor";

const DOC = [
  "# 第一章",        // 0
  "",               // 1
  "第一段正文。",     // 2
  "接着的第二行。",   // 3
  "",               // 4
  "```",            // 5
  "const a = 1;",   // 6
  "",               // 7
  "const b = 2;",   // 8
  "```",            // 9
  "",               // 10
  "# 第二章",        // 11
  "",               // 12
  "最后一段。",       // 13
].join("\n");

test("blank lines inside a fence do not split it into separate blocks", () => {
  assert.deepEqual(markdownBlockLines(DOC), [0, 2, 5, 11, 13]);
});

test("a source line maps to the block that contains it and back again", () => {
  // Line 3 is the second line of the paragraph that starts at line 2.
  assert.equal(anchorFromLine(DOC, 3).block, 1);
  assert.ok(anchorFromLine(DOC, 3).fraction > 0);
  // Line 8 is inside the fence, which is one block however many blank lines it holds.
  assert.equal(anchorFromLine(DOC, 8).block, 2);
  for (const line of [0, 2, 5, 11, 13]) {
    assert.equal(lineFromAnchor(DOC, anchorFromLine(DOC, line)), line);
  }
});

test("an anchor past the end of the document is clamped, never thrown", () => {
  assert.equal(lineFromAnchor(DOC, { block: 99, fraction: 2 }), 13);
  assert.equal(lineFromAnchor("", TOP_ANCHOR), 0);
  assert.deepEqual(markdownBlockLines(""), [0]);
});

test("the block under the viewport is found by geometry, not by scroll percentage", () => {
  // A short heading, a very tall image, then two paragraphs: a percentage would put
  // the reader in the wrong place entirely once the tall block is scrolled past.
  const blocks = [
    { offsetTop: 0, offsetHeight: 40 },
    { offsetTop: 40, offsetHeight: 900 },
    { offsetTop: 940, offsetHeight: 60 },
    { offsetTop: 1000, offsetHeight: 60 },
  ];
  assert.deepEqual(anchorFromBlocks(blocks, 0), { block: 0, fraction: 0 });
  assert.deepEqual(anchorFromBlocks(blocks, 490), { block: 1, fraction: 0.5 });
  assert.equal(anchorFromBlocks(blocks, 970).block, 2);
  // Past the end sticks to the last block rather than resetting to the top.
  assert.deepEqual(anchorFromBlocks(blocks, 99_999), { block: 3, fraction: 1 });
  assert.deepEqual(anchorFromBlocks([], 120), TOP_ANCHOR);

  assert.equal(scrollTopFromBlocks(blocks, { block: 1, fraction: 0.5 }), 490);
  assert.equal(scrollTopFromBlocks(blocks, { block: 2, fraction: 0 }), 940);
  assert.equal(scrollTopFromBlocks(blocks, { block: 99, fraction: 0 }), 1000);
  assert.equal(scrollTopFromBlocks([], { block: 3, fraction: 1 }), 0);
});
