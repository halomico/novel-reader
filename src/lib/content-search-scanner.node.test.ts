import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import iconv from "iconv-lite";
import { getRipgrepPath } from "./config";
import {
  buildRipgrepAnchorPattern,
  createRipgrepSearchArgs,
  normalizeRipgrepRelativePath,
  scanContentCandidatePaths,
} from "./content-search-scanner.node";

test("builds a Unicode pattern with the same punctuation-insensitive anchor semantics", () => {
  const pattern = buildRipgrepAnchorPattern("张三丰");
  const regex = new RegExp(pattern, "iu");

  assert.equal(regex.test("张，三 丰"), true);
  assert.equal(regex.test("张无忌"), false);
  assert.equal(normalizeRipgrepRelativePath(".\\folder\\book.txt"), "folder/book.txt");
  assert.ok(createRipgrepSearchArgs("张三丰", "auto").includes("--threads=1"));
});

test("finds UTF-8 and GB18030 candidate files before Node verification", async (context) => {
  const executable = getRipgrepPath();
  const probe = spawnSync(executable, ["--version"], { windowsHide: true });
  if (probe.error || probe.status !== 0) {
    context.skip("ripgrep is not installed in this test environment");
    return;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "novel-content-search-"));
  try {
    await fs.writeFile(path.join(directory, "utf8.txt"), "开头 张，\n三 丰 结尾", "utf8");
    await fs.writeFile(path.join(directory, "gb18030.txt"), iconv.encode("开头 张三丰 结尾", "gb18030"));
    await fs.writeFile(path.join(directory, "miss.txt"), "开头 张无忌 结尾", "utf8");

    const result = await scanContentCandidatePaths(directory, "张三丰");
    assert.ok(result);
    assert.deepEqual(Array.from(result.relativePaths).sort(), ["gb18030.txt", "utf8.txt"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
