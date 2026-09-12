import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  createPostgresVideoPlaybackLease,
  refreshPostgresVideoPlaybackLease,
  validatePostgresVideoPlaybackLease,
} from "./postgres-video-playback";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

test("PostgreSQL playback lease creation serializes viewer and node quotas", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    {}, {}, {}, { rows: [{ found: true }] }, { rows: [] }, { rowCount: 1 },
  ], captured);
  const result = await createPostgresVideoPlaybackLease({
    viewerKey: "user:5", userId: 5, clientId: "client_1234567890", mediaId: 8,
    now: new Date("2026-09-08T00:00:00.000Z"),
  }, async (operation) => operation(executor));
  assert.equal(result.ok, true);
  assert.match(captured[0].text, /pg_advisory_xact_lock/u);
  assert.match(captured[1].text, /video-node/u);
  assert.match(captured.at(-1)!.text, /ON CONFLICT \(viewer_key, client_id\) DO UPDATE/u);
  // Per-viewer concurrency was retired with the user-level field that configured it.
  assert.equal(captured.some((query) => /COUNT\(\*\)::bigint AS active/u.test(query.text)), false);
});

test("PostgreSQL playback token checks fail closed before querying malformed input", async () => {
  const captured: SqlQuery[] = [];
  assert.equal(await validatePostgresVideoPlaybackLease(queued([], captured), {
    id: "short", token: "bad", viewerKey: "guest:x", mediaId: 8,
  }), false);
  assert.equal(captured.length, 0);
});

test("PostgreSQL playback refresh validates and extends in one atomic update", async () => {
  const captured: SqlQuery[] = [];
  const now = new Date("2026-09-08T00:00:00.000Z");
  const expiresAt = await refreshPostgresVideoPlaybackLease(queued([{ rows: [{ expires_at: new Date(now.getTime() + 90_000) }] }], captured), {
    id: "lease_1234567890abc", token: "a".repeat(43), viewerKey: "user:5", mediaId: 8, now,
  });
  assert.equal(expiresAt, now.getTime() + 90_000);
  assert.match(captured[0].text, /UPDATE video_playback_sessions[\s\S]*token_hash/u);
});
