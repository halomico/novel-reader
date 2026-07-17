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
    assert.equal(count.count, 108);
  } finally {
    closeDatabase?.();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
