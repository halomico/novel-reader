import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

// Every executable shipped in the image is named here. Ad-hoc tests, importers
// and host-only commands cannot be included through a scripts/*.ts glob.
const maintenanceCommands = {
  "scan:books": "scan-books",
  "index:search": "reindex-postgres-content",
  "index:originals": "reindex-postgres-originals",
  "optimize:media": "optimize-media",
  "media:serve": "media-node",
  "jobs:serve": "postgres-content-worker",
  "db:pg:migrate": "db-migrate-postgres",
  "db:pg:verify": "db-verify-postgres",
  "db:pg:init": "init-postgres",
};

// Refuse stale output, which could retain removed/host-only executables.
await rm("maintenance", { recursive: true, force: true });
await mkdir("maintenance");
await build({
  entryPoints: Object.values(maintenanceCommands).map((name) => `scripts/${name}.ts`),
  bundle: true, platform: "node", format: "cjs", target: "node24",
  external: ["sharp"], outdir: "maintenance",
});
const sourcePackage = JSON.parse(await readFile("package.json", "utf8"));
await writeFile("maintenance/package.json", JSON.stringify({
  name: sourcePackage.name, version: sourcePackage.version,
  private: true, license: sourcePackage.license,
  scripts: {
    start: "node server.js",
    ...Object.fromEntries(Object.entries(maintenanceCommands).map(([command, name]) => [command, `node maintenance/${name}.js`])),
  },
}, null, 2) + "\n");
