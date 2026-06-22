import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { getLibraryDir } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import { isNovelTextFile, parseNovelTitle } from "../src/lib/filename";

type ScanStats = {
  scanned: number;
  insertedOrUpdated: number;
  skipped: number;
  conflicts: string[];
};

const libraryDir = getLibraryDir();
const db = getDb();

if (!fs.existsSync(libraryDir)) {
  fs.mkdirSync(libraryDir, { recursive: true });
}

const files = fs
  .readdirSync(libraryDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && isNovelTextFile(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

const upsertByPath = db.prepare(`
  INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms, updated_at)
  VALUES (@title, @fileName, @relativePath, @sizeBytes, @mtimeMs, CURRENT_TIMESTAMP)
  ON CONFLICT(relative_path) DO UPDATE SET
    title = excluded.title,
    file_name = excluded.file_name,
    size_bytes = excluded.size_bytes,
    mtime_ms = excluded.mtime_ms,
    updated_at = CURRENT_TIMESTAMP
`);

const stats: ScanStats = {
  scanned: files.length,
  insertedOrUpdated: 0,
  skipped: 0,
  conflicts: [],
};

function scan() {
  db.exec("BEGIN");
  try {
    for (const fileName of files) {
      const title = parseNovelTitle(fileName);
      const relativePath = fileName;

      if (!title) {
        stats.skipped += 1;
        stats.conflicts.push(`${fileName}: 文件名解析后的标题为空`);
        continue;
      }

      const fullPath = path.join(libraryDir, fileName);
      const fileStat = fs.statSync(fullPath);
      upsertByPath.run({
        title,
        fileName,
        relativePath,
        sizeBytes: fileStat.size,
        mtimeMs: Math.round(fileStat.mtimeMs),
      });
      stats.insertedOrUpdated += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

scan();

console.log(`书库目录: ${libraryDir}`);
console.log(`发现 txt: ${stats.scanned}`);
console.log(`写入/更新: ${stats.insertedOrUpdated}`);
console.log(`跳过: ${stats.skipped}`);

if (stats.conflicts.length > 0) {
  console.log("");
  console.log("需要人工处理的冲突:");
  for (const conflict of stats.conflicts) {
    console.log(`- ${conflict}`);
  }
}
