import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CONTENT_KEYWORD_CHARS } from "@/lib/search-query";
import {
  CONTENT_NORMALIZATION_VERSION,
  createContentBlocks,
  findNormalizedChineseSearchRanges,
  normalizeChineseSearchForms,
  normalizeChineseSearchNeedles,
} from "./content-text";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

test("Chinese normalization uses one versioned NFKC and Traditional-to-Hans contract", async () => {
  assert.deepEqual(await normalizeChineseSearchForms("Ａ_龍門", "title"), {
    original: "a_龍門", hans: "a_龙门", version: CONTENT_NORMALIZATION_VERSION,
  });
  assert.deepEqual(await normalizeChineseSearchForms(" 修、仙！ ", "content"), {
    original: "修仙", hans: null, version: CONTENT_NORMALIZATION_VERSION,
  });
});

test("content blocks reconstruct original UTF-16 exactly and retain bounded search overlap", async () => {
  const text = `甲😀龍${"　".repeat(60)}門乙`;
  const blocks = await collect(createContentBlocks(text, 2));
  assert.equal(blocks.map((block) => block.originalText).join(""), text);
  assert.equal(blocks.length, 33);
  blocks.forEach((block, index) => {
    assert.equal(block.blockNo, index);
    assert.equal(block.charStart, index === 0 ? 0 : blocks[index - 1].charEnd);
    assert.equal(block.charEnd, block.charStart + block.originalText.length);
  });
  assert.ok(blocks.some((block) => block.searchTextOriginal.includes("龍門")));
  assert.ok(blocks.some((block) => block.searchTextHans?.includes("龙门")));
});

test("block search context spans exactly the longest public keyword across a boundary", async () => {
  // The index stores each block's normalized text plus just enough of its neighbours
  // for a maximum-length keyword to be found whole: more context is duplicated
  // index volume, less would make a keyword straddling two blocks unfindable.
  const context = MAX_CONTENT_KEYWORD_CHARS - 1;
  const keyword = "一二三四五六七八九十壹贰叁肆伍";
  assert.equal(Array.from(keyword).length, MAX_CONTENT_KEYWORD_CHARS);
  const text = `${"甲".repeat(1_193)}${keyword}${"乙".repeat(1_200)}`;
  const blocks = await collect(createContentBlocks(text, 1_200));
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].searchTextOriginal.length, 1_200 + context, "leading block carries only trailing context");
  assert.equal(blocks[1].searchTextOriginal.length, context + 1_200 + 8);
  assert.ok(blocks[0].searchTextOriginal.includes(keyword), "a keyword crossing the boundary is findable whole");
});

test("content normalization rejects invalid Unicode", async () => {
  await assert.rejects(normalizeChineseSearchForms("a\0b"), /valid Unicode/);
  await assert.rejects(normalizeChineseSearchForms("\ud800"), /valid Unicode/);
});

test("normalized matches map Traditional, punctuation and compatibility text back to source offsets", async () => {
  const text = "前文 龍、門與ＡＢＣ 后文";
  const needles = await normalizeChineseSearchNeedles(["龙门", "abc"]);
  const ranges = await findNormalizedChineseSearchRanges(text, needles);
  assert.deepEqual(ranges.map((range) => text.slice(range.start, range.end)), ["龍、門", "ＡＢＣ"]);
});
