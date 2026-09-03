import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "../src/lib/config";

function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const source = getDatabasePath();
if (!fs.existsSync(source)) throw new Error(`Database does not exist: ${source}`);
const requested = process.argv[2];
const destination = path.resolve(requested || `${source}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite backup: ${destination}`);

const db = new DatabaseSync(source, { readOnly: true });
try {
  const quick = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const values = quick.flatMap((row) => Object.values(row)).map(String);
  if (values.length !== 1 || values[0].toLowerCase() !== "ok") {
    throw new Error(`Source database failed quick_check: ${values.join(", ")}`);
  }
  db.exec(`VACUUM INTO ${quoteSql(destination)}`);
} finally {
  db.close();
}

const backup = new DatabaseSync(destination, { readOnly: true });
try {
  const quick = backup.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const foreignKeys = backup.prepare("PRAGMA foreign_key_check").all();
  const ok = quick.some((row) => Object.values(row).some((value) => String(value).toLowerCase() === "ok"));
  if (!ok || foreignKeys.length) {
    fs.rmSync(destination, { force: true });
    throw new Error(`Backup verification failed (quick=${ok}, foreignKeys=${foreignKeys.length})`);
  }
} finally {
  backup.close();
}
console.log(destination);
