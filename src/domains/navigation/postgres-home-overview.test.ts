import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { formatPostgresHomeUpdateTime, getPostgresHomeOverview } from "./postgres-home-overview";

test("home overview aggregates every portal card in one PostgreSQL statement", async () => {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      const rows = [{
        novel_count: "10", novel_updated_at: "2026-09-08T00:00:00.000Z",
        announcement_count: "2", announcement_updated_at: "2026-09-07T00:00:00.000Z",
        tag_count: "5", tag_updated_at: null,
        original_count: "3", original_updated_at: "2026-09-06T00:00:00.000Z",
        video_count: "4", video_updated_at: null,
        audio_count: "1", audio_updated_at: null,
        file_count: "8", file_updated_at: null,
      }];
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
  const overview = await getPostgresHomeOverview(executor, false);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [false]);
  assert.match(queries[0].text, /count\(\*\) FILTER \(WHERE media\.kind = 'video'\)/);
  assert.equal(overview.novels.count, 10);
  assert.equal(overview.original.count, 3);
  assert.equal(overview.tags.updatedAt, null);
});

test("home update labels retain the compact reader time scale", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  assert.equal(formatPostgresHomeUpdateTime(now - 30 * 60_000, now), "30分钟前");
  assert.equal(formatPostgresHomeUpdateTime(now - 2 * 60 * 60_000, now), "2小时前");
  assert.equal(formatPostgresHomeUpdateTime(null, now), "暂无更新");
});
