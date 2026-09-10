import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  hashPostgresSessionToken,
  parsePostgresSessionCookie,
  PostgresIdentityRepository,
} from "./postgres-identity";

function queryResult<Row extends QueryResultRow>(rows: Row[], rowCount = rows.length): QueryResult<Row> {
  return { command: "SELECT", rowCount, oid: 0, fields: [], rows };
}

const SESSION_ID = "a".repeat(24);
const SESSION_TOKEN = "b".repeat(43);
const COOKIE = `${SESSION_ID}.${SESSION_TOKEN}`;

test("session cookies are strictly bounded before hashing or querying", async () => {
  assert.deepEqual(parsePostgresSessionCookie(COOKIE), { id: SESSION_ID, token: SESSION_TOKEN });
  assert.equal(parsePostgresSessionCookie("short.token"), null);
  assert.equal(parsePostgresSessionCookie(`${SESSION_ID}.${SESSION_TOKEN}.extra`), null);
  assert.equal(hashPostgresSessionToken(SESSION_TOKEN), crypto.createHash("sha256").update(SESSION_TOKEN).digest("hex"));

  let queried = false;
  const repository = new PostgresIdentityRepository({
    async query<Row extends QueryResultRow>() {
      queried = true;
      return queryResult([]) as QueryResult<Row>;
    },
  });
  assert.equal(await repository.resolveSession("malformed"), null);
  assert.equal(queried, false);
});

test("session resolution validates expiry and active account in SQL and exposes no secrets", async () => {
  let captured: SqlQuery | undefined;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured = query;
      return queryResult([{
        id: "42",
        username: "reader",
        display_name: "读者",
        email: "reader@example.test",
        email_verified_at: null,
        avatar_path: null,
        status: "active",
        role: "user",
        trust_level: 2,
        soda_balance: "8",
        soda_experience: "20",
        cookie_balance: "3",
        locale_preference: "zh-Hans",
        reading_history_enabled: true,
        original_reading_history_enabled: false,
        reading_progress_enabled: true,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-07T00:00:00.000Z",
        last_login_at: null,
      }]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresIdentityRepository(executor, { lastSeenWriteIntervalSeconds: 120 });
  const principal = await repository.resolveSession(COOKIE, {
    ip: " 203.0.113.5 ",
    userAgent: ` browser ${"x".repeat(300)}`,
  });

  assert.equal(principal?.id, 42);
  assert.equal(principal?.displayName, "读者");
  assert.equal(principal?.originalReadingHistoryEnabled, false);
  assert.equal("passwordHash" in (principal ?? {}), false);
  assert.equal("tokenHash" in (principal ?? {}), false);
  assert.equal("registrationIp" in (principal ?? {}), false);
  assert.match(captured?.text ?? "", /s\.expires_at > clock_timestamp\(\)/);
  assert.match(captured?.text ?? "", /u\.status = 'active'/);
  assert.match(captured?.text ?? "", /u\.deleted_at IS NULL/);
  assert.match(captured?.text ?? "", /last_seen_at <=/);
  assert.equal(captured?.values?.[0], SESSION_ID);
  assert.equal(captured?.values?.[1], hashPostgresSessionToken(SESSION_TOKEN));
  assert.equal(captured?.values?.[2], "203.0.113.5");
  assert.equal(captured?.values?.[4], 120);
  assert.equal(captured?.values?.includes(SESSION_TOKEN), false);
});

test("session creation only succeeds for an active undeleted user", async () => {
  let captured: SqlQuery | undefined;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured = query;
      return queryResult([{ expires_at: "2026-10-07T00:00:00.000Z" }]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresIdentityRepository(executor);
  const credential = await repository.createSession(7, { ip: "198.51.100.4", userAgent: "test" });
  assert.ok(parsePostgresSessionCookie(credential?.cookieValue));
  assert.equal(credential?.maxAgeSeconds, 30 * 24 * 60 * 60);
  assert.match(captured?.text ?? "", /u\.status = 'active'/);
  assert.equal(captured?.values?.[1], 7);
  const parsed = parsePostgresSessionCookie(credential?.cookieValue);
  assert.ok(parsed);
  assert.equal(captured?.values?.[2], hashPostgresSessionToken(parsed.token));
  assert.equal(captured?.values?.includes(parsed.token), false);
});

test("login lookup is bounded and successful login updates audit state atomically", async () => {
  const captured: SqlQuery[] = [];
  const row = {
    id: "42", username: "reader", display_name: "读者", email: null, email_verified_at: null,
    password_hash: "scrypt$credential-hash", avatar_path: "generated-avatar:abc", status: "active", role: "user",
    trust_level: 2, soda_balance: "8", soda_experience: "20", cookie_balance: "3",
    locale_preference: "zh-Hans", reading_history_enabled: true,
    original_reading_history_enabled: true, reading_progress_enabled: true,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-07T00:00:00.000Z",
    last_login_at: "2026-09-07T00:00:00.000Z",
  };
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return queryResult([row]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresIdentityRepository(executor);
  assert.equal(await repository.findLoginUser(" invalid user "), null);
  assert.equal(captured.length, 0);
  const login = await repository.findLoginUser(" READER ");
  assert.equal(login?.passwordHash, row.password_hash);
  assert.deepEqual(captured[0].values, ["reader"]);
  assert.equal("registrationIp" in (login ?? {}), false);

  const principal = await repository.completeSuccessfulLogin(42, {
    passwordHash: "scrypt$new-credential-hash",
    defaultAvatarPath: "generated-avatar:1234abcd",
    ip: "203.0.113.9",
    userAgent: "browser",
  });
  assert.equal(principal?.id, 42);
  assert.match(captured[1].text, /WITH updated AS MATERIALIZED/);
  assert.match(captured[1].text, /INSERT INTO user_login_records/);
  assert.match(captured[1].text, /status = 'active'/);
  assert.deepEqual(captured[1].values, [42, "scrypt$new-credential-hash", "generated-avatar:1234abcd", "203.0.113.9", "browser"]);
});

test("session revocation requires both public id and secret token hash", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return queryResult([], 1) as QueryResult<Row>;
    },
  };
  const repository = new PostgresIdentityRepository(executor);
  assert.equal(await repository.revokeSession(COOKIE), true);
  assert.match(captured[0].text, /id = \$1 AND token_hash = \$2/);
  assert.deepEqual(captured[0].values, [SESSION_ID, hashPostgresSessionToken(SESSION_TOKEN)]);
  assert.equal(await repository.revokeSession("bad"), false);
  assert.equal(captured.length, 1);
});

test("expired session cleanup is bounded and lock-safe", async () => {
  let captured: SqlQuery | undefined;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured = query;
      return queryResult([], 17) as QueryResult<Row>;
    },
  };
  const repository = new PostgresIdentityRepository(executor);
  assert.equal(await repository.deleteExpiredSessions(100_000), 17);
  assert.equal(captured?.values?.[0], 10_000);
  assert.match(captured?.text ?? "", /FOR UPDATE SKIP LOCKED/);
});

test("session request context rejects invalid Unicode before SQL and keeps supplementary characters intact", async () => {
  const captured: SqlQuery[] = [];
  const repository = new PostgresIdentityRepository({
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return queryResult([]) as QueryResult<Row>;
    },
  });
  await assert.rejects(repository.resolveSession(COOKIE, { userAgent: "bad\u0000agent" }), /context/);
  await assert.rejects(repository.resolveSession(COOKIE, { userAgent: "\ud800" }), /context/);
  assert.equal(captured.length, 0);
  await repository.resolveSession(COOKIE, { userAgent: "😀".repeat(300) });
  assert.equal(captured[0].values?.[3], "😀".repeat(240));
});
