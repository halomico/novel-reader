import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { claimPostgresDailySoda, listPostgresCurrencyTransactionsPage } from "./postgres-user-economy";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return { async query<Row extends QueryResultRow>(query: SqlQuery) {
    captured.push(query);
    const response = responses.shift() ?? {};
    const rows = response.rows ?? [];
    return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
  } };
}

test("PostgreSQL daily check-in updates balance, experience, level and ledger atomically", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ status: "active", soda_balance: "8", soda_experience: "10", cookie_balance: "2" }] },
    { rows: [] }, { rowCount: 1 }, { rows: [{ soda_balance: "12" }] }, { rowCount: 1 },
  ], captured);
  const result = await claimPostgresDailySoda(3, new Date("2026-09-08T04:00:00Z"), () => 3, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, reward: 4, balance: 12, alreadyCheckedIn: false });
  assert.match(captured[0].text, /FOR UPDATE/u);
  assert.match(captured[3].text, /trust_level = COALESCE/u);
  assert.deepEqual(captured[4].values, [3, 4, 12, "daily-checkin:3:2026-09-08"]);
});

test("PostgreSQL daily check-in replay returns the original reward without another write", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ status: "active", soda_balance: "12", soda_experience: "14", cookie_balance: "2" }] },
    { rows: [{ reward: "4" }] },
  ], captured);
  const result = await claimPostgresDailySoda(3, new Date("2026-09-08T04:00:00Z"), () => 99, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, reward: 4, balance: 12, alreadyCheckedIn: true });
  assert.equal(captured.length, 2);
});

test("PostgreSQL currency history returns clamped pagination metadata in one query", async () => {
  const captured: SqlQuery[] = [];
  const page = await listPostgresCurrencyTransactionsPage(queued([{ rows: [{
    total_items: "1", total_pages: "1", page: "1", id: "7", currency: "soda", amount: "4",
    balance_after: "12", source: "daily_checkin", note: "每日签到", created_at: "2026-09-08T04:00:00Z",
  }] }], captured), 3, 9, 10);
  assert.equal(captured.length, 1);
  assert.equal(page.items[0].balanceAfter, 12);
  assert.equal(page.page, 1);
});
