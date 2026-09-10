import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");
const extensions = [".ts", ".tsx", ".js", ".jsx"];
const maintenanceEntryFiles = [
  "scan-books.ts",
  "reindex-postgres-content.ts",
  "reindex-postgres-originals.ts",
  "optimize-media.ts",
  "media-node.ts",
  "postgres-content-worker.ts",
  "db-migrate-postgres.ts",
  "db-verify-postgres.ts",
  "init-postgres.ts",
];
const forbiddenModules = new Set([
  "node:sqlite",
  "@/lib/db",
  "@/core/db/sqlite-import",
  "@/core/db/sqlite-import-contract",
]);
const forbiddenSourcePatterns = [/\bDATABASE_PATH\b/u, /\bCONTENT_SEARCH_INDEX_DIR\b/u];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function resolveLocal(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, ...extensions.map((extension) => `${base}${extension}`), ...extensions.map((extension) => path.join(base, `index${extension}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return path.normalize(candidate);
  }
  return null;
}

function imports(source) {
  const found = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(pattern)) found.push(match[1] || match[2] || match[3]);
  return found;
}

const entryFiles = filesBelow(path.join(sourceRoot, "app"))
  .filter((file) => extensions.includes(path.extname(file)) && !/\.test\.[^.]+$/u.test(file));
for (const candidate of ["instrumentation.ts", "middleware.ts"]) {
  const file = path.join(sourceRoot, candidate);
  if (existsSync(file)) entryFiles.push(file);
}
for (const candidate of maintenanceEntryFiles) {
  const file = path.join(projectRoot, "scripts", candidate);
  if (existsSync(file)) entryFiles.push(file);
}

const queue = entryFiles.map((file) => ({ file: path.normalize(file), chain: [path.relative(projectRoot, file)] }));
const visited = new Set();
const failures = [];
while (queue.length) {
  const current = queue.shift();
  if (visited.has(current.file)) continue;
  visited.add(current.file);
  const source = readFileSync(current.file, "utf8");
  for (const pattern of forbiddenSourcePatterns) {
    if (pattern.test(source)) failures.push(`${current.chain.join(" -> ")} contains ${pattern.source}`);
  }
  for (const specifier of imports(source)) {
    if (forbiddenModules.has(specifier)) failures.push(`${current.chain.join(" -> ")} -> ${specifier}`);
    const resolved = resolveLocal(current.file, specifier);
    if (resolved && !visited.has(resolved)) queue.push({ file: resolved, chain: [...current.chain, path.relative(projectRoot, resolved)] });
  }
}

const unreachableFiles = filesBelow(sourceRoot)
  .filter((file) => extensions.includes(path.extname(file)))
  .filter((file) => !/\.(?:test|d)\.[^.]+$/u.test(file))
  .filter((file) => !visited.has(path.normalize(file)))
  .map((file) => path.relative(projectRoot, file))
  .sort();
for (const file of unreachableFiles) failures.push(`${file} is not reachable from the application or a shipped command`);

if (failures.length) {
  console.error(`Runtime dependency audit failed (${failures.length} forbidden path${failures.length === 1 ? "" : "s"}):`);
  for (const failure of failures.sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Runtime dependency audit passed: ${visited.size} reachable files, no SQLite dependency or dead runtime module.`);
}
