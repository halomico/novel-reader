import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("records normalized search queries and aggregates hot terms by range", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-search-analytics-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "settings.json");
  fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ analyticsEnabled: true }));
  let closeDatabase: (() => void) | null = null;

  try {
    const analytics = await import("./analytics");
    const { getDb } = await import("./db");
    const db = getDb();
    closeDatabase = () => db.close();

    analytics.recordSearchQuery("  修仙   系统  ", "content");
    analytics.recordSearchQuery("修仙 系统", "title");
    analytics.recordSearchQuery("科幻", "content");

    const overview = analytics.getAnalyticsOverview("24h");
    assert.equal(overview.totalSearches, 3);
    assert.deepEqual(overview.topSearchQueries.slice(0, 2), [
      { label: "修仙 系统", count: 2 },
      { label: "科幻", count: 1 },
    ]);
    const savedRows = db
      .prepare("SELECT query, mode FROM search_query_events ORDER BY id")
      .all() as Array<{ query: string; mode: string }>;
    assert.deepEqual(
      savedRows.map((row) => ({ ...row })),
      [
        { query: "修仙 系统", mode: "content" },
        { query: "修仙 系统", mode: "title" },
        { query: "科幻", mode: "content" },
      ],
    );

    const tag = db
      .prepare("INSERT INTO tags (name, slug) VALUES ('科幻', 'science-fiction')")
      .run();
    const analyticsHeaders = new Headers({
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "127.0.0.1",
    });
    analytics.recordAnalyticsEvent({
      headers: analyticsHeaders,
      eventType: "tag_click",
      path: "/tags/science-fiction",
      tagId: Number(tag.lastInsertRowid),
    });
    analytics.recordAnalyticsEvent({
      headers: analyticsHeaders,
      eventType: "tag_click",
      path: "/tags/science-fiction",
      tagId: Number(tag.lastInsertRowid),
    });
    const tagOverview = analytics.getAnalyticsOverview("24h");
    assert.equal(tagOverview.tagTotal, 1);
    assert.deepEqual(tagOverview.topTags, [{ label: "科幻", count: 2 }]);

    const novel = db
      .prepare(
        `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms)
         VALUES ('测试小说', 'test.txt', 'test.txt', 10, 1)`,
      )
      .run();
    const secondNovel = db
      .prepare(
        `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms)
         VALUES ('第二本小说', 'second.txt', 'second.txt', 10, 1)`,
      )
      .run();
    const eventKey = analytics.recordSearchQuery("修仙 系统", "title", {
      source: "header_title",
      originNovelId: Number(novel.lastInsertRowid),
    });
    assert.ok(eventKey);
    assert.equal(analytics.updateSearchQueryResults(eventKey, 12, 7), true);
    assert.equal(analytics.recordSearchResultClick(eventKey, Number(novel.lastInsertRowid)), true);
    assert.equal(analytics.recordSearchResultClick(eventKey, Number(secondNovel.lastInsertRowid)), true);
    const details = analytics.getSearchQueryDetails("修仙 系统", "24h");
    assert.ok(details);
    assert.equal(details.totalSearches, 3);
    assert.equal(details.totalResults, 12);
    assert.equal(details.totalResultNovels, 7);
    assert.equal(details.clickedSearches, 1);
    assert.equal(details.totalClicks, 2);
    assert.deepEqual(details.terms, ["修仙", "系统"]);
    assert.equal(details.events[0].source, "header_title");
    assert.equal(details.events[0].clickCount, 2);
    assert.equal(details.events[0].lastClickedNovelTitle, "第二本小说");

    const insertTerm = db.prepare("INSERT INTO search_query_events (query, mode) VALUES (?, 'content')");
    for (let index = 0; index < 105; index += 1) {
      insertTerm.run(`分页热词 ${String(index).padStart(3, "0")}`);
    }
    const secondPage = analytics.getAnalyticsOverview("24h", {
      searchQueryPage: 2,
      searchQueryPageSize: 100,
    });
    assert.equal(secondPage.searchQueryTotal, 107);
    assert.equal(secondPage.searchQueryTotalPages, 2);
    assert.equal(secondPage.searchQueryPage, 2);
    assert.equal(secondPage.topSearchQueries.length, 7);

    fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ analyticsEnabled: false }));
    analytics.recordSearchQuery("不会写入", "content");
    const count = db.prepare("SELECT COUNT(*) AS count FROM search_query_events").get() as { count: number };
    assert.equal(count.count, 109);
  } finally {
    closeDatabase?.();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
