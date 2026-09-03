import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const p = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(p(file), "utf8");
const write = (file, value) => fs.writeFileSync(p(file), value.replace(/\r\n?/g, "\n"));
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
}

// Keep public synchronous helpers for old tests/admin code; normal user auth calls the async variants.
{
  const file = "src/lib/user-auth.ts";
  replaceOptional(
    file,
    /import \{ hashPasswordAsync, passwordNeedsRehash, verifyPasswordAsync \} from "\.\/password";/,
    'import { hashPassword, hashPasswordAsync, passwordNeedsRehash, verifyPassword, verifyPasswordAsync } from "./password";',
  );
  replace(
    file,
    /export async function hashUserPassword\(password: string\): Promise<string> \{\n  return hashPasswordAsync\(password\);\n\}\n\nexport async function verifyUserPassword\(password: string, storedHash\?: string \| null\): Promise<boolean> \{\n  return verifyPasswordAsync\(password, storedHash\);\n\}/,
    `export function hashUserPassword(password: string): string {\n  return hashPassword(password);\n}\n\nexport async function hashUserPasswordAsync(password: string): Promise<string> {\n  return hashPasswordAsync(password);\n}\n\nexport function verifyUserPassword(password: string, storedHash: string): boolean {\n  return verifyPassword(password, storedHash);\n}\n\nexport async function verifyUserPasswordAsync(password: string, storedHash?: string | null): Promise<boolean> {\n  return verifyPasswordAsync(password, storedHash);\n}`,
    "user password compatibility exports",
  );
  replaceOptional(file, /const passwordValid = await verifyUserPassword\(password, row\?\.password_hash\);/, "const passwordValid = await verifyUserPasswordAsync(password, row?.password_hash);");
  replaceOptional(file, /updateUserPasswordHash\(row\.id, await hashUserPassword\(password\)\);/, "updateUserPasswordHash(row.id, await hashUserPasswordAsync(password));");
}
{
  const file = "src/app/account/actions.ts";
  replaceOptional(file, /hashUserPassword,\n  loginUser,\n  verifyUserPassword,/, "hashUserPasswordAsync,\n  loginUser,\n  verifyUserPasswordAsync,");
  replaceOptional(file, /await hashUserPassword\(password\)/g, "await hashUserPasswordAsync(password)");
  replaceOptional(file, /await verifyUserPassword\(currentPassword, passwordHash\)/g, "await verifyUserPasswordAsync(currentPassword, passwordHash)");
  replaceOptional(file, /await hashUserPassword\(newPassword\)/g, "await hashUserPasswordAsync(newPassword)");
}

// Existing programmatic purchase callers may omit a mutation ID; browser actions always provide one.
{
  const file = "src/lib/market.ts";
  replaceOptional(file, /mutationId: string;\n\}\): MarketOrder \{\n  const mutationId = normalizeMutationId\(input\.mutationId\);/, "mutationId?: string;\n}): MarketOrder {\n  const mutationId = input.mutationId\n    ? normalizeMutationId(input.mutationId)\n    : `market_legacy_${crypto.randomUUID().replace(/-/g, \"\")}`;");
}

// Use simple registered node classes; toolbar-created headings still carry stable IDs.
{
  const file = "src/features/original-editor/OriginalComposerShell.tsx";
  replaceOptional(
    file,
    /nodes: \[\n      \{\n        replace: HeadingNode,[\s\S]*?\n      \},\n      OriginalHeadingNode,/,
    "nodes: [\n      HeadingNode,\n      OriginalHeadingNode,",
  );
}

// Dynamic SQL values are deliberately limited to SQLite scalar values.
{
  const file = "src/features/original-editor/server.ts";
  replaceOptional(file, /const values: Record<string, unknown> = \{/, "const values: Record<string, string | number | null> = {");
}

console.log("Compatibility fixes applied.");
