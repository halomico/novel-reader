import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReadinessResponse } from "./response";

const ENVIRONMENT_KEYS = [
  "MEDIA_DIR",
  "NOVEL_LIBRARY_DIR",
  "NODE_ENV",
  "READINESS_TOKEN",
  "SITE_URL",
  "TRUST_PROXY_MODE",
] as const;

test("readiness keeps diagnostics private and validates deployment configuration", async (t) => {
  const previous = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-ready-"));
  const library = path.join(root, "library.with-dot");
  const media = path.join(root, "media.with-dot");
  fs.mkdirSync(library);
  fs.mkdirSync(media);
  process.env.NOVEL_LIBRARY_DIR = library;
  process.env.MEDIA_DIR = media;
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.SITE_URL = "https://reader.example.com";
  process.env.TRUST_PROXY_MODE = "none";
  process.env.READINESS_TOKEN = "r".repeat(32);

  t.after(() => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previous[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const dependencies = {
    getSchemaStatus: async () => ({
      currentVersion: 6,
      expectedVersion: 6,
      pendingVersions: [],
      extensionVersion: "1.2",
      serverVersionNum: 180006,
      readOnly: false,
      inRecovery: false,
    }),
  };
  const publicResponse = await createReadinessResponse(new Request("https://reader.example.com/api/ready"), dependencies);
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(await publicResponse.json(), { ok: true });
  assert.match(publicResponse.headers.get("server-timing") || "", /db;dur=/u);
  assert.equal(publicResponse.headers.get("vary"), "X-Readiness-Token");

  const privateResponse = await createReadinessResponse(new Request("https://reader.example.com/api/ready", {
    headers: { "x-readiness-token": process.env.READINESS_TOKEN },
  }), dependencies);
  assert.equal(privateResponse.status, 200);
  const privateBody = await privateResponse.json() as Record<string, unknown>;
  assert.equal(privateBody.ok, true);
  assert.equal(privateBody.schemaVersion, 6);
  assert.equal(privateBody.expectedSchemaVersion, 6);
  assert.ok(privateBody.postgresMetrics);
  assert.ok(privateBody.runtime);
  assert.deepEqual(privateBody.errors, []);

  process.env.READINESS_TOKEN = "short";
  const shortTokenResponse = await createReadinessResponse(new Request("https://reader.example.com/api/ready", {
    headers: { "x-readiness-token": "short" },
  }), dependencies);
  assert.deepEqual(await shortTokenResponse.json(), { ok: true });

  process.env.READINESS_TOKEN = "r".repeat(32);
  process.env.SITE_URL = "file:///tmp/reader";
  const invalidResponse = await createReadinessResponse(new Request("https://reader.example.com/api/ready", {
    headers: { "x-readiness-token": process.env.READINESS_TOKEN },
  }), dependencies);
  assert.equal(invalidResponse.status, 503);
  const invalidBody = await invalidResponse.json() as { errors: string[] };
  assert.ok(invalidBody.errors.includes("SITE_URL must be an HTTP(S) URL without credentials"));
});
