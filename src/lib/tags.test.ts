import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  createTag,
  listHotwordsForNovel,
  listNovelsByTag,
  listTagGroups,
  listTagsForNovel,
  listTagsForNovels,
  parseHotwordInput,
  setNovelHotwords,
  setNovelTags,
} from "./tags";

function resetDb() {
  const globalState = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  globalState.novelReaderDb?.close();
  delete globalState.novelReaderDb;
}

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSearchPath = process.env.CONTENT_SEARCH_DB_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-tags-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");
  resetDb();
  t.after(() => {
    resetDb();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSearchPath === undefined) delete process.env.CONTENT_SEARCH_DB_PATH;
    else process.env.CONTENT_SEARCH_DB_PATH = previousSearchPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function seedNovel(title = "测试小说"): number {
  const result = getDb()
    .prepare(
      `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(title, `${title}.txt`, `${title}.txt`, 100, 1);
  return Number(result.lastInsertRowid);
}

test("stores grouped tags and lists novels by tag", (t) => {
  withTempDatabase(t);
  const novelId = seedNovel();
  const group = createTag({ name: "题材", slug: "topic", sortOrder: 1 });
  const child = createTag({ name: "奇幻", slug: "fantasy", parentId: group.id, sortOrder: 2 });

  assert.equal(setNovelTags(novelId, [child.id]), 1);
  assert.deepEqual(listTagsForNovel(novelId).map((tag) => tag.name), ["奇幻"]);

  const groups = listTagGroups();
  assert.equal(groups[0].group?.name, "题材");
  assert.equal(groups[0].tags[0].name, "奇幻");
  assert.equal(groups[0].tags[0].directCount, 1);

  const tagged = listNovelsByTag(child.id);
  assert.equal(tagged.totalBooks, 1);
  assert.equal(tagged.books[0].id, novelId);
});

test("deduplicates and stores manual hotwords", (t) => {
  withTempDatabase(t);
  const novelId = seedNovel("热词小说");
  const hotwords = parseHotwordInput("魔法\n魔法，学院、骑士");

  assert.deepEqual(hotwords, ["魔法", "学院", "骑士"]);
  assert.equal(setNovelHotwords(novelId, hotwords), 3);
  assert.deepEqual(listHotwordsForNovel(novelId), ["魔法", "学院", "骑士"]);
  assert.throws(() => parseHotwordInput("这是一个长度明显超过十五个字的热词"));
});

test("loads visible tags for a catalog page in one batch", (t) => {
  withTempDatabase(t);
  const firstNovelId = seedNovel("第一本");
  const secondNovelId = seedNovel("第二本");
  const visibleTag = createTag({ name: "冒险", slug: "adventure" });
  const hiddenTag = createTag({ name: "隐藏", slug: "hidden", isVisible: false });
  setNovelTags(firstNovelId, [visibleTag.id, hiddenTag.id]);
  setNovelTags(secondNovelId, [visibleTag.id]);

  const visible = listTagsForNovels([firstNovelId, secondNovelId, firstNovelId, 0]);
  assert.deepEqual(visible.get(firstNovelId)?.map((tag) => tag.name), ["冒险"]);
  assert.deepEqual(visible.get(secondNovelId)?.map((tag) => tag.name), ["冒险"]);
  assert.deepEqual(listTagsForNovels([firstNovelId], { includeHidden: true }).get(firstNovelId)?.map((tag) => tag.name), ["冒险", "隐藏"]);
});
