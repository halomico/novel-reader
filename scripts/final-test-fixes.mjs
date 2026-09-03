import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const p = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(p(file), "utf8");
const write = (file, value) => fs.writeFileSync(p(file), value.replace(/\r\n?/g, "\n"));

const migrationTest = "src/core/db/content-access-migration.test.ts";
if (fs.existsSync(p(migrationTest))) write(migrationTest, read(migrationTest).replace(/cn,us/g, "CN,US"));

write("src/lib/password.test.ts", `import assert from "node:assert/strict";\nimport crypto from "node:crypto";\nimport test from "node:test";\nimport { hashPassword, hashPasswordAsync, passwordNeedsRehash, verifyPassword, verifyPasswordAsync } from "./password";\n\ntest("synchronous administrator compatibility hashes remain salted and verifiable", () => {\n  const first = hashPassword("correct horse battery staple");\n  const second = hashPassword("correct horse battery staple");\n  assert.notEqual(first, second);\n  assert.equal(verifyPassword("correct horse battery staple", first), true);\n  assert.equal(verifyPassword("wrong password", first), false);\n});\n\ntest("normal user passwords use asynchronous scrypt and reject malformed hashes", async () => {\n  const hash = await hashPasswordAsync("a long memorable user passphrase");\n  assert.match(hash, /^scrypt:v1:/u);\n  assert.equal(await verifyPasswordAsync("a long memorable user passphrase", hash), true);\n  assert.equal(await verifyPasswordAsync("incorrect", hash), false);\n  assert.equal(await verifyPasswordAsync("anything", "broken"), false);\n  assert.equal(passwordNeedsRehash(hash), false);\n});\n\ntest("legacy PBKDF2 users remain valid and are marked for upgrade", async () => {\n  const salt = "legacy-salt";\n  const iterations = 20_000;\n  const expected = crypto.pbkdf2Sync("legacy-password", salt, iterations, 32, "sha256").toString("base64url");\n  const legacy = \`pbkdf2-sha256:\${iterations}:\${salt}:\${expected}\`;\n  assert.equal(await verifyPasswordAsync("legacy-password", legacy), true);\n  assert.equal(passwordNeedsRehash(legacy), true);\n});\n`);

write("src/lib/admin-access.test.ts", `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { getClientIp, matchesIpRule, normalizeAdminNetworkRules } from "./admin-access";\n\nconst previousMode = process.env.TRUST_PROXY_MODE;\nconst previousSecret = process.env.TRUST_PROXY_SECRET;\nprocess.env.TRUST_PROXY_MODE = "signed";\nprocess.env.TRUST_PROXY_SECRET = "0123456789abcdef0123456789abcdef";\ntest.after(() => {\n  if (previousMode === undefined) delete process.env.TRUST_PROXY_MODE; else process.env.TRUST_PROXY_MODE = previousMode;\n  if (previousSecret === undefined) delete process.env.TRUST_PROXY_SECRET; else process.env.TRUST_PROXY_SECRET = previousSecret;\n});\n\ntest("IP and CIDR rules handle IPv4, IPv6, mapped IPv4 and wildcards", () => {\n  assert.equal(matchesIpRule("203.0.113.7", "203.0.113.7"), true);\n  assert.equal(matchesIpRule("203.0.113.7", "203.0.113.0/24"), true);\n  assert.equal(matchesIpRule("2001:db8::7", "2001:db8::/32"), true);\n  assert.equal(matchesIpRule("::ffff:203.0.113.7", "203.0.113.7"), true);\n  assert.equal(matchesIpRule("203.0.113.7", "198.51.100.0/24"), false);\n});\n\ntest("network rule normalization rejects malformed values", () => {\n  assert.deepEqual(normalizeAdminNetworkRules(["203.0.113.7", "2001:db8::/32", "bad", "203.0.113.7"]), ["203.0.113.7", "2001:db8::/32"]);\n});\n\ntest("admin client IP is accepted only from the signed proxy header", () => {\n  assert.equal(getClientIp(new Headers({\n    "x-novel-proxy-secret": process.env.TRUST_PROXY_SECRET!,\n    "x-novel-client-ip": "203.0.113.8",\n    "x-forwarded-for": "198.51.100.1",\n  })), "203.0.113.8");\n  assert.equal(getClientIp(new Headers({\n    "x-novel-proxy-secret": "wrong",\n    "x-novel-client-ip": "203.0.113.8",\n  })), "unknown");\n});\n`);

// Existing access-control fixtures now explicitly model a Cloudflare deployment.
for (const file of ["src/lib/content-access.test.ts", "src/lib/analytics.test.ts", "src/lib/search-analytics.test.ts"]) {
  if (!fs.existsSync(p(file))) continue;
  let source = read(file);
  if ((source.includes("cf-ipcountry") || source.includes("x-forwarded-for") || source.includes("cf-connecting-ip")) && !source.includes("TRUST_PROXY_MODE")) {
    source = source.replace(/^((?:import[^\n]+\n)+)/, `$1\nconst previousTrustProxyMode = process.env.TRUST_PROXY_MODE;\nprocess.env.TRUST_PROXY_MODE = "cloudflare";\ntest.after(() => {\n  if (previousTrustProxyMode === undefined) delete process.env.TRUST_PROXY_MODE;\n  else process.env.TRUST_PROXY_MODE = previousTrustProxyMode;\n});\n`);
    source = source.replace(/"x-forwarded-for"/g, '"cf-connecting-ip"');
    write(file, source);
  }
}

// Preserve internal call compatibility while public endpoints always supply an event ID.
{
  const file = "src/domains/originals/engagement.ts";
  let source = read(file);
  source = source.replace(
    /export function recordOriginalEngagement\(input: \{\n  eventId: string;[\s\S]*?\n\}\): OriginalEngagementResult \{\n  if \(!Number\.isSafeInteger\(input\.articleId\)/,
    `export function recordOriginalEngagement(input: {\n  eventId: string;\n  viewerKey: string;\n  articleId: number;\n  userId?: number | null;\n  action?: EngagementAction;\n  now?: number;\n} | number, legacyUserId?: number): OriginalEngagementResult {\n  const normalized = typeof input === "number"\n    ? {\n        eventId: \`legacy_\${Date.now()}_\${Math.random().toString(36).slice(2)}\`,\n        viewerKey: Number.isSafeInteger(legacyUserId) && Number(legacyUserId) > 0 ? \`user:\${legacyUserId}\` : \`legacy:\${Math.random().toString(36).slice(2)}\`,\n        articleId: input,\n        userId: legacyUserId,\n        action: "detail_view" as EngagementAction,\n      }\n    : input;\n  if (!Number.isSafeInteger(normalized.articleId)`,
  );
  source = source.replace(/input\.articleId/g, "normalized.articleId")
    .replace(/input\.action/g, "normalized.action")
    .replace(/input\.eventId/g, "normalized.eventId")
    .replace(/input\.viewerKey/g, "normalized.viewerKey")
    .replace(/input\.now/g, "normalized.now")
    .replace(/input\.userId/g, "normalized.userId");
  write(file, source);
}

console.log("Regression tests aligned with secure defaults.");
