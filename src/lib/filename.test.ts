import assert from "node:assert/strict";
import test from "node:test";
import { isNovelTextFile, parseNovelTitle } from "./filename";

test("parses plain novel filenames", () => {
  assert.equal(parseNovelTitle("凡人修仙传.txt"), "凡人修仙传");
});

test("ignores numeric prefix before underscore", () => {
  assert.equal(parseNovelTitle("12345_诡秘之主.txt"), "诡秘之主");
});

test("keeps nonmatching numbers as title content", () => {
  assert.equal(parseNovelTitle("2026年故事.txt"), "2026年故事");
});

test("detects txt files case-insensitively", () => {
  assert.equal(isNovelTextFile("小说.TXT"), true);
  assert.equal(isNovelTextFile("小说.epub"), false);
});
