import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery, TransactionOptions } from "./postgres";
import { initializePostgresApplication } from "./postgres-bootstrap";

function fakeBootstrap(counts: number[]) {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      const count = counts[queries.length - 1];
      return { rows: [], rowCount: count, command: "INSERT", fields: [], oid: 0 } as QueryResult<Row>;
    },
  };
  let options: TransactionOptions | undefined;
  return {
    queries,
    get options() { return options; },
    async transaction<T>(work: (executor: SqlExecutor) => Promise<T>, configuration?: TransactionOptions): Promise<T> {
      options = configuration;
      return work(executor);
    },
  };
}

test("clean PostgreSQL bootstrap is serialized and inserts only explicit defaults", async () => {
  const fake = fakeBootstrap([1, 1, 1, 7, 1]);
  assert.deepEqual(await initializePostgresApplication(fake.transaction), {
    settingsCreated: true, sourceCreated: true, levelsCreated: 7,
  });
  assert.equal(fake.options?.role, "jobs");
  assert.match(fake.queries[0].text, /pg_advisory_xact_lock/);
  const defaults = JSON.parse(String(fake.queries[1].values?.[0]));
  assert.equal(defaults.adminPasswordHash, "");
  assert.equal(defaults.adminUsername, "");
  for (const query of fake.queries.slice(1, 4)) assert.match(query.text, /ON CONFLICT.*DO NOTHING/);
});

test("bootstrap replay preserves existing administrator configuration and levels", async () => {
  const fake = fakeBootstrap([1, 0, 0, 0, 1]);
  assert.deepEqual(await initializePostgresApplication(fake.transaction), {
    settingsCreated: false, sourceCreated: false, levelsCreated: 0,
  });
  assert.ok(fake.queries.every((query) => !/\bUPDATE\b/.test(query.text)));
});

test("default source conflict rejects the transaction instead of claiming initialization succeeded", async () => {
  const fake = fakeBootstrap([1, 1, 0, 7, 0]);
  await assert.rejects(initializePostgresApplication(fake.transaction), /source path conflicts/);
});
