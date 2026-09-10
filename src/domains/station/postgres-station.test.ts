import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { STATION_MESSAGE_MAX_LENGTH } from "@/lib/station-protocol";
import {
  addPostgresStationReply,
  createPostgresStationThread,
  listPostgresStationMessages,
  listPostgresVisibleAnnouncements,
  savePostgresAnnouncement,
  StationInputError,
} from "./postgres-station";

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
        command: "SELECT", rowCount: response.rowCount ?? rows.length,
        oid: 0, fields: [], rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

test("PostgreSQL announcement visibility is expressed in the database query", async () => {
  const captured: SqlQuery[] = [];
  const rows = [{
    id: "3", title: "公开公告", body: "内容", audience: "public", importance: "important",
    display_mode: "list", entry_version: "", status: "published",
    published_at: "2026-09-08T00:00:00Z", expires_at: null,
    created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z",
  }];
  const result = await listPostgresVisibleAnnouncements(queued([{ rows }], captured), false);
  assert.equal(result[0].title, "公开公告");
  assert.match(captured[0].text, /audience = 'public'/u);
  assert.match(captured[0].text, /expires_at > clock_timestamp/u);
});

test("PostgreSQL station thread and initial message commit in one transaction", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rowCount: 1 }, { rows: [{ id: "11" }] }, { rows: [{ id: "21" }] }, { rowCount: 1 },
  ], captured);
  const id = await createPostgresStationThread(5, " 标签问题 ", "内容", async (operation) => operation(executor));
  assert.equal(id, 11);
  assert.match(captured[1].text, /INSERT INTO station_threads/u);
  assert.deepEqual(captured[2].values, [11, "user", 5, "内容"]);
  assert.match(captured[3].text, /user_last_read_message_id/u);
});

test("PostgreSQL station replies lock the open thread before insertion", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rows: [{ id: "22" }] }, { rowCount: 1 }], captured);
  assert.equal(await addPostgresStationReply({
    threadId: 11, authorRole: "user", userId: 5, body: "补充说明",
  }, async (operation) => operation(executor)), true);
  assert.match(captured[0].text, /FOR UPDATE/u);
  assert.match(captured[0].text, /user_id = \$2/u);
  assert.deepEqual(captured[1].values, [11, "user", 5, "补充说明"]);
});

test("PostgreSQL station messages support incremental reads", async () => {
  const captured: SqlQuery[] = [];
  const rows = [{ id: "9", thread_id: "4", author_role: "admin", body: "已处理", created_at: "2026-09-08T00:00:00Z" }];
  const messages = await listPostgresStationMessages(queued([{ rows }], captured), 4, { afterId: 8 });
  assert.equal(messages[0].body, "已处理");
  assert.deepEqual(captured[0].values, [4, 8]);
});

test("PostgreSQL station rejects oversized messages without truncation", async () => {
  const allowed = "消".repeat(STATION_MESSAGE_MAX_LENGTH);
  await assert.rejects(
    createPostgresStationThread(5, "长度检查", allowed + "息", async () => {
      throw new Error("transaction must not run");
    }),
    (error: unknown) => error instanceof StationInputError && error.message === "消息不能超过 500 字",
  );
});

test("PostgreSQL announcement writes return the saved row", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rows: [{
    id: "4", title: "草稿", body: "正文", audience: "public", importance: "normal",
    display_mode: "list", entry_version: "", status: "draft", published_at: null,
    expires_at: null, created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z",
  }] }], captured);
  const saved = await savePostgresAnnouncement({ title: "草稿", body: "正文" }, async (operation) => operation(executor));
  assert.equal(saved.id, 4);
  assert.match(captured[0].text, /RETURNING id/u);
});
