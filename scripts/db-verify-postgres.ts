import "dotenv/config";
import { closePostgresPools } from "../src/core/db/postgres";
import { getPostgresSchemaStatus, postgresStartupCompatibility } from "../src/core/db/postgres-migrations";

async function main(): Promise<void> {
  const status = await getPostgresSchemaStatus();
  const compatibility = postgresStartupCompatibility(status, process.env.NODE_ENV);
  console.log(JSON.stringify({ ...status, ...compatibility }, null, 2));
  if (!compatibility.compatible) process.exitCode = 1;
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify({
      event: "postgres.schema.verify.failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  } finally {
    try {
      await closePostgresPools();
    } catch (error) {
      console.error(JSON.stringify({
        event: "postgres.pool.close.failed",
        operation: "verify",
        message: error instanceof Error ? error.message : String(error),
      }));
      process.exitCode = 1;
    }
  }
}

void run();
