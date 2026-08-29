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
  listNovelsByTagIntersection,
  listNovelIdsByTagFilters,
  listTagGroups,
  listTagsForNovel,
  listTagsForNovels,
  parseHotwordInput,
  setNovelHotwords,
  setNovelTags,
  updateTag,
} from "./tags";

function resetDb() {
  const globalState = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  globalState.novelReaderDb?.close();
  delete globalState.novelReaderDb;
}

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-tags-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  resetDb();
  t.after(() => {
    resetDb();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
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
  const child = createTag({
    name: "奇幻",
    slug: "fantasy",
    parentId: group.id,
    aliases: "幻想、 奇幻、Fantasy\n幻想",
    description: "包含幻想世界与超自然元素。",
    sortOrder: 2,
  });

  assert.equal(setNovelTags(novelId, [child.id]), 1);
  assert.deepEqual(listTagsForNovel(novelId).map((tag) => tag.name), ["奇幻"]);
  assert.deepEqual(listTagsForNovel(novelId)[0].aliases, ["幻想", "Fantasy"]);

  const groups = listTagGroups();
  assert.equal(groups[0].group?.name, "题材");
  assert.equal(groups[0].tags[0].name, "奇幻");
  assert.equal(groups[0].tags[0].directCount, 1);

  const tagged = listNovelsByTag(child.id);
  assert.equal(tagged.totalBooks, 1);
  assert.equal(tagged.books[0].id, novelId);
});

test("sorts and samples a tag through its compound index", (t) => {
  withTempDatabase(t);
  const zuluId = seedNovel("Zulu Story");
  const alphaId = seedNovel("Alpha Story");
  const middleId = seedNovel("Middle Story");
  getDb().prepare("UPDATE novels SET mtime_ms = ?, word_count = ? WHERE id = ?").run(30, 100, zuluId);
  getDb().prepare("UPDATE novels SET mtime_ms = ?, word_count = ? WHERE id = ?").run(10, 300, alphaId);
  getDb().prepare("UPDATE novels SET mtime_ms = ?, word_count = ? WHERE id = ?").run(20, 200, middleId);
  const tag = createTag({ name: "排序测试", slug: "sorted-tag" });
  setNovelTags(zuluId, [tag.id]);
  setNovelTags(alphaId, [tag.id]);
  setNovelTags(middleId, [tag.id]);

  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "updated" }).books.map((book) => book.id),
    [zuluId, middleId, alphaId],
  );
  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "updated", sortOrder: "asc" }).books.map((book) => book.id),
    [alphaId, middleId, zuluId],
  );
  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "name" }).books.map((book) => book.id),
    [alphaId, middleId, zuluId],
  );
  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "name", sortOrder: "desc" }).books.map((book) => book.id),
    [zuluId, middleId, alphaId],
  );
  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "words" }).books.map((book) => book.id),
    [alphaId, middleId, zuluId],
  );
  assert.deepEqual(
    listNovelsByTag(tag.id, { sortBy: "words", sortOrder: "asc" }).books.map((book) => book.id),
    [zuluId, middleId, alphaId],
  );

  const firstRandom = listNovelsByTag(tag.id, { randomSeed: "stable-seed", pageSize: 2 });
  const secondRandom = listNovelsByTag(tag.id, { randomSeed: "stable-seed", pageSize: 2 });
  assert.equal(firstRandom.totalBooks, 3);
  assert.equal(firstRandom.totalPages, 1);
  assert.equal(new Set(firstRandom.books.map((book) => book.id)).size, 2);
  assert.deepEqual(firstRandom.books.map((book) => book.id), secondRandom.books.map((book) => book.id));

  const randomQueryPlan = getDb().prepare(
    `EXPLAIN QUERY PLAN
     SELECT n.id
     FROM novel_tags nt
     INNER JOIN novels n ON n.id = nt.novel_id
     WHERE nt.tag_id = ? AND nt.novel_id >= ?
     ORDER BY nt.novel_id ASC
     LIMIT ?`,
  ).all(tag.id, 0, 2) as Array<{ detail: string }>;
  const sortedQueryPlan = getDb().prepare(
    `EXPLAIN QUERY PLAN
     SELECT n.id
     FROM novels n
     INNER JOIN novel_tags nt ON nt.novel_id = n.id
     WHERE nt.tag_id = ?
     ORDER BY n.mtime_ms DESC, n.id DESC
     LIMIT ? OFFSET ?`,
  ).all(tag.id, 2, 0) as Array<{ detail: string }>;
  assert.match(randomQueryPlan.map((row) => row.detail).join("\n"), /idx_novel_tags_tag/);
  assert.match(sortedQueryPlan.map((row) => row.detail).join("\n"), /idx_novel_tags_tag/);
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
  const memberTag = createTag({ name: "内板", slug: "member", visibility: "member" });
  const hiddenTag = createTag({ name: "隐藏", slug: "hidden", isVisible: false });
  setNovelTags(firstNovelId, [visibleTag.id, memberTag.id, hiddenTag.id]);
  setNovelTags(secondNovelId, [visibleTag.id]);

  const visible = listTagsForNovels([firstNovelId, secondNovelId, firstNovelId, 0]);
  assert.deepEqual(visible.get(firstNovelId)?.map((tag) => tag.name), ["冒险"]);
  assert.deepEqual(visible.get(secondNovelId)?.map((tag) => tag.name), ["冒险"]);
  assert.deepEqual(
    listTagsForNovels([firstNovelId], { audience: "member" }).get(firstNovelId)?.map((tag) => tag.name),
    ["内板", "冒险"],
  );
  assert.deepEqual(
    listTagsForNovels([firstNovelId], { includeHidden: true }).get(firstNovelId)?.map((tag) => tag.name),
    ["内板", "冒险", "隐藏"],
  );
});

test("keeps child tag visibility within its parent boundary", (t) => {
  withTempDatabase(t);
  const memberGroup = createTag({ name: "内板分组", slug: "member-group", visibility: "member" });
  const child = createTag({ name: "子标签", slug: "member-child", parentId: memberGroup.id, visibility: "public" });
  assert.equal(child.visibility, "member");
  assert.equal(listTagGroups({ audience: "public" }).length, 0);
  assert.equal(listTagGroups({ audience: "member" })[0].tags[0].slug, "member-child");
  assert.equal(updateTag({ ...memberGroup, visibility: "hidden" }), true);
  assert.equal(listTagGroups({ audience: "member" }).length, 0);
  assert.equal(listTagGroups({ audience: "admin" })[0].tags[0].visibility, "hidden");
});

test("finds novels containing the intersection of selected visible tags", (t) => {
  withTempDatabase(t);
  const alphaId = seedNovel("Alpha Story");
  const betaId = seedNovel("Beta Story");
  const singleId = seedNovel("Single Story");
  const archiveSourceId = Number(getDb().prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES (?, ?, ?)",
  ).run("archive", "归档书库", "archive").lastInsertRowid);
  getDb().prepare("UPDATE novels SET source_id = ? WHERE id = ?").run(archiveSourceId, betaId);
  const fantasy = createTag({ name: "奇幻", slug: "fantasy" });
  const adventure = createTag({ name: "冒险", slug: "adventure" });
  const academy = createTag({ name: "学院", slug: "academy" });
  const hidden = createTag({ name: "隐藏", slug: "hidden", isVisible: false });

  setNovelTags(alphaId, [fantasy.id, adventure.id]);
  setNovelTags(betaId, [fantasy.id, adventure.id, academy.id]);
  setNovelTags(singleId, [fantasy.id, hidden.id]);

  const firstPage = listNovelsByTagIntersection([fantasy.id, adventure.id, fantasy.id], { pageSize: 1 });
  assert.equal(firstPage.totalBooks, 2);
  assert.equal(firstPage.totalPages, 2);
  assert.deepEqual(firstPage.books.map((book) => book.title), ["Alpha Story"]);

  const secondPage = listNovelsByTagIntersection([fantasy.id, adventure.id], { page: 2, pageSize: 1 });
  assert.deepEqual(secondPage.books.map((book) => book.title), ["Beta Story"]);

  const titleFiltered = listNovelsByTagIntersection([fantasy.id, adventure.id], { q: " beta " });
  assert.deepEqual(titleFiltered.books.map((book) => book.id), [betaId]);
  assert.equal(titleFiltered.query, "beta");

  const titleOnly = listNovelsByTagIntersection([], { q: " beta " });
  assert.deepEqual(titleOnly.books.map((book) => book.id), [betaId]);
  assert.deepEqual(listNovelIdsByTagFilters([], { q: "alpha" }), [alphaId]);
  assert.deepEqual(listNovelsByTagIntersection([], { sourceId: archiveSourceId }).books.map((book) => book.id), [betaId]);
  assert.deepEqual(listNovelIdsByTagFilters([fantasy.id], { sourceId: archiveSourceId }), [betaId]);

  const hiddenIntersection = listNovelsByTagIntersection([fantasy.id, hidden.id]);
  assert.equal(hiddenIntersection.totalBooks, 0);

  const singleTag = listNovelsByTagIntersection([fantasy.id], { excludeTagIds: [adventure.id] });
  assert.deepEqual(singleTag.books.map((book) => book.id), [singleId]);
  assert.deepEqual(listNovelIdsByTagFilters([fantasy.id], { excludeTagIds: [academy.id] }), [alphaId, singleId]);
  assert.deepEqual(listNovelIdsByTagFilters([], { excludeTagIds: [adventure.id] }), [singleId]);
});
