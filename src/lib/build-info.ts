export type BuildInfo = {
  version: string;
  commit: string;
  buildTime: string;
  schemaVersion: number;
  expectedSchemaVersion: number;
};

export function getBuildInfo(database: { currentVersion: number; expectedVersion: number }): BuildInfo {
  return {
    version: process.env.APP_VERSION || "2.0.0",
    commit: process.env.APP_GIT_SHA || "development",
    buildTime: process.env.APP_BUILD_TIME || "development",
    schemaVersion: database.currentVersion,
    expectedSchemaVersion: database.expectedVersion,
  };
}
