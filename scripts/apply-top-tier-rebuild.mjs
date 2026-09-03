import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.replace(/\r\n?/g, "\n"));
};

function replace(file, pattern, replacement, label = String(pattern)) {
  const source = read(file);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${file}: replacement not found: ${label}`);
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
  const firstImport = source.match(/^import[^\n]+\n/m);
  if (!firstImport) throw new Error(`${file}: cannot locate imports`);
  write(file, source.replace(firstImport[0], `${firstImport[0]}${statement}\n`));
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(relative));
    else result.push(relative);
  }
  return result;
}

// Dependencies and deterministic project commands.
{
  const file = "package.json";
  const pkg = JSON.parse(read(file));
  Object.assign(pkg.dependencies, {
    "@lexical/code": "^0.38.2",
    "@lexical/link": "^0.38.2",
    "@lexical/list": "^0.38.2",
    "@lexical/markdown": "^0.38.2",
    "@lexical/react": "^0.38.2",
    "@lexical/rich-text": "^0.38.2",
    "@lexical/selection": "^0.38.2",
    "@lexical/utils": "^0.38.2",
    "lexical": "^0.38.2"
  });
  pkg.scripts["db:backup"] = "tsx scripts/db-backup.ts";
  pkg.scripts["db:verify"] = "tsx scripts/db-verify.ts";
  pkg.scripts["test:migrations"] = "node --import tsx --test src/core/db/content-access-migration.test.ts";
  pkg.scripts["check"] = "npm run typecheck && npm test && npm run build";
  write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Fix the accidental Node-only import in the client heading node and expose a title limit.
replace(
  "src/features/original-editor/nodes/OriginalHeadingNode.ts",
  /import crypto from "node:crypto";\n/,
  "",
  "remove node:crypto from client bundle",
);
replace(
  "src/features/original-editor/nodes/OriginalHeadingNode.ts",
  /return `heading_\$\{crypto\.randomBytes\(16\)\.toString\("hex"\)\}`;/,
  "return `heading_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;",
  "browser heading-id fallback",
);
replace(
  "src/features/original-editor/OriginalComposerShell.tsx",
  /const LOCAL_SAVE_DELAY_MS = 350;/,
  "const MAX_TITLE_LENGTH = 100;\nconst LOCAL_SAVE_DELAY_MS = 350;",
  "composer title limit",
);

// Database bootstrap: invoke the safe migration and create all hardening tables.
{
  const file = "src/lib/db.ts";
  ensureImport(file, 'import { migrateContentAccessSchemaSafe } from "@/core/db/content-access-migration";');
  ensureImport(file, 'import { ensureCoreSchema } from "@/core/db/schema";');
  replace(
    file,
    /function migrateContentAccessSchema\(db: DatabaseSync\) \{[\s\S]*?\n\}\n\nfunction migrateUserEconomy/,
    "function migrateContentAccessSchema(db: DatabaseSync) {\n  migrateContentAccessSchemaSafe(db);\n}\n\nfunction migrateUserEconomy",
    "replace destructive content-access migration",
  );
  replace(
    file,
    /\n  migrateContentAccessSchema\(db\);/,
    "\n  migrateContentAccessSchema(db);\n  ensureCoreSchema(db);",
    "bootstrap core schema",
  );
  replaceOptional(
    file,
    /addColumnIfMissing\(db, "users", "registration_ip", "registration_ip TEXT"\);/,
    'addColumnIfMissing(db, "users", "registration_ip", "registration_ip TEXT");\n  addColumnIfMissing(db, "users", "deleted_at", "deleted_at TEXT");',
  );
}

// Daily administration must anonymize rather than physically delete users.
{
  const file = "src/lib/users.ts";
  replace(
    file,
    /export function deleteUserIds\(ids: number\[\]\): number \{[\s\S]*?\n\}\n\nexport function recordUserLogin/,
    `function userTableExists(db: ReturnType<typeof getDb>, name: string): boolean {\n  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));\n}\n\nfunction deleteUserRowsIfPresent(db: ReturnType<typeof getDb>, table: string, userId: number): void {\n  if (!userTableExists(db, table)) return;\n  const columns = new Set((db.prepare(\`PRAGMA table_info(\${table})\`).all() as Array<{ name: string }>).map((row) => row.name));\n  const column = columns.has("user_id") ? "user_id" : columns.has("owner_id") ? "owner_id" : "";\n  if (column) db.prepare(\`DELETE FROM \${table} WHERE \${column} = ?\`).run(userId);\n}\n\nexport function anonymizeUserIds(ids: number[], actor = "admin"): number {\n  const validIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];\n  if (!validIds.length) return 0;\n  const db = getDb();\n  const rows = db.prepare(\`SELECT id, username, avatar_path AS avatarPath, deleted_at FROM users WHERE id IN (\${validIds.map(() => "?").join(",")})\`).all(...validIds) as Array<{ id: number; username: string; avatarPath: string | null; deleted_at: string | null }>;\n  let anonymized = 0;\n  db.exec("BEGIN IMMEDIATE");\n  try {\n    for (const row of rows) {\n      if (row.deleted_at) continue;\n      for (const table of ["user_sessions", "email_verification_tokens", "user_email_verification_tokens", "telegram_user_links", "user_telegram_links"]) {\n        deleteUserRowsIfPresent(db, table, row.id);\n      }\n      const anonymousUsername = \`deleted-\${row.id}-\${Math.random().toString(36).slice(2, 10)}\`;\n      const changed = db.prepare(\`UPDATE users SET\n          username = ?, display_name = '已注销用户', email = NULL, email_verified_at = NULL,\n          password_hash = ?, avatar_path = NULL, status = 'disabled', role = 'user',\n          registration_ip = NULL, last_login_ip = NULL, last_login_at = NULL,\n          deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP\n        WHERE id = ? AND deleted_at IS NULL\`).run(anonymousUsername, \`disabled:\${anonymousUsername}\`, row.id).changes;\n      if (changed) {\n        db.prepare(\`INSERT INTO admin_user_anonymization_audit (user_id, previous_username, actor) VALUES (?, ?, ?)\`).run(row.id, row.username, actor.slice(0, 120));\n        anonymized += 1;\n      }\n    }\n    db.exec("COMMIT");\n  } catch (error) {\n    db.exec("ROLLBACK");\n    throw error;\n  }\n  for (const row of rows) if (row.avatarPath) removeAvatarFile(row.avatarPath);\n  return anonymized;\n}\n\n/** @deprecated Administrative deletion now preserves a tombstone and all historical records. */\nexport function deleteUserIds(ids: number[]): number {\n  return anonymizeUserIds(ids);\n}\n\nexport function recordUserLogin`,
    "replace physical user deletion",
  );
}

{
  const file = "src/app/admin/actions.ts";
  replaceOptional(file, /\bdeleteUserIds,/, "anonymizeUserIds,");
  replaceOptional(file, /const deleted = deleteUserIds\(ids\);\n  const deletedIds = ids\.filter\(\(id\) => !getUserById\(id\)\);/, "const deleted = anonymizeUserIds(ids, \"admin-panel\");\n  const deletedIds = deleted > 0 ? ids : [];");
  replaceOptional(file, /`已删除 \$\{deleted\} 个用户`/, "`已停用并匿名化 ${deleted} 个用户`");
  replaceOptional(file, /请选择要删除的用户/g, "请选择要停用并匿名化的用户");
}
for (const file of ["src/app/admin/users/page.tsx", "src/app/admin/users/[id]/page.tsx"]) {
  if (!fs.existsSync(path.join(root, file))) continue;
  let source = read(file)
    .replace(/删除用户/g, "停用并匿名化")
    .replace(/批量删除/g, "批量匿名化")
    .replace(/确认删除/g, "确认停用并匿名化");
  write(file, source);
}

// Trusted proxy identity is the only source for security-sensitive IP/country values.
{
  const file = "src/lib/admin-access.ts";
  ensureImport(file, 'import { getTrustedClientIp } from "@/core/security/client-ip";');
  replace(
    file,
    /export function getClientIp\(headers: Headers\): string \{[\s\S]*?\n\}/,
    "export function getClientIp(headers: Headers): string {\n  return getTrustedClientIp(headers);\n}",
    "trusted client IP",
  );
}
{
  const file = "src/lib/content-access.ts";
  ensureImport(file, 'import { getTrustedRequestCountry } from "@/core/security/client-ip";');
  replace(
    file,
    /export function getRequestCountry\(headers: HeaderReader\): string \{[\s\S]*?\n\}/,
    "export function getRequestCountry(headers: HeaderReader): string {\n  return getTrustedRequestCountry(headers);\n}",
    "trusted request country",
  );
}
{
  const file = "src/middleware.ts";
  ensureImport(file, 'import { getTrustedRequestCountry } from "@/core/security/client-ip";');
  replaceOptional(
    file,
    /request\.headers\.get\("cf-ipcountry"\)\?\.toUpperCase\(\) \|\| null/,
    "getTrustedRequestCountry(request.headers)",
  );
  replace(
    file,
    /matcher: \["\/\(\(\?!_next\/static\|_next\/image\)\.\*\)"\]/,
    'matcher: ["/((?!_next/static|_next/image|api/live|api/ready|api/version|site-icon/|default-avatars/|avatar-widgets/|media-file/|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|map|woff2?)$).*)"]',
    "narrow middleware matcher",
  );
}

// Integer configuration has a documented environment-first precedence rather than treating 0 as missing.
{
  const file = "src/lib/config.ts";
  replace(
    file,
    /function readSettingInt\(settingValue: number, envName: string, fallback: number, min: number, max: number\): number \{[\s\S]*?\n\}/,
    `function readSettingInt(settingValue: number, envName: string, fallback: number, min: number, max: number): number {\n  const configuredEnv = process.env[envName];\n  if (configuredEnv !== undefined && configuredEnv.trim() !== "") {\n    return readIntConfig(envName, fallback, min, max);\n  }\n  if (Number.isFinite(settingValue)) {\n    return Math.min(Math.max(Math.floor(settingValue), min), max);\n  }\n  return fallback;\n}`,
    "integer config precedence",
  );
}

// Async scrypt integration and legacy upgrade.
{
  const file = "src/lib/user-auth.ts";
  replaceOptional(file, /import \{ hashPassword, verifyPassword \} from "\.\/password";/, 'import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password";');
  replace(
    file,
    /export function hashUserPassword\(password: string\): string \{\n  return hashPassword\(password\);\n\}\n\nexport function verifyUserPassword\(password: string, storedHash: string\): boolean \{\n  return verifyPassword\(password, storedHash\);\n\}/,
    `export async function hashUserPassword(password: string): Promise<string> {\n  return hashPassword(password);\n}\n\nexport async function verifyUserPassword(password: string, storedHash?: string | null): Promise<boolean> {\n  return verifyPassword(password, storedHash);\n}`,
    "async password facade",
  );
  replaceOptional(file, /\n  deleteExpiredUserSessions\(\);/, "");
  replace(
    file,
    /  const row = getUserPasswordRow\(username\);\n  if \(!row \|\| row\.status === "disabled" \|\| !verifyUserPassword\(password, row\.password_hash\)\) \{\n    return \{ ok: false, message: "用户名或密码不正确" \};\n  \}/,
    `  const row = getUserPasswordRow(username);\n  const passwordValid = await verifyUserPassword(password, row?.password_hash);\n  if (!row || row.status === "disabled" || !passwordValid) {\n    return { ok: false, message: "用户名或密码不正确" };\n  }\n  if (passwordNeedsRehash(row.password_hash)) {\n    updateUserPasswordHash(row.id, await hashUserPassword(password));\n  }`,
    "constant-work login verification",
  );
  replaceOptional(file, /getUserPasswordRow, recordUserLogin, type UserProfile/, "getUserPasswordRow, recordUserLogin, updateUserPasswordHash, type UserProfile");
}
{
  const file = "src/lib/users.ts";
  replace(
    file,
    /if \(value\.length < 6 \|\| value\.length > 72\) \{\n    return "密码长度需要在 6-72 个字符之间";/,
    'if (value.length < 10 || value.length > 256) {\n    return "密码长度需要在 10-256 个字符之间";',
    "stronger password length",
  );
}
{
  const file = "src/app/account/actions.ts";
  ensureImport(file, 'import { checkLoginAttempt, clearLoginFailures, recordLoginFailure } from "@/core/security/auth-rate-limit";');
  replace(
    file,
    /  let userId = 0;\n  const db = getDb\(\);\n  try \{\n    if \(registrationMode === "invite"\) db\.exec\("BEGIN IMMEDIATE"\);/,
    `  const passwordHash = await hashUserPassword(password);\n  let userId = 0;\n  const db = getDb();\n  try {\n    if (registrationMode === "invite") db.exec("BEGIN IMMEDIATE");`,
    "hash before registration transaction",
  );
  replaceOptional(file, /passwordHash: hashUserPassword\(password\),/, "passwordHash,");
  replace(
    file,
    /  const verification = await verifyHumanRequest\(formData, "login", clientIp\);/,
    `  const throttle = checkLoginAttempt(clientIp, username);\n  if (!throttle.allowed) {\n    authNotice("/login", \`登录太频繁，请 \${throttle.retryAfterSeconds} 秒后再试\`, "warning", loginValues);\n  }\n  const verification = await verifyHumanRequest(formData, "login", clientIp);`,
    "login rate limit",
  );
  replace(
    file,
    /  if \(!result\.ok\) \{\n    authNotice\("\/login", result\.message, "warning", loginValues\);\n  \}\n  redirect\(returnTo\);/,
    `  if (!result.ok) {\n    recordLoginFailure(clientIp, username);\n    authNotice("/login", result.message, "warning", loginValues);\n  }\n  clearLoginFailures(clientIp, username);\n  redirect(returnTo);`,
    "login failure bookkeeping",
  );
  replaceOptional(file, /!verifyUserPassword\(currentPassword, passwordHash\)/, "!(await verifyUserPassword(currentPassword, passwordHash))");
  replaceOptional(file, /updateUserPasswordHash\(user\.id, hashUserPassword\(newPassword\)\);/, "updateUserPasswordHash(user.id, await hashUserPassword(newPassword));");
}
{
  const file = "src/app/admin/actions.ts";
  // hashPassword is used only inside async Server Actions in this file.
  write(file, read(file).replace(/(?<!await )hashPassword\(([^\n;]+)\)/g, "await hashPassword($1)"));
}

// Ensure all browser JSON mutations carry the preflight-forcing project header.
for (const file of walk("src").filter((name) => /\.(?:ts|tsx)$/.test(name))) {
  let source = read(file);
  if (!source.includes("fetch(")) continue;
  source = source
    .replace(/"Content-Type": "application\/json"(?!,\s*"X-Novel-Mutation")/g, '"Content-Type": "application/json", "X-Novel-Mutation": "1"')
    .replace(/'Content-Type': 'application\/json'(?!,\s*'X-Novel-Mutation')/g, "'Content-Type': 'application/json', 'X-Novel-Mutation': '1'");
  write(file, source);
}

// Guard cookie-authenticated JSON API mutations. Internal webhooks and binary delivery routes are deliberately excluded.
const guardedApiPatterns = [
  /^src\/app\/api\/account\//,
  /^src\/app\/api\/analytics\//,
  /^src\/app\/api\/novels\//,
  /^src\/app\/api\/reports\//,
  /^src\/app\/api\/original\//,
  /^src\/app\/api\/media\/\[id\]\/(?:favorite|feedback|grove|recommendation|unlock)\//,
];
for (const file of walk("src/app/api").filter((name) => name.endsWith("/route.ts") && guardedApiPatterns.some((pattern) => pattern.test(name)))) {
  if (file.includes("/original/drafts/") || file.includes("/original/assets/")) continue;
  let source = read(file);
  if (!/export async function (?:POST|PUT|PATCH|DELETE)\(/.test(source)) continue;
  if (!source.includes("validateSameOriginMutation")) {
    const importLine = 'import { validateSameOriginMutation } from "@/core/security/origin";\n';
    const firstImport = source.match(/^import[^\n]+\n/m);
    if (firstImport) source = source.replace(firstImport[0], `${firstImport[0]}${importLine}`);
  }
  source = source.replace(
    /export async function (POST|PUT|PATCH|DELETE)\(\s*(request|req)\s*:[^{]+\{(?!\n  const guard = validateSameOriginMutation)/g,
    (match) => `${match}\n  const guard = validateSameOriginMutation(${match.includes("req:") ? "req" : "request"});\n  if (guard) return guard;`,
  );
  write(file, source);
}

// New and edit entry points create/resume a durable draft before loading the writing bundle.
write("src/app/original/new/page.tsx", `import { OriginalDraftLauncher } from "@/features/original-editor/OriginalDraftLauncher";\n\nexport const dynamic = "force-dynamic";\n\nexport default function NewOriginalPage() {\n  return <OriginalDraftLauncher mode="new" />;\n}\n`);
write("src/app/original/[slug]/edit/page.tsx", `import { OriginalDraftLauncher } from "@/features/original-editor/OriginalDraftLauncher";\n\nexport const dynamic = "force-dynamic";\n\nexport default async function EditOriginalPage({ params }: { params: Promise<{ slug: string }> }) {\n  return <OriginalDraftLauncher mode="edit" articleSlug={(await params).slug} />;\n}\n`);

// Add the editor tag read model without coupling the client bundle to legacy original commands.
{
  const file = "src/features/original-editor/server.ts";
  const marker = "export function getOriginalDraftForAuthor";
  const insertion = `export function listOriginalEditorTags(): Array<{ id: number; name: string }> {\n  const db = getDb();\n  if (!tableExists(db, "tags")) return [];\n  const columns = tableColumns(db, "tags");\n  const where = columns.has("visibility") ? "WHERE visibility != 'hidden'" : columns.has("is_visible") ? "WHERE is_visible = 1" : "";\n  return (db.prepare(\`SELECT id, name FROM tags \${where} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 300\`).all() as Array<{ id: number; name: string }>);\n}\n\n`;
  replace(file, marker, `${insertion}${marker}`, "editor tag read model");
}

// Make original body handling fail closed: preserve source characters and reject excess length.
{
  const file = "src/lib/original.ts";
  replaceOptional(
    file,
    /function normalizeBody\(value: string\): string \{[\s\S]*?\n\}/,
    `function normalizeBody(value: string): string {\n  const body = value.replace(/\\r\\n?/g, "\\n");\n  if (body.length > MAX_ORIGINAL_BODY_LENGTH) {\n    throw new OriginalInputError(\`正文超过限制 \${body.length - MAX_ORIGINAL_BODY_LENGTH} 字\`);\n  }\n  return body;\n}`,
  );
  replaceOptional(
    file,
    /function normalizeStatus\(value: unknown\): OriginalArticleStatus \{[\s\S]*?\n\}/,
    `function normalizeStatus(value: unknown): OriginalArticleStatus {\n  if (value === "published" || value === "draft") return value;\n  return "hidden";\n}`,
  );
}

// Reader adjacent titles are collapsed to semantic text and wrap naturally rather than preserving source newlines.
{
  const file = "src/components/NovelReaderView.tsx";
  const helper = `function readerNavigationTitle(value: string): string {\n  return value.normalize("NFKC").replace(/\\s+/gu, " ").trim();\n}\n\n`;
  if (!read(file).includes("function readerNavigationTitle")) {
    replace(file, "function safeReturnHref", `${helper}function safeReturnHref`, "reader title normalizer");
  }
  let source = read(file)
    .replace(/title: await localizeText\(adjacentNovels\.previous\.title, locale\)/g, "title: readerNavigationTitle(await localizeText(adjacentNovels.previous.title, locale))")
    .replace(/title: await localizeText\(adjacentNovels\.next\.title, locale\)/g, "title: readerNavigationTitle(await localizeText(adjacentNovels.next.title, locale))");
  write(file, source);
}

// UI fixes: natural navigation wrapping and neutral workspace title icons.
{
  const file = "src/app/ui-final.css";
  const source = read(file);
  const patch = `\n\n/* Top-tier UI corrections: navigation titles wrap by content, not by artificial rows. */\n.readerNovelLink { align-items: center; min-height: 0; }\n.readerNovelTitle { min-width: 0; }\n.readerNovelTitle strong {\n  display: block;\n  min-height: 0;\n  white-space: normal;\n  overflow-wrap: anywhere;\n  word-break: break-word;\n  line-height: 1.5;\n  -webkit-line-clamp: unset;\n}\n.readerNovelNavigation { align-items: stretch; }\n`;
  if (!source.includes("Top-tier UI corrections")) write(file, `${source.trimEnd()}${patch}\n`);
}
{
  const file = "src/app/workspace.css";
  const source = read(file);
  const patch = `\n\n/* Workspace section icons stay neutral like the settings icon. */\n.workspaceShell h1 > svg,\n.workspaceShell h2 > svg,\n.accountShell h1 > svg,\n.activityPage h1 > svg,\n.messagesPage h1 > svg,\n.marketPage h1 > svg,\n.originalMinePage h1 > svg,\n.workspacePageTitle > svg,\n.workspaceSectionTitle > svg {\n  color: var(--textMuted, var(--muted, #7b818a)) !important;\n  fill: none !important;\n}\n`;
  if (!source.includes("Workspace section icons stay neutral")) write(file, `${source.trimEnd()}${patch}\n`);
}

// Security response headers start in report-only mode; production may opt into HSTS explicitly.
{
  const file = "next.config.ts";
  const source = read(file);
  if (!source.includes("Content-Security-Policy-Report-Only")) {
    const target = '{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },';
    const hsts = '${process.env.ENABLE_HSTS === "1" ? `\n          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },` : ""}';
    const replacement = `${target}\n          {\n            key: "Content-Security-Policy-Report-Only",\n            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",\n          },${hsts}`;
    write(file, source.replace(target, replacement));
  }
}

// Build identity is embedded in immutable container images and the app runs as an unprivileged user.
if (fs.existsSync(path.join(root, "Dockerfile"))) {
  let source = read("Dockerfile");
  if (!source.includes("ARG GIT_SHA")) {
    source = source.replace(/(FROM [^\n]+ AS runner\n)/, `$1ARG GIT_SHA=development\nARG BUILD_TIME=development\nENV APP_GIT_SHA=$GIT_SHA\nENV APP_BUILD_TIME=$BUILD_TIME\nENV APP_VERSION=2.0.0\n`);
  }
  if (!/USER (?:nextjs|node)/.test(source)) {
    source = source.replace(/(EXPOSE \d+)/, `RUN addgroup --system --gid 1001 nodejs \\\n  && adduser --system --uid 1001 nextjs \\\n  && chown -R nextjs:nodejs /app\nUSER nextjs\n\n$1`);
  }
  write("Dockerfile", source);
}

// The accidental export-only workflow must not ship as production behavior.
for (const file of [
  ".github/workflows/audit-export.yml",
  ".github/workflows/top-tier-export.yml",
  ".github/workflows/original-editor-export.yml",
]) {
  if (fs.existsSync(path.join(root, file))) fs.rmSync(path.join(root, file));
}

console.log("Top-tier source migration applied.");
