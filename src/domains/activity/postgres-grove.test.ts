import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { listPostgresGrovePage, postgresGroveStageForVisitCount, togglePostgresMediaGrove } from "./postgres-grove";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return { async query<Row extends QueryResultRow>(query: SqlQuery) {
    captured.push(query);
    const response = responses.shift() ?? {};
    const rows = response.rows ?? [];
    return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
  } };
}

test("PostgreSQL grove page computes stats, filtered count and heterogeneous rows in one query", async () => {
  const captured: SqlQuery[] = [];
  const page = await listPostgresGrovePage(queued([{ rows: [{
    all_count: "3", seed_count: "1", sprout_count: "1", tree_count: "1",
    total_items: "1", total_pages: "1", page: "1", kind: "novel", item_id: 8,
    title: "书", visit_count: "10", planted_at: "2026-09-08T00:00:00Z",
    storage_mode: "chapters", chapter_count: 12, word_count: "9000", slug: null,
    author_id: null, author_name: null, author_avatar_path: null, unlock_soda_price: null,
    file_name: null, artist: null, duration_seconds: null,
  }] }], captured), 4, { stage: "tree", allowedKinds: ["novel", "audio"], pageSize: 20 });
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /WITH grove AS MATERIALIZED[\s\S]*LEFT JOIN LATERAL/u);
  assert.deepEqual(captured[0].values, [4, ["novel", "audio"], "tree", 1, 20]);
  assert.deepEqual(page.stats, { all: 3, seed: 1, sprout: 1, tree: 1 });
  assert.equal(page.items[0].stage, "tree");
  assert.equal(postgresGroveStageForVisitCount(3), "sprout");
});

test("PostgreSQL media grove toggle uses an advisory transaction lock", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rowCount: 0 }, { rows: [{ visit_count: "0" }] }], captured);
  const result = await togglePostgresMediaGrove(2, 7, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, planted: true, visitCount: 0, stage: "seed" });
  assert.match(captured[0].text, /pg_advisory_xact_lock/u);
  assert.match(captured[2].text, /kind IN \('video', 'audio'\)/u);
});
