import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve(process.env.NEXT_DIST_DIR || ".next", "standalone");
const privateFilePattern = /^(?:\.env(?:\..*)?|admin-settings\.json)$|\.(?:db(?:-.*)?|sqlite\d*(?:-.*)?|pem|key|p12|pfx)$/iu;
const privateDirectoryNames = new Set(["data", "library", "backups", "deploy", "docs"]);

async function filesBelow(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

if (!existsSync(outputRoot) || !(await stat(outputRoot)).isDirectory()) {
  throw new Error(`Standalone output is missing: ${outputRoot}`);
}

const removed = [];
for (const file of await filesBelow(outputRoot)) {
  if (path.basename(file).toLocaleLowerCase("en-US").startsWith(".env")) {
    await rm(file, { force: true });
    removed.push(path.relative(outputRoot, file));
  }
}

const violations = [];
for (const file of await filesBelow(outputRoot)) {
  const relative = path.relative(outputRoot, file);
  const segments = relative.split(path.sep);
  if (privateFilePattern.test(path.basename(file)) || privateDirectoryNames.has(segments[0]?.toLocaleLowerCase("en-US"))) {
    violations.push(relative);
  }
}
if (violations.length) {
  throw new Error(`Standalone output contains private runtime files:\n${violations.map((file) => `- ${file}`).join("\n")}`);
}
console.log(`Standalone privacy audit passed${removed.length ? `; removed ${removed.length} generated environment file(s)` : ""}.`);
