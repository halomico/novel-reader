import assert from "node:assert/strict";
import test from "node:test";
import iconv from "iconv-lite";
import { decodeNovelBuffer } from "./text";

test("keeps a literal replacement character in valid UTF-8", () => {
  assert.equal(decodeNovelBuffer(Buffer.from("前文\uFFFD后文\r\n", "utf8")), "前文\uFFFD后文\n");
});

test("decodes non-UTF-8 Chinese text as GB18030", () => {
  assert.equal(decodeNovelBuffer(iconv.encode("中文正文\r\n", "gb18030")), "中文正文\n");
});
