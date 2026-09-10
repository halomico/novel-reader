import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getPostgresMediaSummary, recordPostgresMediaView } from "./postgres-media-engagement";

function queued(
  responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>,
  captured: SqlQuery[],
): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return {
        command: "SELECT",
        rowCount: response.rowCount ?? rows.length,
        oid: 0,
        fields: [],
        rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

const headers = {
  get(name: string) {
    const values: Record<string, string> = {
      "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "cf-connecting-ip": "203.0.113.9",
      "cf-ipcountry": "CN",
    };
    return values[name.toLocaleLowerCase("en-US")] ?? null;
  },
};

test("PostgreSQL media summaries normalize bigint identifiers", async () => {
  const captured: SqlQuery[] = [];
  const summary = await getPostgresMediaSummary(queued([{ rows: [{ id: "9", kind: "audio", title: "回声" }] }], captured), 9);
  assert.deepEqual(summary, { id: 9, kind: "audio", title: "回声" });
  assert.deepEqual(captured[0].values, [9]);
});

test("PostgreSQL media views atomically update engagement, history, grove, and analytics", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ id: "9", kind: "audio", title: "回声" }] },
    { rowCount: 1 },
    { rows: [] },
    { rows: [] },
    { rowCount: 1 },
    { rowCount: 1 },
    { rowCount: 1 },
    { rowCount: 1 },
  ], captured);
  const result = await recordPostgresMediaView({
    eventId: "event_1234567890abcdef",
    viewerKey: "user:5",
    media: { id: 9, kind: "audio", title: "回声" },
    userId: 5,
    headers,
    referrer: "https://reader.example/media/9",
    analyticsEnabled: true,
  }, async (operation) => operation(executor));

  assert.deepEqual(result, { accepted: true, counted: true, duplicateEvent: false });
  assert.match(captured[0].text, /FOR KEY SHARE/u);
  assert.match(captured[1].text, /pg_advisory_xact_lock/u);
  assert.match(captured[4].text, /INSERT INTO engagement_events/u);
  assert.match(captured[5].text, /ON CONFLICT \(user_id, media_id\) DO UPDATE/u);
  assert.match(captured[7].text, /UPDATE user_media_grove/u);
  assert.deepEqual(captured[6].values, [5, "audio_view", "/media/9", "https://reader.example/media/9", "unknown", "unknown",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "mobile", "safari", "ios", 9]);
});

test("a fresh media visit grows the grove even inside the public dedupe window", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ id: "9", kind: "video", title: "片段" }] },
    { rowCount: 1 },
    { rows: [] },
    { rowCount: 1 },
    { rowCount: 1 },
    { rowCount: 1 },
  ], captured);
  const result = await recordPostgresMediaView({
    eventId: "event_fresh_deduped_1234",
    viewerKey: "user:5",
    media: { id: 9, kind: "video", title: "片段" },
    userId: 5,
    headers,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { accepted: true, counted: false, duplicateEvent: false });
  assert.match(captured.at(-1)?.text || "", /UPDATE user_media_grove/u);
});

test("PostgreSQL media view event replays do not repeat side effects", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ id: "9", kind: "video", title: "片段" }] },
    { rowCount: 1 },
    { rows: [{ counted: true }] },
  ], captured);
  const result = await recordPostgresMediaView({
    eventId: "event_1234567890abcdef",
    viewerKey: "guest:abc",
    media: { id: 9, kind: "video", title: "片段" },
    headers,
    analyticsEnabled: true,
  }, async (operation) => operation(executor));

  assert.deepEqual(result, { accepted: true, counted: true, duplicateEvent: true });
  assert.equal(captured.length, 3);
});

test("PostgreSQL media views reject assets removed before commit", async () => {
  const captured: SqlQuery[] = [];
  const result = await recordPostgresMediaView({
    eventId: "event_1234567890abcdef",
    viewerKey: "guest:abc",
    media: { id: 9, kind: "file", title: "资料" },
    headers,
  }, async (operation) => operation(queued([{ rows: [] }], captured)));
  assert.deepEqual(result, { accepted: false, counted: false, duplicateEvent: false });
  assert.equal(captured.length, 1);
});
