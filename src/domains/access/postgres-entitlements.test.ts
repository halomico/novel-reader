import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  getPostgresEntitlementTargetOption,
  grantPostgresUserEntitlement,
  listPostgresEntitlementTargets,
  listPostgresUserEntitlementsPage,
  parsePostgresEntitlementRights,
} from "./postgres-entitlements";

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

test("PostgreSQL entitlement rights reject malformed values and remove duplicates", () => {
  assert.deepEqual(parsePostgresEntitlementRights('["read","read","play","owner"]'), ["read", "play"]);
  assert.deepEqual(parsePostgresEntitlementRights("broken"), []);
});

test("PostgreSQL entitlement pages preserve metadata even when the requested page is empty", async () => {
  const captured: SqlQuery[] = [];
  const page = await listPostgresUserEntitlementsPage(queued([{ rows: [{
    total_items: "0", total_pages: "1", page: "1", id: null, user_id: null, resource_type: null,
    resource_id: null, rights: null, source_order_id: null, source_label: null, granted_by: null,
    created_at: null, updated_at: null, expires_at: null, active: null, target_label: null, target_meta: null,
  }] }], captured), 7, { page: 999, pageSize: 10 });
  assert.deepEqual(page, { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
  assert.deepEqual(captured[0].values, [7, 999, 10]);
  assert.match(captured[0].text, /LEFT JOIN LATERAL/u);
});

test("entitlement target queries do not send an unused untyped PostgreSQL parameter", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ id: "12", label: "测试小说", meta: "默认来源" }] },
    { rows: [{ id: "9", label: "视频", meta: "video.mp4" }] },
    { rows: [] },
  ], captured);
  await getPostgresEntitlementTargetOption(executor, "novel", "12");
  await getPostgresEntitlementTargetOption(executor, "video", "9");
  await listPostgresEntitlementTargets(executor, "novel", "测试", 20);
  assert.deepEqual(captured[0].values, ["12"]);
  assert.match(captured[0].text, /novel\.id::text = \$1/u);
  assert.deepEqual(captured[1].values, ["video", "9"]);
  assert.match(captured[1].text, /media\.kind = \$1 AND media\.id::text = \$2/u);
  assert.deepEqual(captured[2].values, ["测试", 20]);
  assert.match(captured[2].text, /title ILIKE '%' \|\| \$1 \|\| '%'[^]*LIMIT \$2/u);
});

test("repeated PostgreSQL entitlement grants merge active rights and keep permanent access", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ id: "12", label: "测试小说", meta: "默认来源" }] },
    { rowCount: 1 },
  ], captured);
  const granted = await grantPostgresUserEntitlement({
    userId: 5,
    definition: { targetType: "novel", targetId: "12", rights: ["read"], durationSeconds: 3_600 },
    grantedAt: new Date("2026-09-08T00:00:00.000Z"),
    grantedBy: "root",
  }, async (operation) => operation(executor));
  assert.equal(granted, true);
  assert.match(captured[1].text, /jsonb_agg\(DISTINCT right_name\.value\)/u);
  assert.match(captured[1].text, /WHEN user_entitlements\.expires_at IS NULL THEN NULL/u);
  assert.deepEqual(captured[1].values?.slice(0, 7), [5, "novel", "12", '["read"]', null, "root", 3_600]);
});
