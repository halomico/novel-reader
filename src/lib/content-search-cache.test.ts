import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("bounds, expires, clones, and invalidates cached content search results", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-search-cache-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSearchPath = process.env.CONTENT_SEARCH_DB_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const databasePath = path.join(root, "novels.db");
  process.env.DATABASE_PATH = databasePath;
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");

  let db: DatabaseSync | undefined;
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const { getDb } = await import("./db");
    const {
      SEARCH_RESULT_CACHE_TTL_MS,
      getCachedContentSearchResults,
      getContentSearchCacheVersion,
      hasCachedContentSearchResults,
      invalidateContentSearchResultCache,
      setCachedContentSearchResults,
    } = await import("./content-search-cache");
    const { parseSearchQuery } = await import("./search-query");
    db = getDb();

    const parsed = parseSearchQuery("缓存测试");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    setCachedContentSearchResults(parsed.query, [{ novelId: 1, title: "原始标题", segmentIndex: 0, snippet: "缓存正文" }]);
    assert.equal(hasCachedContentSearchResults(parsed.query), true);
    const firstRead = getCachedContentSearchResults(parsed.query)!;
    firstRead[0].title = "外部修改";
    assert.equal(getCachedContentSearchResults(parsed.query)?.[0].title, "原始标题");
    setCachedContentSearchResults(
      parsed.query,
      [{ novelId: 2, title: "标签范围", segmentIndex: 0, snippet: "缓存正文" }],
      undefined,
      "advanced:scope-a",
    );
    assert.equal(getCachedContentSearchResults(parsed.query, "advanced:scope-a")?.[0].title, "标签范围");
    assert.equal(getCachedContentSearchResults(parsed.query)?.[0].title, "原始标题");

    now += SEARCH_RESULT_CACHE_TTL_MS + 1;
    assert.equal(getCachedContentSearchResults(parsed.query), null);
    now += 1;

    setCachedContentSearchResults(parsed.query, [{ novelId: 1, title: "待失效", segmentIndex: 0, snippet: "缓存正文" }]);
    const externalDb = new DatabaseSync(databasePath);
    externalDb.exec("CREATE TABLE cache_external_change (id INTEGER PRIMARY KEY)");
    externalDb.close();
    assert.equal(getCachedContentSearchResults(parsed.query), null);

    invalidateContentSearchResultCache();
    const staleVersion = getContentSearchCacheVersion();
    invalidateContentSearchResultCache();
    setCachedContentSearchResults(
      parsed.query,
      [{ novelId: 1, title: "陈旧结果", segmentIndex: 0, snippet: "缓存正文" }],
      staleVersion,
    );
    assert.equal(hasCachedContentSearchResults(parsed.query), false);

    const queries = [];
    for (let index = 0; index < 33; index += 1) {
      const query = parseSearchQuery(`缓存词${index}`);
      assert.equal(query.ok, true);
      if (!query.ok) continue;
      queries.push(query.query);
      setCachedContentSearchResults(query.query, [{ novelId: index + 1, title: `标题${index}`, segmentIndex: 0, snippet: "正文" }]);
    }
    assert.equal(getCachedContentSearchResults(queries[0]), null);
    assert.equal(hasCachedContentSearchResults(queries.at(-1)!), true);

    invalidateContentSearchResultCache();
    setCachedContentSearchResults(parsed.query, [
      { novelId: 1, title: "过大结果", segmentIndex: 0, snippet: "x".repeat(2 * 1024 * 1024) },
    ]);
    assert.equal(hasCachedContentSearchResults(parsed.query), false);
  } finally {
    Date.now = realNow;
    db?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    delete (globalThis as typeof globalThis & { novelReaderSearchResultCache?: unknown }).novelReaderSearchResultCache;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSearchPath === undefined) delete process.env.CONTENT_SEARCH_DB_PATH;
    else process.env.CONTENT_SEARCH_DB_PATH = previousSearchPath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
