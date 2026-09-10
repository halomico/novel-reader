import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { registerPostgresUser, updatePostgresUserEmail } from "./postgres-account";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return { async query<Row extends QueryResultRow>(query: SqlQuery) {
    captured.push(query);
    const response = responses.shift() ?? {};
    const rows = response.rows ?? [];
    return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
  } };
}

test("PostgreSQL invited registration consumes invite and creates user atomically", async () => {
  const previous = process.env.REGISTRATION_INVITE_SECRET;
  process.env.REGISTRATION_INVITE_SECRET = "test-secret-that-is-at-least-thirty-two-bytes";
  try {
    const captured: SqlQuery[] = [];
    const executor = queued([{ rowCount: 1 }, { rows: [{ count: "0" }] }, { rowCount: 1 }, { rows: [{ id: "17" }] }], captured);
    const result = await registerPostgresUser({
      username: " Reader_7 ", displayName: "读者", email: "READER@example.com", passwordHash: "scrypt$long-password-hash",
      status: "active", localePreference: "zh-Hans", registrationIp: "203.0.113.8",
      registrationMode: "invite", inviteCode: "JOIN-ABCDE-FGHIJ", dailyLimit: 2,
    }, async (operation) => operation(executor));
    assert.deepEqual(result, { ok: true, userId: 17 });
    assert.match(captured[0].text, /pg_advisory_xact_lock/u);
    assert.match(captured[1].text, /created_at >= date_trunc/u);
    assert.match(captured[2].text, /UPDATE registration_invites/u);
    assert.deepEqual(captured[3].values, ["reader_7", "读者", "reader@example.com", "scrypt$long-password-hash", "active", "zh-Hans", "203.0.113.8"]);
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_INVITE_SECRET;
    else process.env.REGISTRATION_INVITE_SECRET = previous;
  }
});

test("PostgreSQL registration enforces the daily quota again inside the transaction", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rows: [{ count: "2" }] }], captured);
  const result = await registerPostgresUser({
    username: "reader", displayName: "读者", passwordHash: "scrypt$long-password-hash",
    status: "active", localePreference: "zh-Hans", registrationIp: "203.0.113.8",
    registrationMode: "open", dailyLimit: 2,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: false, reason: "daily_limit" });
  assert.equal(captured.length, 2);
});

test("PostgreSQL email changes revoke all outstanding verification tokens", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rowCount: 2 }], captured);
  assert.equal(await updatePostgresUserEmail(4, "new@example.com", async (operation) => operation(executor)), "updated");
  assert.match(captured[1].text, /DELETE FROM email_verification_tokens/u);
});
