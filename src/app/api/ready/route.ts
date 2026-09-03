import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { CURRENT_SCHEMA_VERSION, getAppliedSchemaVersion } from "@/core/db/schema";
import { validateTrustedProxyConfiguration } from "@/core/security/client-ip";
import { getDatabasePath, getLibraryDir, getMediaDir } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function writableDirectory(target: string): string | null {
  const directory = path.extname(target) ? path.dirname(target) : target;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return null;
  } catch (error) {
    return `${directory}: ${error instanceof Error ? error.message : "not writable"}`;
  }
}

export function GET() {
  const errors: string[] = [...validateTrustedProxyConfiguration()];
  let schemaVersion = 0;
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    schemaVersion = getAppliedSchemaVersion(db);
    const quick = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    if (!quick.some((row) => Object.values(row).some((value) => String(value).toLowerCase() === "ok"))) {
      errors.push("database quick_check failed");
    }
    if (schemaVersion < CURRENT_SCHEMA_VERSION) errors.push(`schema ${schemaVersion} is behind ${CURRENT_SCHEMA_VERSION}`);
  } catch (error) {
    errors.push(`database: ${error instanceof Error ? error.message : "unavailable"}`);
  }
  for (const target of [getDatabasePath(), getLibraryDir(), getMediaDir()]) {
    const error = writableDirectory(target);
    if (error) errors.push(error);
  }
  if (process.env.NODE_ENV === "production" && !process.env.SITE_URL) {
    errors.push("SITE_URL is required in production");
  }
  const status = errors.length ? 503 : 200;
  return NextResponse.json({
    ok: errors.length === 0,
    schemaVersion,
    expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
    errors,
  }, { status, headers: { "Cache-Control": "no-store" } });
}
