import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const abs = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(abs(file), "utf8");
const write = (file, value) => {
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  fs.writeFileSync(abs(file), value.replace(/\r\n?/g, "\n"));
};
function replace(file, pattern, replacement, label) {
  const source = read(file);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${file}: missing ${label || pattern}`);
  write(file, next);
}
function replaceOptional(file, pattern, replacement) {
  const source = read(file);
  const next = source.replace(pattern, replacement);
  if (next !== source) write(file, next);
  return next !== source;
}
function ensureImport(file, statement) {
  const source = read(file);
  if (source.includes(statement)) return;
  const first = source.match(/^import[^\n]+\n/m);
  if (!first) throw new Error(`${file}: no import block`);
  write(file, source.replace(first[0], `${first[0]}${statement}\n`));
}

// Restore existing API route files that an earlier broad regex may have modified.
const explicitApiFiles = new Set([
  "src/app/api/original/[id]/engagement/route.ts",
  "src/app/api/original/drafts/route.ts",
  "src/app/api/original/drafts/[id]/route.ts",
  "src/app/api/original/drafts/[id]/publish/route.ts",
  "src/app/api/original/assets/route.ts",
  "src/app/api/live/route.ts",
  "src/app/api/ready/route.ts",
  "src/app/api/version/route.ts",
]);
const changedApi = execFileSync("git", ["diff", "--name-only", "f346bc25ce43957e7ce0ff81ac60c9125c5b6081", "--", "src/app/api"], { encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean);
for (const file of changedApi) {
  if (!explicitApiFiles.has(file)) {
    execFileSync("git", ["checkout", "f346bc25ce43957e7ce0ff81ac60c9125c5b6081", "--", file]);
  }
}

// Keep compatibility exports for existing admin/tests while user auth uses asynchronous scrypt.
write("src/lib/password.ts", `import crypto from "node:crypto";\nimport { promisify } from "node:util";\n\nconst pbkdf2Async = promisify(crypto.pbkdf2);\nconst scryptAsync = promisify(crypto.scrypt);\nconst KEY_LENGTH = 32;\nconst SCRYPT_N = 1 << 15;\nconst SCRYPT_R = 8;\nconst SCRYPT_P = 1;\nconst SCRYPT_MAXMEM = 64 * 1024 * 1024;\nconst CONCURRENCY = Math.min(Math.max(Number(process.env.PASSWORD_VERIFY_CONCURRENCY) || 4, 2), 8);\nconst DUMMY_SALT = Buffer.from("novel-reader-fixed-dummy-salt-v1", "utf8");\nlet activeJobs = 0;\nconst waiters: Array<() => void> = [];\n\nasync function withSlot<T>(operation: () => Promise<T>): Promise<T> {\n  if (activeJobs >= CONCURRENCY) await new Promise<void>((resolve) => waiters.push(resolve));\n  activeJobs += 1;\n  try { return await operation(); } finally { activeJobs -= 1; waiters.shift()?.(); }\n}\nfunction safeEqual(left: Buffer | string, right: Buffer | string): boolean {\n  const a = Buffer.isBuffer(left) ? left : Buffer.from(left);\n  const b = Buffer.isBuffer(right) ? right : Buffer.from(right);\n  return a.length === b.length && crypto.timingSafeEqual(a, b);\n}\nasync function deriveAsync(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Promise<Buffer> {\n  return withSlot(async () => Buffer.from(await scryptAsync(password, salt, KEY_LENGTH, {\n    N: n, r, p, maxmem: Math.max(SCRYPT_MAXMEM, 128 * n * r + 1024 * 1024),\n  })));\n}\nfunction deriveSync(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Buffer {\n  return crypto.scryptSync(password, salt, KEY_LENGTH, {\n    N: n, r, p, maxmem: Math.max(SCRYPT_MAXMEM, 128 * n * r + 1024 * 1024),\n  });\n}\nfunction parseScrypt(storedHash: string) {\n  const [scheme, version, nText, rText, pText, saltText, expected] = storedHash.split(":");\n  const n = Number(nText); const r = Number(rText); const p = Number(pText);\n  if (scheme !== "scrypt" || version !== "v1" || !Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) ||\n      n < 1 << 14 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16 || !saltText || !expected) return null;\n  return { n, r, p, salt: Buffer.from(saltText, "base64url"), expected };\n}\n\nexport async function hashPasswordAsync(password: string): Promise<string> {\n  const salt = crypto.randomBytes(16);\n  const hash = await deriveAsync(password, salt);\n  return \`scrypt:v1:\${SCRYPT_N}:\${SCRYPT_R}:\${SCRYPT_P}:\${salt.toString("base64url")}:\${hash.toString("base64url")}\`;\n}\nexport async function verifyPasswordAsync(password: string, storedHash?: string | null): Promise<boolean> {\n  if (!storedHash) { await deriveAsync(password, DUMMY_SALT); return false; }\n  const scrypt = parseScrypt(storedHash);\n  if (scrypt) {\n    try { return safeEqual((await deriveAsync(password, scrypt.salt, scrypt.n, scrypt.r, scrypt.p)).toString("base64url"), scrypt.expected); }\n    catch { return false; }\n  }\n  const [scheme, iterationsText, salt, expected] = storedHash.split(":");\n  const iterations = Number(iterationsText);\n  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 10_000 || iterations > 2_000_000 || !salt || !expected) {\n    await deriveAsync(password, DUMMY_SALT); return false;\n  }\n  try {\n    const actual = await withSlot(async () => pbkdf2Async(password, salt, iterations, KEY_LENGTH, "sha256"));\n    return safeEqual(Buffer.from(actual).toString("base64url"), expected);\n  } catch { return false; }\n}\n\n/** Synchronous compatibility for the separately rate-limited administrator credential path. */\nexport function hashPassword(password: string): string {\n  const salt = crypto.randomBytes(16);\n  const hash = deriveSync(password, salt);\n  return \`scrypt:v1:\${SCRYPT_N}:\${SCRYPT_R}:\${SCRYPT_P}:\${salt.toString("base64url")}:\${hash.toString("base64url")}\`;\n}\nexport function verifyPassword(password: string, storedHash: string): boolean {\n  const scrypt = parseScrypt(storedHash);\n  if (scrypt) {\n    try { return safeEqual(deriveSync(password, scrypt.salt, scrypt.n, scrypt.r, scrypt.p).toString("base64url"), scrypt.expected); }\n    catch { return false; }\n  }\n  const [scheme, iterationsText, salt, expected] = storedHash.split(":");\n  const iterations = Number(iterationsText);\n  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 10_000 || iterations > 2_000_000 || !salt || !expected) return false;\n  const actual = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256").toString("base64url");\n  return safeEqual(actual, expected);\n}\nexport function passwordNeedsRehash(storedHash: string): boolean {\n  const parsed = parseScrypt(storedHash);\n  return !parsed || parsed.n !== SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P;\n}\n`);

{
  const file = "src/lib/user-auth.ts";
  replaceOptional(file, /import \{ hashPassword, passwordNeedsRehash, verifyPassword \} from "\.\/password";/, 'import { hashPasswordAsync, passwordNeedsRehash, verifyPasswordAsync } from "./password";');
  replaceOptional(file, /return hashPassword\(password\);/, "return hashPasswordAsync(password);");
  replaceOptional(file, /return verifyPassword\(password, storedHash\);/, "return verifyPasswordAsync(password, storedHash);");
}

// Central middleware guard replaces brittle per-route source rewriting.
{
  const file = "src/middleware.ts";
  ensureImport(file, 'import { validateSameOriginMutation } from "@/core/security/origin";');
  const marker = "function bypassGlobalAccess";
  if (!read(file).includes("function guardBrowserApiMutation")) {
    replace(file, marker, `const BROWSER_MUTATION_API = [\n  "/api/account/",\n  "/api/analytics/",\n  "/api/novels/",\n  "/api/original/",\n  "/api/reports",\n  "/api/media/",\n];\n\nfunction guardBrowserApiMutation(request: NextRequest, pathname: string): Response | null {\n  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;\n  if (!BROWSER_MUTATION_API.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return null;\n  if (pathname === "/api/original/assets") return validateSameOriginMutation(request, { requireJson: false });\n  return validateSameOriginMutation(request, { requireJson: false });\n}\n\n${marker}`, "middleware mutation guard");
  }
  replace(
    file,
    /export function middleware\(request: NextRequest\) \{\n  const normalizedPath = stripLocalePath\(request\.nextUrl\.pathname\);/,
    `export function middleware(request: NextRequest) {\n  const normalizedPath = stripLocalePath(request.nextUrl.pathname);\n  const mutationGuard = guardBrowserApiMutation(request, normalizedPath);\n  if (mutationGuard) return mutationGuard;`,
    "invoke middleware mutation guard",
  );
}

// Next configuration: valid report-only CSP and optional production HSTS.
write("next.config.ts", `import type { NextConfig } from "next";\n\nconst securityHeaders = [\n  { key: "X-Content-Type-Options", value: "nosniff" },\n  { key: "X-Frame-Options", value: "SAMEORIGIN" },\n  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },\n  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },\n  {\n    key: "Content-Security-Policy-Report-Only",\n    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",\n  },\n  ...(process.env.ENABLE_HSTS === "1"\n    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]\n    : []),\n];\n\nconst nextConfig: NextConfig = {\n  output: "standalone",\n  poweredByHeader: false,\n  devIndicators: false,\n  async headers() {\n    return [{ source: "/:path*", headers: securityHeaders }];\n  },\n  experimental: {\n    serverActions: { bodySizeLimit: "2mb" },\n  },\n};\n\nexport default nextConfig;\n`);

// The first editor change must be emitted even before the user types.
{
  const file = "src/features/original-editor/OriginalComposerShell.tsx";
  replace(
    file,
    /useEffect\(\(\) => onEditor\(editor\), \[editor, onEditor\]\);\n  return <OnChangePlugin ignoreSelectionChange onChange=\{onState\} \/>;/,
    `useEffect(() => {\n    onEditor(editor);\n    onState(editor.getEditorState(), editor);\n  }, [editor, onEditor, onState]);\n  return <OnChangePlugin ignoreSelectionChange onChange={onState} />;`,
    "initial editor-state bridge",
  );
  // Replacing regular headings makes Markdown shortcuts receive stable anchor IDs as well.
  replace(
    file,
    /nodes: \[\n      HeadingNode,\n      OriginalHeadingNode,/,
    `nodes: [\n      {\n        replace: HeadingNode,\n        with: (node: HeadingNode) => $createOriginalHeadingNode(node.getTag() === "h3" ? "h3" : "h2"),\n        withKlass: OriginalHeadingNode,\n      },\n      OriginalHeadingNode,`,
    "heading node replacement",
  );
}

// Transactional market purchase idempotency.
{
  const file = "src/lib/market.ts";
  ensureImport(file, 'import { normalizeMutationId, readMutationReceipt, storeMutationReceipt } from "@/core/mutations/idempotency";');
  replaceOptional(file, /currency: UserCurrency;\n\}): MarketOrder \{\n  const db = getDb\(\);\n  db\.exec\("BEGIN IMMEDIATE"\);/, "currency: UserCurrency;\n  mutationId: string;\n}): MarketOrder {\n  const mutationId = normalizeMutationId(input.mutationId);\n  const db = getDb();\n  db.exec(\"BEGIN IMMEDIATE\");");
  replace(
    file,
    /  try \{\n    const user = db/,
    `  try {\n    const previous = readMutationReceipt<MarketOrder>(db, mutationId, input.userId, "market.purchase");\n    if (previous) {\n      db.exec("COMMIT");\n      return previous;\n    }\n    const user = db`,
    "read market receipt",
  );
  replaceOptional(file, /referenceKey: "",\n    \}\);\n    db\.exec\("COMMIT"\);/, "referenceKey: mutationId,\n    });\n    storeMutationReceipt(db, mutationId, input.userId, \"market.purchase\", order);\n    db.exec(\"COMMIT\");");
}
{
  const file = "src/app/market/actions.ts";
  replaceOptional(file, /const order = purchaseMarketProduct\(\{ userId: user\.id, productId, currency \}\);/, "const order = purchaseMarketProduct({ userId: user.id, productId, currency, mutationId: String(formData.get(\"mutationId\") || \"\") });");
}
{
  const file = "src/app/market/[slug]/page.tsx";
  ensureImport(file, 'import crypto from "node:crypto";');
  let source = read(file);
  source = source.replace(/<input type="hidden" name="currency" value="cookie" \/>/g, '<input type="hidden" name="currency" value="cookie" />\n              <input type="hidden" name="mutationId" value={`market_${crypto.randomUUID().replace(/-/g, "")}`} />');
  source = source.replace(/<input type="hidden" name="currency" value="soda" \/>/g, '<input type="hidden" name="currency" value="soda" />\n              <input type="hidden" name="mutationId" value={`market_${crypto.randomUUID().replace(/-/g, "")}`} />');
  write(file, source);
}

// Build test-friendly schema bootstrapping before the legacy index statements run.
{
  const file = "src/lib/db.ts";
  if (!read(file).includes("ensureCoreSchema(db);")) throw new Error("db.ts did not receive core schema integration");
}

// Update CI to validate the real submitted tree and lockfile.
write(".github/workflows/ci.yml", `name: CI\n\non:\n  pull_request:\n  push:\n    branches: [main, top-tier-rebuild-20260904]\n  workflow_dispatch:\n\nconcurrency:\n  group: ci-\${{ github.workflow }}-\${{ github.ref }}\n  cancel-in-progress: true\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 24\n          cache: npm\n      - run: npm ci\n      - run: npm run typecheck\n      - run: npm test\n      - run: npm run build\n      - name: Verify clean dependency tree\n        run: git diff --exit-code -- package.json package-lock.json\n`);

console.log("Build-safe repair applied.");
