import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_NORMALIZATION_VERSION,
  MAX_NORMALIZED_CONTENT_QUERY_CHARS,
  createContentBlocks,
  normalizeChineseSearchForms,
  normalizeContentQueryTerm,
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

test("content normalization rejects invalid Unicode and oversized terms", async () => {
  await assert.rejects(normalizeChineseSearchForms("a\0b"), /valid Unicode/);
  await assert.rejects(normalizeChineseSearchForms("\ud800"), /valid Unicode/);
  await assert.rejects(normalizeContentQueryTerm("甲".repeat(MAX_NORMALIZED_CONTENT_QUERY_CHARS + 1)), /1–50/);
});
