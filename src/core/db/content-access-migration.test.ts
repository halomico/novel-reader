import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateContentAccessSchemaSafe } from "./content-access-migration";

function legacyDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE content_access_rules (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      blocked_until INTEGER
    );
    CREATE TABLE content_access_policies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      window INTEGER NOT NULL,
      request_limit INTEGER NOT NULL,
      ban_seconds INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO content_access_rules VALUES
      (1, 'ip', '203.0.113.7', 'novel', 'manual block', 1, NULL),
      (2, 'cidr', '2001:db8::/32', 'all', 'network block', 1, NULL),
      (3, 'country', 'CN,US', 'media', 'regional media block', 0, NULL),
      (4, 'bot', 'crawler', 'all', 'crawler block', 1, 1900000000000);
    INSERT INTO content_access_policies VALUES
      (1, 'legacy site limit', 'all', 60, 100, 600, 1),
      (2, 'legacy media limit', 'media', 30, 20, 300, 1);
  `);
  return db;
}

test("legacy access controls are copied, media scopes expand, and migration is idempotent", () => {
  const db = legacyDatabase();
  migrateContentAccessSchemaSafe(db);
  const rules = db.prepare("SELECT target_type, target_value, scope, enabled FROM content_access_rules ORDER BY id").all() as Array<Record<string, unknown>>;
  const policies = db.prepare("SELECT name, scope FROM content_access_policies ORDER BY id").all() as Array<Record<string, unknown>>;
  assert.equal(rules.length, 6);
  assert.deepEqual(rules.filter((row) => row.target_value === "CN,US").map((row) => row.scope).sort(), ["audio", "file", "video"]);
  assert.equal(rules.find((row) => row.target_value === "CN,US")?.enabled, 0);
  assert.equal(policies.length, 4);
  assert.deepEqual(policies.filter((row) => row.name === "legacy media limit").map((row) => row.scope).sort(), ["audio", "file", "video"]);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all()).length, 0);
  migrateContentAccessSchemaSafe(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_access_rules").get() as { count: number }).count, 6);
  db.close();
});

test("an unconvertible legacy row rolls back without destroying the source table", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE content_access_rules (id INTEGER PRIMARY KEY, type TEXT, value TEXT);
    CREATE TABLE content_access_policies (id INTEGER PRIMARY KEY, name TEXT, window INTEGER, request_limit INTEGER, ban_seconds INTEGER);
    INSERT INTO content_access_rules VALUES (1, 'ip', 'not-an-ip');
  `);
  assert.throws(() => migrateContentAccessSchemaSafe(db), /Invalid legacy IP rule/u);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_access_rules").get() as { count: number }).count, 1);
  assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='content_access_rules_legacy_20260904'").get()), false);
  db.close();
});
