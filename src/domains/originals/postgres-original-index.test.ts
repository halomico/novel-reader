import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_NORMALIZATION_VERSION } from "@/domains/reading/content-text";
import { createPostgresOriginalSearchFields } from "./postgres-original-index";

test("original search fields share deterministic traditional and simplified forms", async () => {
  const fields = await createPostgresOriginalSearchFields("Ａ_龍門", " 修、仙！ ", "龍門 後篇");
  assert.equal(fields.titleSearchOriginal, "a_龍門");
  assert.equal(fields.titleSearchHans, "a_龙门");
  assert.equal(fields.contentSearchOriginal, "修仙龍門後篇");
  assert.equal(fields.contentSearchHans, "修仙龙门后篇");
  assert.equal(fields.normalizationVersion, CONTENT_NORMALIZATION_VERSION);
});

test("original search fields reject invalid PostgreSQL text", async () => {
  await assert.rejects(createPostgresOriginalSearchFields("标题", "正文\0", ""), /valid Unicode/);
});
