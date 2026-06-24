import assert from "node:assert/strict";
import test from "node:test";
import { matchesParsedSearchQuery, parseSearchQuery } from "./search-query";

function validQuery(value: string) {
  const validation = parseSearchQuery(value);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return validation.query;
}

test("single keyword must be 2 to 15 chars", () => {
  assert.equal(parseSearchQuery("张").ok, false);
  assert.equal(parseSearchQuery("张三").ok, true);
  assert.equal(parseSearchQuery("一二三四五六七八九十一二三四五六").ok, false);
});

test("space separated terms default to AND", () => {
  const query = validQuery("张 三丰");
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("武当真人名叫张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("张真人路过武当", query), false);
});

test("OR terms need a required anchor", () => {
  assert.equal(parseSearchQuery("张 OR 三丰").ok, false);

  const query = validQuery("武当 (张 OR 三丰)");
  assert.equal(query.anchorTerm, "武当");
  assert.equal(matchesParsedSearchQuery("武当山上有张真人", query), true);
  assert.equal(matchesParsedSearchQuery("武当山上有宋远桥", query), false);
});

test("plus marks a required term across OR branches", () => {
  const query = validQuery("+武当 张 OR 三丰");
  assert.equal(query.anchorTerm, "武当");
  assert.equal(matchesParsedSearchQuery("武当山上有三丰", query), true);
  assert.equal(matchesParsedSearchQuery("山上有三丰", query), false);
});

test("NOT is equivalent to minus", () => {
  const notQuery = validQuery("三丰 NOT 无忌");
  const minusQuery = validQuery("三丰 -无忌");

  assert.equal(matchesParsedSearchQuery("张三丰在武当", notQuery), true);
  assert.equal(matchesParsedSearchQuery("张三丰和张无忌", notQuery), false);
  assert.equal(matchesParsedSearchQuery("张三丰在武当", minusQuery), true);
  assert.equal(matchesParsedSearchQuery("张三丰和张无忌", minusQuery), false);
});

test("multi keyword allows one-char filters but requires a two-char AND anchor", () => {
  assert.equal(parseSearchQuery("张 -王").ok, false);

  const query = validQuery("三丰 张 -王");
  assert.equal(matchesParsedSearchQuery("张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("王三丰", query), false);
});

test("operators are case-insensitive and support quoted exclusions", () => {
  const lowerNotQuery = validQuery("三丰 not \"无 忌\"");
  const minusPhraseQuery = validQuery("三丰 -\"无 忌\"");

  assert.equal(matchesParsedSearchQuery("张三丰在武当", lowerNotQuery), true);
  assert.equal(matchesParsedSearchQuery("张三丰和张无，忌", lowerNotQuery), true);
  assert.equal(matchesParsedSearchQuery("张三丰和张无 忌", lowerNotQuery), false);
  assert.equal(matchesParsedSearchQuery("张三丰在武当", minusPhraseQuery), true);
  assert.equal(matchesParsedSearchQuery("张三丰和张无 忌", minusPhraseQuery), false);
});

test("quoted phrases are exact AND filters and cannot be content anchors", () => {
  assert.equal(parseSearchQuery("\"你 好\"").ok, false);
  assert.equal(parseSearchQuery("三丰 OR \"你 好\"").ok, false);

  const query = validQuery("三丰 \"你 好\"");
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("张三丰说你 好", query), true);
  assert.equal(matchesParsedSearchQuery("张三丰说你，好", query), false);
  assert.equal(matchesParsedSearchQuery("张三丰说你好", query), false);
  assert.equal(matchesParsedSearchQuery("张三丰没有说那句话", query), false);
});

test("nested operators can contain quoted phrases", () => {
  const query = validQuery("武当 (三丰 OR 张) NOT \"无 忌\"");
  assert.equal(matchesParsedSearchQuery("武当山有张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("武当山有张无 忌", query), false);
  assert.equal(matchesParsedSearchQuery("武当山有张无，忌", query), true);
});

test("punctuation is ignored and cannot be searched alone", () => {
  assert.equal(parseSearchQuery("！！！").ok, false);

  const query = validQuery("三，丰 张");
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("张三丰", query), true);
  assert.equal(matchesParsedSearchQuery("张三，丰", query), true);
});

test("multi keyword effective length is limited to 200 chars", () => {
  const longTerm = "田".repeat(201);
  assert.equal(parseSearchQuery(`三丰 "${longTerm}"`).ok, false);
});

test("title search can match punctuation and quoted operators", () => {
  assert.equal(parseSearchQuery("女", { mode: "title" }).ok, true);
  assert.equal(parseSearchQuery("女".repeat(31), { mode: "title" }).ok, false);

  const punctuationQuery = parseSearchQuery("##", { mode: "title" });
  assert.equal(punctuationQuery.ok, true);
  assert.equal(punctuationQuery.ok && matchesParsedSearchQuery("##给女王", punctuationQuery.query), true);

  const titleQuery = parseSearchQuery("## OR \"(M系\"", { mode: "title" });
  assert.equal(titleQuery.ok, true);
  assert.equal(titleQuery.ok && matchesParsedSearchQuery("(M系)被捕", titleQuery.query), true);
  assert.equal(titleQuery.ok && matchesParsedSearchQuery("普通书名", titleQuery.query), false);
});

test("index search supports one-char contains matching and ignores symbols", () => {
  const singleQuery = parseSearchQuery("可", { mode: "index" });
  assert.equal(singleQuery.ok, true);
  assert.equal(singleQuery.ok && matchesParsedSearchQuery("可爱女生", singleQuery.query), true);
  assert.equal(parseSearchQuery("！", { mode: "index" }).ok, false);
  assert.equal(parseSearchQuery("可".repeat(31), { mode: "index" }).ok, false);
});

test("content search rejects punctuation-only terms before SQL", () => {
  assert.equal(parseSearchQuery("##").ok, false);
  assert.equal(parseSearchQuery("%_").ok, false);
});

test("SQL-shaped input is parsed as text, not executable syntax", () => {
  const query = validQuery("三丰 \"%' OR 1=1 --\"");
  assert.equal(query.anchorTerm, "三丰");
  assert.equal(matchesParsedSearchQuery("张三丰 %' OR 1=1 --", query), true);
  assert.equal(matchesParsedSearchQuery("张三丰 普通内容", query), false);
});
