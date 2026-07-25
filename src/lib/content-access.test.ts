import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  checkContentAccess,
  listContentAccessPolicies,
  listContentAccessRules,
  saveContentAccessPolicy,
  saveContentAccessRule,
} from "./content-access";

type ContentAccessState = typeof globalThis & {
  novelReaderDb?: DatabaseSync;
  contentAccessCache?: unknown;
  contentAccessCleanupAt?: number;
};

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-access-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  const state = globalThis as ContentAccessState;
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  delete state.contentAccessCache;
  delete state.contentAccessCleanupAt;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete state.contentAccessCache;
    delete state.contentAccessCleanupAt;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function requestHeaders(ip: string, country = "US"): Headers {
  return new Headers({ "cf-connecting-ip": ip, "cf-ipcountry": country });
}

test("matches structured content access rules by audience and scope", (t) => {
  withTempDatabase(t);
  assert.deepEqual(listContentAccessPolicies(), []);
  saveContentAccessRule({
    targetType: "cidr",
    targetValue: "203.0.113.0/24",
    scope: "media",
    audience: "guest",
    reason: "test",
  });
  saveContentAccessRule({
    targetType: "country",
    targetValue: "DE",
    scope: "novel",
    audience: "all",
  });

  assert.equal(checkContentAccess(requestHeaders("203.0.113.8"), { scope: "media" }).allowed, false);
  assert.equal(
    checkContentAccess(requestHeaders("203.0.113.8"), { scope: "media", authenticated: true }).allowed,
    true,
  );
  assert.equal(checkContentAccess(requestHeaders("203.0.113.8"), { scope: "novel" }).allowed, true);
  assert.equal(checkContentAccess(requestHeaders("198.51.100.2", "DE"), { scope: "novel" }).allowed, false);
  assert.equal(checkContentAccess(requestHeaders("198.51.100.2", "DE"), { scope: "novel", admin: true }).allowed, true);
});

test("creates a temporary rule after a configured access policy is exceeded", (t) => {
  withTempDatabase(t);
  saveContentAccessPolicy({
    name: "媒体保护",
    scope: "media",
    audience: "guest",
    windowSeconds: 60,
    maxRequests: 1,
    blockSeconds: 120,
  });
  const headers = requestHeaders("198.51.100.9");
  const now = Date.now();
  assert.equal(checkContentAccess(headers, { scope: "media", now }).allowed, true);
  const blocked = checkContentAccess(headers, { scope: "media", now: now + 1 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed ? 0 : blocked.status, 429);
  const generated = listContentAccessRules().find((rule) => rule.source === "rate_limit");
  assert.equal(generated?.targetValue, "198.51.100.9");
  assert.equal(generated?.expiresAt, now + 120_001);
});
