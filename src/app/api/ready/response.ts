import fs from "node:fs";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  postgresStartupCompatibility,
  type PostgresSchemaStatus,
} from "@/core/db/postgres-migrations";
import { getDatabaseMetrics } from "@/core/db/postgres";
import {
  elapsedMilliseconds,
  formatServerTiming,
  getRuntimeMetrics,
  type ServerTimingMetric,
} from "@/core/observability/runtime";
import { validateTrustedProxyConfiguration } from "@/core/security/client-ip";
import { getLibraryDir, getMediaDir } from "@/lib/config";

function writableDirectory(directory: string): string | null {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return null;
  } catch (error) {
    return `${directory}: ${error instanceof Error ? error.message : "not writable"}`;
  }
}

function secretsEqual(actual: string | null, expected: string): boolean {
  if (!actual || expected.length < 32) return false;
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function validateProductionSiteUrl(errors: string[]): void {
  if (process.env.NODE_ENV !== "production") return;
  const configured = String(process.env.SITE_URL || "").trim();
  if (!configured) {
    errors.push("SITE_URL is required in production");
    return;
  }
  try {
    const url = new URL(configured);
    if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) {
      errors.push("SITE_URL must be an HTTP(S) URL without credentials");
    }
  } catch {
    errors.push("SITE_URL must be a valid absolute URL");
  }
}

export type ReadinessDependencies = {
  getSchemaStatus(): Promise<PostgresSchemaStatus>;
};

export async function createReadinessResponse(
  request: Request,
  dependencies: ReadinessDependencies,
): Promise<NextResponse> {
  const totalStartedAt = performance.now();
  const timings: ServerTimingMetric[] = [];
  const readinessToken = String(process.env.READINESS_TOKEN || "").trim();
  const hasPrivateAccess = secretsEqual(request.headers.get("x-readiness-token"), readinessToken);
  const errors: string[] = [...validateTrustedProxyConfiguration()];
  let postgres: PostgresSchemaStatus | undefined;
  let postgresCompatibility: ReturnType<typeof postgresStartupCompatibility> | undefined;
  const databaseStartedAt = performance.now();
  try {
    postgres = await dependencies.getSchemaStatus();
    postgresCompatibility = postgresStartupCompatibility(postgres, process.env.NODE_ENV);
    errors.push(...postgresCompatibility.issues.map((issue) => `postgres.${issue.code}: ${issue.message}`));
  } catch (error) {
    errors.push(`database: ${error instanceof Error ? error.message : "unavailable"}`);
  }
  timings.push({ name: "db", durationMs: elapsedMilliseconds(databaseStartedAt), description: "postgres readiness" });

  const storageStartedAt = performance.now();
  for (const error of [writableDirectory(getLibraryDir()), writableDirectory(getMediaDir())]) {
    if (error) errors.push(error);
  }
  timings.push({ name: "storage", durationMs: elapsedMilliseconds(storageStartedAt) });

  validateProductionSiteUrl(errors);
  const status = errors.length ? 503 : 200;
  timings.push({ name: "total", durationMs: elapsedMilliseconds(totalStartedAt) });
  const headers = {
    "Cache-Control": "no-store",
    "Server-Timing": formatServerTiming(timings),
    "Vary": "X-Readiness-Token",
  };
  if (!hasPrivateAccess) {
    return NextResponse.json({ ok: errors.length === 0 }, { status, headers });
  }
  return NextResponse.json(
    {
      ok: errors.length === 0,
      schemaVersion: postgres?.currentVersion ?? 0,
      expectedSchemaVersion: postgres?.expectedVersion ?? 0,
      postgres,
      postgresCompatibility,
      postgresMetrics: getDatabaseMetrics(),
      runtime: getRuntimeMetrics(),
      errors,
    },
    { status, headers },
  );
}
