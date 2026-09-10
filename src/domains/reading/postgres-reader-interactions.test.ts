import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  getPostgresNovelInteractionState,
  listPostgresNovelFavoritesPage,
  postgresGroveStage,
  recordPostgresNovelView,
  removePostgresNovelFavorites,
  togglePostgresNovelFavorite,
  togglePostgresNovelGrove,
  unlockPostgresNovelWithSoda,
} from "./postgres-reader-interactions";

function executorQueue(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return {
        command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

function transactionWith(executor: SqlExecutor) {
  return async <T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> => operation(executor);
}

test("PostgreSQL novel interaction state is one bounded query", async () => {
  const captured: SqlQuery[] = [];
  const state = await getPostgresNovelInteractionState(executorQueue([{
    rows: [{ exists: true, favorite: true, visit_count: "10" }],
  }], captured), 4, 7);
  assert.deepEqual(state, { exists: true, favorite: true, planted: true, visitCount: 10, stage: "tree" });
  assert.deepEqual(captured[0].values, [4, 7]);
  assert.match(captured[0].text, /user_novel_favorites[\s\S]*user_novel_grove/u);
  assert.equal(postgresGroveStage(2), "seed");
  assert.equal(postgresGroveStage(3), "sprout");
});

test("favorite and grove toggles serialize per resource and never rely on read-then-write races", async () => {
  const favoriteQueries: SqlQuery[] = [];
  const favorite = await togglePostgresNovelFavorite(2, 9, transactionWith(executorQueue([
    { rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 },
  ], favoriteQueries)));
  assert.deepEqual(favorite, { ok: true, favorite: true });
  assert.match(favoriteQueries[0].text, /pg_advisory_xact_lock/u);
  assert.match(favoriteQueries[2].text, /ON CONFLICT \(user_id, novel_id\) DO NOTHING/u);

  const groveQueries: SqlQuery[] = [];
  const grove = await togglePostgresNovelGrove(2, 9, transactionWith(executorQueue([
    { rowCount: 1 }, { rowCount: 0 }, { rows: [{ visit_count: "0" }] },
  ], groveQueries)));
  assert.deepEqual(grove, { ok: true, planted: true, visitCount: 0, stage: "seed" });
  assert.match(groveQueries[2].text, /RETURNING visit_count/u);
});

test("PostgreSQL favorite listing returns page metadata and items in one bounded query", async () => {
  const captured: SqlQuery[] = [];
  const page = await listPostgresNovelFavoritesPage(executorQueue([{
    rows: [{
      total_items: "2", total_pages: "1", page: "1", id: 12, title: "十二",
      storage_mode: "chapters", chapter_count: 8, soda_price: 3, word_count: 12000,
      mtime_ms: "1720000000000", updated_at: "2026-09-08T00:00:00.000Z",
    }, {
      total_items: "2", total_pages: "1", page: "1", id: 9, title: "九",
      storage_mode: "single", chapter_count: 0, soda_price: 0, word_count: 8000,
      mtime_ms: "1710000000000", updated_at: new Date("2026-09-07T00:00:00.000Z"),
    }],
  }], captured), 4, { page: 99, pageSize: 50 });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].values, [4, 99, 50]);
  assert.match(captured[0].text, /LEFT JOIN LATERAL/u);
  assert.match(captured[0].text, /ORDER BY f\.created_at DESC, f\.novel_id DESC/u);
  assert.deepEqual(page, {
    items: [{
      id: 12, title: "十二", storageMode: "chapters", chapterCount: 8,
      sodaPrice: 3, wordCount: 12000, mtimeMs: 1720000000000,
      updatedAt: "2026-09-08T00:00:00.000Z",
    }, {
      id: 9, title: "九", storageMode: "single", chapterCount: 0,
      sodaPrice: 0, wordCount: 8000, mtimeMs: 1710000000000,
      updatedAt: "2026-09-07T00:00:00.000Z",
    }],
    page: 1, pageSize: 50, totalItems: 2, totalPages: 1,
  });
});

test("PostgreSQL favorite batch removal is deduplicated, bounded and parameterized", async () => {
  const captured: SqlQuery[] = [];
  const removed = await removePostgresNovelFavorites(
    executorQueue([{ rowCount: 2 }], captured),
    7,
    [11, 11, 12],
  );
  assert.equal(removed, 2);
  assert.deepEqual(captured[0].values, [7, [11, 12]]);
  assert.match(captured[0].text, /novel_id = ANY\(\$2::integer\[\]\)/u);
  await assert.rejects(
    removePostgresNovelFavorites(executorQueue([], []), 7, [0]),
    /favorite novel id/u,
  );
  assert.equal(await removePostgresNovelFavorites(executorQueue([], []), 7, []), 0);
});

test("PostgreSQL novel unlock locks the account and commits debit, entitlement and ledger together", async () => {
  const captured: SqlQuery[] = [];
  const result = await unlockPostgresNovelWithSoda(5, 8, transactionWith(executorQueue([
    { rows: [{ status: "active", role: "user", soda_balance: "20" }] },
    { rows: [{ source_id: 3, access_mode: "soda", soda_price: 7 }] },
    { rows: [{ allowed: false }] },
    { rows: [{ soda_balance: "13" }] },
    { rowCount: 1 },
    { rowCount: 1 },
  ], captured)));
  assert.deepEqual(result, { ok: true, charged: true, sodaBalance: 13 });
  assert.match(captured[0].text, /FOR UPDATE/u);
  assert.match(captured[2].text, /resource_type = 'novel_source'/u);
  assert.match(captured[3].text, /soda_balance >= \$2[\s\S]*RETURNING soda_balance/u);
  assert.match(captured[4].text, /ON CONFLICT[\s\S]*rights/u);
  assert.match(captured[5].text, /user_currency_transactions/u);
});

test("an existing PostgreSQL entitlement makes novel unlock idempotent without another debit", async () => {
  const captured: SqlQuery[] = [];
  const result = await unlockPostgresNovelWithSoda(5, 8, transactionWith(executorQueue([
    { rows: [{ status: "active", role: "user", soda_balance: "20" }] },
    { rows: [{ source_id: null, access_mode: "soda", soda_price: 7 }] },
    { rows: [{ allowed: true }] },
  ], captured)));
  assert.deepEqual(result, { ok: true, charged: false, sodaBalance: 20 });
  assert.equal(captured.length, 3);
});

test("PostgreSQL novel engagement is event-idempotent and writes counters in the same transaction", async (t) => {
  const previousMode = process.env.TRUST_PROXY_MODE;
  const previousSecret = process.env.TRUST_PROXY_SECRET;
  process.env.TRUST_PROXY_MODE = "signed";
  process.env.TRUST_PROXY_SECRET = "s".repeat(32);
  t.after(() => {
    if (previousMode === undefined) delete process.env.TRUST_PROXY_MODE; else process.env.TRUST_PROXY_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.TRUST_PROXY_SECRET; else process.env.TRUST_PROXY_SECRET = previousSecret;
  });
  const captured: SqlQuery[] = [];
  const result = await recordPostgresNovelView({
    eventId: "event_identifier_123456",
    viewerKey: "user:4",
    novelId: 7,
    userId: 4,
    headers: new Headers({
      "x-novel-proxy-secret": "s".repeat(32),
      "x-novel-client-ip": "203.0.113.4",
      "x-novel-country": "CN",
      "user-agent": "Mozilla/5.0 Chrome/140.0 Windows",
    }),
    analyticsEnabled: true,
  }, transactionWith(executorQueue([
    { rowCount: 1 }, { rows: [] }, { rowCount: 1 }, { rows: [{ found: false }] },
    { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
  ], captured)));
  assert.deepEqual(result, { accepted: true, counted: true, duplicateEvent: false });
  assert.match(captured[0].text, /pg_advisory_xact_lock/u);
  assert.match(captured[3].text, /engagement_events_recent_counted_idx|created_at >=/u);
  assert.match(captured[5].text, /visit_count = visit_count \+ 1/u);
  assert.match(captured[7].text, /analytics_events/u);
  assert.deepEqual(captured[7].values?.slice(3, 5), ["203.0.113.4", "CN"]);
});

test("a fresh signed-in novel visit grows the grove inside the public dedupe window", async () => {
  const captured: SqlQuery[] = [];
  const result = await recordPostgresNovelView({
    eventId: "event_identifier_654321",
    viewerKey: "user:4",
    novelId: 7,
    userId: 4,
    headers: new Headers(),
  }, transactionWith(executorQueue([
    { rowCount: 1 }, { rows: [] }, { rowCount: 1 }, { rows: [{ found: true }] },
    { rowCount: 1 }, { rowCount: 1 },
  ], captured)));
  assert.deepEqual(result, { accepted: true, counted: false, duplicateEvent: false });
  assert.match(captured.at(-1)?.text || "", /UPDATE user_novel_grove SET visit_count = visit_count \+ 1/u);
  assert.deepEqual(captured.at(-1)?.values, [4, 7]);
});

test("replaying a PostgreSQL engagement event never increments counters twice", async () => {
  const captured: SqlQuery[] = [];
  const result = await recordPostgresNovelView({
    eventId: "event_identifier_123456",
    viewerKey: "guest:opaque",
    novelId: 7,
    headers: new Headers(),
  }, transactionWith(executorQueue([
    { rowCount: 1 }, { rows: [{ counted: true }] },
  ], captured)));
  assert.deepEqual(result, { accepted: true, counted: true, duplicateEvent: true });
  assert.equal(captured.length, 2);
});
