import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  assessPostgresSchemaCompatibility,
  adaptPostgresMigrationSql,
  postgresStartupCompatibility,
  readPostgresMigrations,
} from "./postgres-migrations";

async function withMigrationDirectory(t: TestContext, files: Record<string, string>): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-pg-migrations-"));
  await Promise.all(Object.entries(files).map(([name, sql]) => fs.writeFile(path.join(directory, name), sql, "utf8")));
  const previous = process.env.POSTGRES_MIGRATIONS_DIR;
  process.env.POSTGRES_MIGRATIONS_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.POSTGRES_MIGRATIONS_DIR;
    else process.env.POSTGRES_MIGRATIONS_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("PostgreSQL migration catalog is sorted, checksummed, and ignores unrelated files", async (t) => {
  await withMigrationDirectory(t, {
    "0002_content.sql": "SELECT 2;\r\n",
    "0001_catalog.sql": "SELECT 1;\n",
    "0003_reader_interactions.sql": "SELECT 3;\n",
    "README.md": "not a migration",
    "legacy_0004.sql": "SELECT 4;",
  });

  const migrations = await readPostgresMigrations();
  assert.deepEqual(migrations.map((migration) => migration.fileName), [
    "0001_catalog.sql",
    "0002_content.sql",
    "0003_reader_interactions.sql",
  ]);
  assert.equal(migrations[0].version, 1);
  assert.equal(migrations[1].version, 2);
  assert.equal(migrations[2].name, "reader_interactions");
  assert.equal(migrations[0].checksum.length, 64);
  assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/u);
  assert.equal(migrations[1].checksum, migrations[1].checksum.toLowerCase());
});

test("PostgreSQL migration catalog rejects duplicate versions", async (t) => {
  await withMigrationDirectory(t, {
    "0001_first.sql": "SELECT 1;",
    "0001_second.sql": "SELECT 2;",
  });
  await assert.rejects(readPostgresMigrations(), /Duplicate PostgreSQL migration version 1/);
});

test("PostgreSQL migration catalog requires at least one valid migration", async (t) => {
  await withMigrationDirectory(t, { "notes.txt": "no SQL here" });
  await assert.rejects(readPostgresMigrations(), /No PostgreSQL migrations found/);
});

test("PostgreSQL migration catalog rejects zero and malformed versions", async (t) => {
  await withMigrationDirectory(t, {
    "0000_invalid.sql": "SELECT 0;",
  });
  await assert.rejects(readPostgresMigrations(), /Invalid PostgreSQL migration version/);
});

test("repository migrations never recreate a live index", async () => {
  const directory = path.join(process.cwd(), "migrations", "postgres");
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const live = new Map<string, string>();
  const duplicates: string[] = [];
  const operations = /\b(?:(DROP)\s+INDEX(?:\s+IF\s+EXISTS)?\s+([a-z_][a-z0-9_]*)|(CREATE)\s+(?:UNIQUE\s+)?INDEX(\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*))/giu;
  for (const file of files) {
    const sql = await fs.readFile(path.join(directory, file), "utf8");
    for (const operation of sql.matchAll(operations)) {
      const dropped = operation[2]?.toLowerCase();
      if (operation[1] && dropped) {
        live.delete(dropped);
        continue;
      }
      const created = operation[5]?.toLowerCase();
      if (!created) continue;
      const previous = live.get(created);
      if (previous && !operation[4]) duplicates.push(`${created}: ${previous} -> ${file}`);
      live.set(created, file);
    }
  }
  assert.deepEqual(duplicates, []);
});

test("PostgreSQL compatibility requires the pinned writable runtime and exact schema", () => {
  assert.deepEqual(assessPostgresSchemaCompatibility({
    currentVersion: 1,
    expectedVersion: 1,
    pendingVersions: [],
    extensionVersion: "1.2",
    serverVersionNum: 180006,
    readOnly: false,
    inRecovery: false,
  }), { compatible: true, issues: [] });
});

test("PostgreSQL compatibility rejects substitute search extensions", () => {
  const result = assessPostgresSchemaCompatibility({
    currentVersion: 1,
    expectedVersion: 1,
    pendingVersions: [],
    extensionVersion: "1.6",
    serverVersionNum: 180006,
    readOnly: false,
    inRecovery: false,
  });
  assert.equal(result.compatible, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["extension-version"]);
});

test("development startup tolerates only the search-extension readiness gate", () => {
  const status = {
    currentVersion: 16,
    expectedVersion: 16,
    pendingVersions: [],
    extensionVersion: null,
    serverVersionNum: 180006,
    readOnly: false,
    inRecovery: false,
  };
  assert.deepEqual(postgresStartupCompatibility(status, "development"), { compatible: true, issues: [] });
  assert.deepEqual(
    postgresStartupCompatibility(status, "production").issues.map((issue) => issue.code),
    ["extension-version"],
  );
  assert.deepEqual(
    postgresStartupCompatibility({ ...status, pendingVersions: [17], expectedVersion: 17 }, "development")
      .issues.map((issue) => issue.code),
    ["schema-version", "pending-migrations"],
  );
});

test("development migrations substitute pg_trgm only when the pinned extension is unavailable", () => {
  const sql = "CREATE EXTENSION IF NOT EXISTS pg_bigm; CREATE INDEX demo ON books USING gin (title gin_bigm_ops);";
  assert.equal(adaptPostgresMigrationSql(sql, "pg_bigm"), sql);
  assert.equal(
    adaptPostgresMigrationSql(sql, "pg_trgm"),
    "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX demo ON books USING gin (title gin_trgm_ops);",
  );
});

test("PostgreSQL compatibility reports every unsafe deployment condition", () => {
  const result = assessPostgresSchemaCompatibility({
    currentVersion: 0,
    expectedVersion: 2,
    pendingVersions: [1, 2],
    extensionVersion: null,
    serverVersionNum: 170012,
    readOnly: true,
    inRecovery: true,
  });
  assert.equal(result.compatible, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "server-version",
    "read-only",
    "recovery",
    "schema-version",
    "pending-migrations",
    "extension-version",
  ]);
});
