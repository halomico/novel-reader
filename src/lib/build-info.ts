import { CURRENT_SCHEMA_VERSION, getAppliedSchemaVersion } from "@/core/db/schema";
import { getDb } from "@/lib/db";

export type BuildInfo = {
  version: string;
  commit: string;
  buildTime: string;
  schemaVersion: number;
  expectedSchemaVersion: number;
};

export function getBuildInfo(): BuildInfo {
  return {
    version: process.env.APP_VERSION || "2.0.0",
    commit: process.env.APP_GIT_SHA || "development",
    buildTime: process.env.APP_BUILD_TIME || "development",
    schemaVersion: getAppliedSchemaVersion(getDb()),
    expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
