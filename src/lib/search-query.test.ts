import assert from "node:assert/strict";
import test from "node:test";
import { matchesParsedSearchQuery, parseSearchQuery, parseSimpleAndSearchQuery } from "./search-query";

function validQuery(value: string, mode: "content" | "title" | "index" = "content") {
  const validation = parseSimpleAndSearchQuery(value, { mode });
  if (!validation.ok) throw new Error(validation.message);
  return validation.query;
}

test("single full-text keyword stays within the indexed 2 to 15 character bound", () => {
  assert.equal(parseSearchQuery("张").ok, false);
  assert.equal(parseSearchQuery("张三").ok, true);
  assert.equal(parseSearchQuery("一二三四五六七八九十一二三四五六").ok, false);
});

test("whitespace-separated keywords are deduplicated and all required", () => {
  const query = validQuery("张  三丰 张");
  assert.equal(query.syntax, "simple-and");
  assert.deepEqual(query.terms, ["张", "三丰"]);
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("武当真人名叫张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("张真人路过武当", query), false);
});

test("former expression operators are ordinary literal terms", () => {
  const query = validQuery("武当 OR 三丰");
  assert.deepEqual(query.terms, ["武当", "OR", "三丰"]);
  assert.equal(matchesParsedSearchQuery("武当 OR 三丰", query), true);
  assert.equal(matchesParsedSearchQuery("武当山上有三丰", query), false);

  const notQuery = validQuery("三丰 NOT 无忌");
  assert.equal(matchesParsedSearchQuery("三丰 NOT 无忌", notQuery), true);
  assert.equal(matchesParsedSearchQuery("三丰没有无忌", notQuery), false);
});

test("multi-keyword search permits one-character filters but requires a two-character anchor", () => {
  assert.equal(parseSearchQuery("张 王").ok, false);
  const query = validQuery("三丰 张 王");
  assert.equal(matchesParsedSearchQuery("张三丰遇到王重阳", query), true);
  assert.equal(matchesParsedSearchQuery("张三丰", query), false);
});

test("content punctuation is normalized while punctuation-only terms fail", () => {
  const query = validQuery("三，丰 张");
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("张三，丰", query), true);
  assert.equal(parseSearchQuery("！！！").ok, false);
  assert.equal(parseSearchQuery("三丰 ##").ok, false);
});

test("public search is bounded by term count, per-term length and aggregate length", () => {
  assert.equal(parseSimpleAndSearchQuery(Array.from({ length: 13 }, (_, index) => `词${index}`).join(" ")).ok, false);
  assert.equal(parseSearchQuery(`三丰 ${"田".repeat(16)}`).ok, false);
  assert.equal(parseSearchQuery("田".repeat(201), { mode: "title" }).ok, false);
});

test("title search preserves literal punctuation and supports one character", () => {
  assert.equal(parseSearchQuery("女", { mode: "title" }).ok, true);
  assert.equal(parseSearchQuery("女".repeat(31), { mode: "title" }).ok, false);
  const punctuation = validQuery("##", "title");
  assert.equal(matchesParsedSearchQuery("##给女王", punctuation), true);
  const keywords = validQuery("## OR (M系)", "title");
  assert.equal(matchesParsedSearchQuery("## OR (M系)被捕", keywords), true);
  assert.equal(matchesParsedSearchQuery("普通书名", keywords), false);
});

test("index search allows a one-character contains match and rejects symbols", () => {
  const query = validQuery("可", "index");
  assert.equal(matchesParsedSearchQuery("可爱女生", query), true);
  assert.equal(parseSearchQuery("！", { mode: "index" }).ok, false);
});

test("SQL-shaped input remains bounded literal text without control syntax", () => {
  const query = validQuery("三丰 DROP TABLE users");
  assert.deepEqual(query.terms, ["三丰", "DROP", "TABLE", "users"]);
  assert.equal(matchesParsedSearchQuery("三丰 DROP TABLE users", query), true);
  assert.equal(matchesParsedSearchQuery("张三丰 普通内容", query), false);
});
