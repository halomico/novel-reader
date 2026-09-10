import assert from "node:assert/strict";
import test from "node:test";
import { createHealthResponse } from "./health/response";
import { GET as getLive } from "./live/route";
import { createVersionResponse } from "./version/response";

const ENVIRONMENT_KEYS = ["APP_BUILD_TIME", "APP_GIT_SHA", "APP_VERSION"] as const;

test("operational routes stay uncacheable and expose trustworthy timing and build metadata", async (t) => {
  const previous = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  process.env.APP_VERSION = "test-version";
  process.env.APP_GIT_SHA = "test-commit";
  process.env.APP_BUILD_TIME = "2026-09-07T00:00:00Z";

  t.after(() => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previous[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  });

  const live = getLive();
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("cache-control"), "no-store");
  assert.match(live.headers.get("server-timing") || "", /^total;dur=/u);
  assert.deepEqual(await live.json(), { ok: true });

  const health = await createHealthResponse({
    query: async () => ({ rows: [], rowCount: 1, command: "SELECT", oid: 0, fields: [] }),
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.match(health.headers.get("server-timing") || "", /^db;dur=.+, total;dur=/u);
  assert.deepEqual(await health.json(), { ok: true });

  const version = await createVersionResponse(async () => ({
    currentVersion: 6,
    expectedVersion: 6,
    pendingVersions: [],
    extensionVersion: "1.2",
    serverVersionNum: 180006,
    readOnly: false,
    inRecovery: false,
  }));
  assert.equal(version.status, 200);
  assert.equal(version.headers.get("cache-control"), "no-store");
  assert.match(version.headers.get("server-timing") || "", /^total;dur=/u);
  assert.deepEqual(await version.json(), {
    version: "test-version",
    commit: "test-commit",
    buildTime: "2026-09-07T00:00:00Z",
    schemaVersion: 6,
    expectedSchemaVersion: 6,
  });

  const failedHealth = await createHealthResponse({
    query: async () => { throw new Error("database unavailable"); },
  });
  assert.equal(failedHealth.status, 503);
  assert.deepEqual(await failedHealth.json(), { ok: false });

  const failedVersion = await createVersionResponse(async () => {
    throw new Error("postgres://private-credentials@internal/schema");
  });
  assert.equal(failedVersion.status, 503);
  assert.equal(failedVersion.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failedVersion.json(), { ok: false });
});
