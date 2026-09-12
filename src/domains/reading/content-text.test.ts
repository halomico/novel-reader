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

async function indexedForm(text: string): Promise<string> {
  const forms = await normalizeChineseSearchForms(text);
  return forms.hans ?? forms.original;
}

test("Chinese normalization uses one versioned NFKC and Traditional-to-Hans contract", async () => {
  assert.deepEqual(await normalizeChineseSearchForms("Ａ_龍門", "title"), {
    original: "a_龍門", hans: "a_龙门", version: CONTENT_NORMALIZATION_VERSION,
  });
  assert.deepEqual(await normalizeChineseSearchForms(" 修、仙！ ", "content"), {
    original: "修仙", hans: null, version: CONTENT_NORMALIZATION_VERSION,
  });
});

test("content blocks reconstruct the original text and partition its indexed form", async () => {
  const text = `甲😀龍${"　".repeat(60)}門乙`;
  const blocks = await collect(createContentBlocks(text, 2));
  assert.equal(blocks.map((block) => block.originalText).join(""), text);
  assert.equal(blocks.length, 33);
  blocks.forEach((block, index) => {
    assert.equal(block.blockNo, index);
    assert.equal(block.charStart, index === 0 ? 0 : blocks[index - 1].charEnd);
    assert.equal(block.charEnd, block.charStart + block.originalText.length);
  });
  const document = blocks.map((block) => block.searchText).join("");
  assert.equal(document, await indexedForm(text));
  assert.ok(document.includes("龙门"), "a word split by sixty spaces across many blocks is contiguous in the document");
});

test("every normalized character lands in exactly one block, including conversions that cross a boundary", async () => {
  // Phrase conversions give every output character the whole phrase's source range, so
  // a phrase straddling a boundary is the case a mismatched pair of bounds would copy
  // into both blocks. Several block sizes put boundaries inside every phrase here.
  const text = "臺灣的頭髮與著名的龍門客棧，裡面有許多隻貓。發現後來的變化。".repeat(12);
  const expected = await indexedForm(text);
  for (const size of [1, 2, 3, 5, 7, 64, 1_200]) {
    const blocks = await collect(createContentBlocks(text, size));
    assert.equal(blocks.map((block) => block.searchText).join(""), expected, `block size ${size}`);
  }
});

test("blocks carry only their own text: a document-level index needs no boundary context", async () => {
  const keyword = "一二三四五六七八九十壹贰叁肆伍";
  assert.equal(Array.from(keyword).length, MAX_CONTENT_KEYWORD_CHARS);
  const indexed = await indexedForm(keyword);
  const text = `${"甲".repeat(1_193)}${keyword}${"乙".repeat(1_200)}`;
  const blocks = await collect(createContentBlocks(text, 1_200));
  assert.deepEqual(blocks.map((block) => block.searchText.length), [1_200, 1_200, 8]);
  assert.ok(!blocks.some((block) => block.searchText.includes(indexed)), "no single block holds the straddling keyword");
  assert.ok(blocks.map((block) => block.searchText).join("").includes(indexed), "the document text does");
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
