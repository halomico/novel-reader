import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { recordPostgresAnalyticsEvent } from "./postgres-events";

test("generic analytics events are bounded and written only to PostgreSQL", async () => {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      return { command: "INSERT", rowCount: 1, oid: 0, fields: [], rows: [] } as unknown as QueryResult<Row>;
    },
  };
  await recordPostgresAnalyticsEvent(executor, {
    headers: new Headers({ "user-agent": "Mozilla/5.0 Chrome/140", referer: "https://reader.example/novels" }),
    userId: 4,
    eventType: "tag_click",
    path: "https://reader.example/tags/xuan-huan?q=1",
    referrer: "https://reader.example/novels",
    tagId: 8,
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO analytics_events/);
  assert.equal(queries[0].values?.[1], "tag_click");
  assert.equal(queries[0].values?.[2], "/tags/xuan-huan?q=1");
  assert.equal(queries[0].values?.[8], "chrome");
  assert.equal(queries[0].values?.[12], 8);
  await assert.rejects(recordPostgresAnalyticsEvent(executor, {
    headers: new Headers(), path: "/", tagId: 0,
  }), /tag id/);
});
