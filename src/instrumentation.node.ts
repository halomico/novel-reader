import { initializeRuntimeSiteSettings } from "./core/config/runtime-site-settings";
import { initializePostgresMediaLibraryMaintenance } from "./domains/media/postgres-media-preparation";
import { initializeTelegramIntegration } from "./lib/telegram";
import { initializePostgresAnalyticsMaintenance } from "./domains/analytics/postgres-retention";
import { initializeRuntimeMetrics } from "./core/observability/runtime";
import {
  getPostgresSchemaStatus,
  POSTGRES_BIGM_VERSION,
  postgresStartupCompatibility,
} from "./core/db/postgres-migrations";

async function assertPostgresStartupReady(): Promise<void> {
  const status = await getPostgresSchemaStatus();
  const compatibility = postgresStartupCompatibility(status, process.env.NODE_ENV);
  if (!compatibility.compatible) {
    throw new Error(
      `PostgreSQL startup preflight failed: ${compatibility.issues.map((issue) => issue.message).join("; ")}. `
      + "Run npm run db:pg:init before starting the application.",
    );
  }
  if (status.extensionVersion !== POSTGRES_BIGM_VERSION) {
    console.warn(JSON.stringify({
      event: "postgres.search-extension.development-fallback",
      expected: `pg_bigm ${POSTGRES_BIGM_VERSION}`,
      found: status.extensionVersion || "not installed",
      message: "Development may run, but production readiness remains disabled.",
    }));
  }
}

export async function registerNodeInstrumentation() {
  initializeRuntimeMetrics();
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  await assertPostgresStartupReady();
  await initializeRuntimeSiteSettings();
  initializePostgresAnalyticsMaintenance();
  await initializePostgresMediaLibraryMaintenance();
  await initializeTelegramIntegration();
}
