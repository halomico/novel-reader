import "dotenv/config";
import { closePostgresPools } from "../src/core/db/postgres";
import { migratePostgres, postgresStartupCompatibility } from "../src/core/db/postgres-migrations";
import { initializePostgresApplication } from "../src/core/db/postgres-bootstrap";

async function main(): Promise<void> {
  try {
    const schema = await migratePostgres();
    const compatibility = postgresStartupCompatibility(schema, process.env.NODE_ENV);
    if (!compatibility.compatible) throw new Error(compatibility.issues.map((issue) => issue.message).join("; "));
    const initialized = await initializePostgresApplication();
    console.log(JSON.stringify({ event: "postgres.application.initialized", schemaVersion: schema.currentVersion, ...initialized }));
  } catch (error) {
    console.error(JSON.stringify({ event: "postgres.application.initialize.failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    await closePostgresPools();
  }
}

void main();
