import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { PostgresSettingsRepository } from "./postgres-settings";

type ExampleSettings = { title: string; enabled: boolean };

const codec = {
  parse(value: unknown): ExampleSettings {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid settings");
    const record = value as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.enabled !== "boolean") throw new Error("invalid settings");
    return { title: record.title, enabled: record.enabled };
  },
};

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("PostgreSQL settings reads validated immutable versioned snapshots", async () => {
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>() {
      return queryResult([{
        key: "site",
        value: { title: "阅览室", enabled: true },
        version: "7",
        updated_at: new Date("2026-09-07T10:00:00.000Z"),
      }]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresSettingsRepository(codec, executor);
  const snapshot = await repository.read("site");
  assert.deepEqual(snapshot, {
    key: "site",
    value: { title: "阅览室", enabled: true },
    version: 7,
    updatedAt: "2026-09-07T10:00:00.000Z",
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot?.value), true);
});

test("PostgreSQL settings cache is bounded, deduplicated, and explicitly invalidated", async () => {
  let queries = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>() {
      queries += 1;
      await gate;
      return queryResult([{
        key: "site", value: { title: "A", enabled: true }, version: 1,
        updated_at: "2026-09-07T10:00:00.000Z",
      }]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresSettingsRepository(codec, executor, { cacheMaxAgeMs: 5_000 });
  const first = repository.read("site");
  const second = repository.read("site");
  assert.equal(queries, 1);
  release?.();
  await Promise.all([first, second]);
  await repository.read("site");
  assert.equal(queries, 1);
  repository.invalidate("site");
  await repository.read("site");
  assert.equal(queries, 2);
});

test("PostgreSQL settings CAS reports conflicts without overwriting", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return queryResult([{
        applied: false,
        key: "site",
        value: { title: "newer", enabled: true },
        version: "9",
        updated_at: "2026-09-07T10:00:00.000Z",
      }]) as unknown as QueryResult<Row>;
    },
  };
  const repository = new PostgresSettingsRepository(codec, executor);
  assert.deepEqual(
    await repository.compareAndSet("site", 8, { title: "stale", enabled: false }),
    { ok: false, currentVersion: 9 },
  );
  assert.equal(captured[0].name, "settings-update-cas-v1");
  assert.deepEqual(captured[0].values, ["site", 8, JSON.stringify({ title: "stale", enabled: false })]);
});

test("PostgreSQL settings reject malformed keys, values, and versions before writing", async () => {
  let queried = false;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>() {
      queried = true;
      return queryResult([]) as QueryResult<Row>;
    },
  };
  const repository = new PostgresSettingsRepository(codec, executor);
  await assert.rejects(repository.read("../../secret"), /key/);
  await assert.rejects(
    repository.compareAndSet("site", 0, { title: "x", enabled: true }),
    /version/,
  );
  await assert.rejects(
    repository.compareAndSet("site", null, { title: "x", enabled: "yes" } as unknown as ExampleSettings),
    /invalid settings/,
  );
  assert.equal(queried, false);
});

test("settings reject lossy or PostgreSQL-incompatible JSON before any query", async () => {
  let queries = 0;
  const repository = new PostgresSettingsRepository({ parse: (value: unknown) => value }, {
    async query<Row extends QueryResultRow>() {
      queries += 1;
      return queryResult([]) as QueryResult<Row>;
    },
  });
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const value of [NaN, Infinity, undefined, new Date(), { missing: undefined },
    { number: 1n }, [undefined], circular, "\u0000", "\ud800", { "\ud800": "key" }]) {
    await assert.rejects(repository.compareAndSet("site", null, value));
  }
  assert.equal(queries, 0);
});

test("settings bind JSON scalars and arrays as JSON text, not PostgreSQL array parameters", async () => {
  const captured: SqlQuery[] = [];
  const repository = new PostgresSettingsRepository({ parse: (value: unknown) => value }, {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return queryResult([]) as QueryResult<Row>;
    },
  });
  for (const value of ["中文😀", ["中文", true, null], false, null]) {
    await repository.compareAndSet("site", null, value);
    assert.equal(captured.at(-1)?.values?.[1], JSON.stringify(value));
  }
});

test("an invalidated in-flight settings read cannot repopulate the shared cache", async () => {
  let release: ((result: QueryResult<QueryResultRow>) => void) | undefined;
  let queries = 0;
  const row = (version: number) => queryResult([{
    key: "site", value: { title: String(version), enabled: true }, version,
    updated_at: "2026-09-07T10:00:00.000Z",
  }]);
  const repository = new PostgresSettingsRepository(codec, {
    async query<Row extends QueryResultRow>() {
      queries += 1;
      const result = queries === 1 ? await new Promise<QueryResult<QueryResultRow>>((resolve) => { release = resolve; }) : row(2);
      return result as QueryResult<Row>;
    },
  }, { cacheMaxAgeMs: 5_000 });
  const stale = repository.read("site");
  repository.invalidate("site");
  assert.equal((await repository.read("site"))?.version, 2);
  release?.(row(1));
  assert.equal((await stale)?.version, 1);
  assert.equal((await repository.read("site"))?.version, 2);
  assert.equal(queries, 2);
});
