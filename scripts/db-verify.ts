import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, getAppliedSchemaVersion, listSchemaMigrations } from "../src/core/db/schema";
import { getDatabasePath } from "../src/lib/config";

const databasePath = process.argv[2] || getDatabasePath();
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const quick = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const quickValues = quick.flatMap((row) => Object.values(row)).map(String);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const schemaVersion = getAppliedSchemaVersion(db);
  const result = {
    databasePath,
    quickCheck: quickValues,
    foreignKeyViolations: foreignKeys,
    schemaVersion,
    expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
    migrations: listSchemaMigrations(db),
    ok: quickValues.length === 1 && quickValues[0].toLowerCase() === "ok" &&
      foreignKeys.length === 0 && schemaVersion >= CURRENT_SCHEMA_VERSION,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  db.close();
}
