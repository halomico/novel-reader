import "dotenv/config";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "pg";
import { closePostgresPools, database, getPostgresPool, withTransaction } from "../src/core/db/postgres";
import {
  assessPostgresSchemaCompatibility,
  getPostgresSchemaStatus,
  migratePostgres,
  readPostgresMigrations,
} from "../src/core/db/postgres-migrations";
import { searchPostgresCatalogTitles } from "../src/domains/catalog/postgres-search";
import { scanPostgresNovelLibrary } from "../src/domains/catalog/postgres-library-scan";
import { scheduleMissingPostgresMediaPreparation } from "../src/domains/media/postgres-media-preparation";
import {
  appendPostgresNovelChapters,
  deletePostgresNovelChapterIds,
  updatePostgresNovelFile,
} from "../src/domains/catalog/postgres-novel-storage";
import { parseSimpleAndSearchQuery } from "../src/lib/search-query";
import {
  ContentVersionChangedError,
  publishPostgresContent,
  readPublishedContentWindow,
} from "../src/domains/reading/postgres-content";
import { readOnlyContentSearchTransaction, searchPostgresContent } from "../src/domains/reading/postgres-content-search";
import {
  getOriginalArticleBySlug,
  listOriginalArticles,
  purchaseOriginalArticle,
} from "../src/domains/originals/postgres-originals";
import { searchPostgresOriginalArticles } from "../src/domains/originals/postgres-search";

// Deliberately require a dedicated test credential. Never fall back to DATABASE_URL
// or load .env: this command must not migrate a developer's existing database.
const adminUrl = process.env.PG_INTEGRATION_ADMIN_URL;
if (!adminUrl) throw new Error("PG_INTEGRATION_ADMIN_URL is required; use an isolated PostgreSQL 18 + pg_bigm server");
const databaseName = `novel_reader_integration_${crypto.randomBytes(12).toString("hex")}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;

function parsedQuery(input: string) {
  const result = parseSimpleAndSearchQuery(input, { mode: "title" });
  if (!result.ok) throw new Error("message" in result ? result.message : "Invalid test search query");
  return result.query;
}

function parsedContentQuery(input: string) {
  const result = parseSimpleAndSearchQuery(input, { mode: "content" });
  if (!result.ok) throw new Error("message" in result ? result.message : "Invalid content test search query");
  return result.query;
}

async function assertSqlState(operation: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(operation, (error: unknown) => (
    error instanceof Error && "code" in error && error.code === code
  ));
}

function runMigrationProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/db-migrate-postgres.ts"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 60_000,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Migration process exited ${code ?? signal}: ${output}`));
    });
  });
}

test("real PostgreSQL 18 + pg_bigm integration", { timeout: 180_000 }, async (t) => {
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
  const previousEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_MIGRATION_DATABASE_URL: process.env.PG_MIGRATION_DATABASE_URL,
    POSTGRES_MIGRATIONS_DIR: process.env.POSTGRES_MIGRATIONS_DIR,
  };
  let created = false;
  t.after(async () => {
    await closePostgresPools();
    try {
      // The name is generated here, never accepted from an environment variable.
      if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin.end();
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  await admin.connect();
  const runtime = await admin.query<{ major: number; extension_available: boolean; preloaded: string }>(`
    SELECT current_setting('server_version_num')::integer / 10000 AS major,
           EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm' AND default_version = '1.2') AS extension_available,
           current_setting('shared_preload_libraries') AS preloaded
  `);
  assert.equal(runtime.rows[0].major, 18, "Requires a real PostgreSQL 18 server");
  assert.equal(runtime.rows[0].extension_available, true, "pg_bigm 1.2 must be installed in the server image");
  assert.ok(runtime.rows[0].preloaded.split(",").some((name) => name.trim() === "pg_bigm"));
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  created = true;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.PG_MIGRATION_DATABASE_URL = testUrl.toString();
  process.env.POSTGRES_MIGRATIONS_DIR = path.resolve("migrations/postgres");
  const migrations = await readPostgresMigrations();
  const pool = getPostgresPool();

  await t.test("fresh schema fails readiness; concurrent migration processes apply every file once", async () => {
    const before = await getPostgresSchemaStatus();
    assert.equal(before.currentVersion, 0);
    assert.equal(assessPostgresSchemaCompatibility(before).compatible, false);
    await Promise.all([runMigrationProcess(), runMigrationProcess()]);
    const status = await getPostgresSchemaStatus();
    assert.equal(assessPostgresSchemaCompatibility(status).compatible, true);
    assert.equal(status.currentVersion, migrations.at(-1)!.version);
    assert.deepEqual(status.pendingVersions, []);
    const ledger = await pool.query("SELECT version, name, checksum FROM app_schema_migrations ORDER BY version");
    assert.deepEqual(ledger.rows, migrations.map(({ version, name, checksum }) => ({ version, name, checksum })));
    await migratePostgres();
    const replay = await pool.query("SELECT version, name, checksum FROM app_schema_migrations ORDER BY version");
    assert.deepEqual(replay.rows, ledger.rows);
  });

  await t.test("startup media reconciliation is valid PostgreSQL and completes on an empty catalog", async () => {
    await scheduleMissingPostgresMediaPreparation();
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM media_prepare_jobs")).rows[0].count, 0);
  });

  await t.test("modified and unknown migration ledger entries fail closed", async () => {
    const first = migrations[0];
    await pool.query("UPDATE app_schema_migrations SET checksum = $1 WHERE version = $2", ["0".repeat(64), first.version]);
    try {
      await assert.rejects(migratePostgres(), /checksum changed/);
      await assert.rejects(getPostgresSchemaStatus(), /does not match its file/);
    } finally {
      await pool.query("UPDATE app_schema_migrations SET checksum = $1 WHERE version = $2", [first.checksum, first.version]);
    }
    const unknownVersion = migrations.at(-1)!.version + 1;
    await pool.query("INSERT INTO app_schema_migrations(version, name, checksum) VALUES ($1, 'unknown', $2)", [unknownVersion, "0".repeat(64)]);
    try {
      await assert.rejects(migratePostgres(), /has no matching file/);
      await assert.rejects(getPostgresSchemaStatus(), /has no matching file/);
    } finally {
      await pool.query("DELETE FROM app_schema_migrations WHERE version = $1", [unknownVersion]);
    }
  });

  await t.test("failed DDL rolls back its schema and ledger and releases the migration lock", async () => {
    const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-pg-integration-"));
    const sourceDirectory = process.env.POSTGRES_MIGRATIONS_DIR!;
    const failedVersion = migrations.at(-1)!.version + 1;
    try {
      await Promise.all(migrations.map((migration) => fs.writeFile(path.join(fixtureDirectory, migration.fileName), migration.sql)));
      await fs.writeFile(path.join(fixtureDirectory, `${String(failedVersion).padStart(4, "0")}_atomicity-probe.sql`),
        "CREATE TABLE migration_atomicity_probe (id integer); SELECT 1 / 0;\n");
      process.env.POSTGRES_MIGRATIONS_DIR = fixtureDirectory;
      await assert.rejects(migratePostgres(), /atomicity-probe.sql failed/);
      assert.equal((await pool.query("SELECT to_regclass('public.migration_atomicity_probe') AS relation")).rows[0].relation, null);
      assert.equal((await pool.query("SELECT 1 FROM app_schema_migrations WHERE version = $1", [failedVersion])).rowCount, 0);
    } finally {
      process.env.POSTGRES_MIGRATIONS_DIR = sourceDirectory;
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
    }
    // A fresh process would block here if the failed runner leaked its session lock.
    await runMigrationProcess();
  });

  await t.test("read-only migration connections are rejected before mutation", async () => {
    const migrationPool = getPostgresPool("migrations");
    await migrationPool.query("SET default_transaction_read_only = on");
    try {
      await assert.rejects(migratePostgres(), /configured read-only/);
    } finally {
      await migrationPool.query("SET default_transaction_read_only = off");
    }
  });

  await t.test("filesystem catalog scanning, publication and admin writes are PostgreSQL-native", async () => {
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-pg-library-"));
    const previousLibrary = process.env.NOVEL_LIBRARY_DIR;
    process.env.NOVEL_LIBRARY_DIR = libraryRoot;
    try {
      await fs.writeFile(path.join(libraryRoot, "繁體單本.txt"), "第一段\n第二段龍門", "utf8");
      const chapterDirectory = path.join(libraryRoot, "原生来源", "章回小说");
      await fs.mkdir(chapterDirectory, { recursive: true });
      await fs.writeFile(path.join(chapterDirectory, "001_开篇.txt"), "开篇修仙", "utf8");
      await fs.writeFile(path.join(chapterDirectory, "002_终章.txt"), "终章龍門", "utf8");

      const first = await scanPostgresNovelLibrary({ verifyHashes: true });
      assert.equal(first.books, 2);
      assert.equal(first.publishedDocuments, 3);
      assert.equal(first.republishedUnchangedDocuments, 0);
      const catalog = await pool.query<{
        id: number;
        title: string;
        storage_mode: "single" | "chapters";
        content_hash: string;
        published_content_version: string | null;
      }>(`SELECT id, title, storage_mode, content_hash, published_content_version
        FROM novels WHERE relative_path IN ('繁體單本.txt', '原生来源/章回小说') ORDER BY id`);
      assert.equal(catalog.rowCount, 2);
      const single = catalog.rows.find((row) => row.storage_mode === "single")!;
      const chapters = catalog.rows.find((row) => row.storage_mode === "chapters")!;
      assert.ok(typeof single.published_content_version === "string", "published single-file content must have a version");
      assert.match(single.published_content_version, /^sha256:[0-9a-f]{64}$/u);
      assert.equal((await pool.query(
        `SELECT count(*)::integer AS count FROM novel_chapters
          WHERE novel_id = $1 AND published_content_version ~ '^sha256:[0-9a-f]{64}$'`,
        [chapters.id],
      )).rows[0].count, 2);

      const replay = await scanPostgresNovelLibrary({ verifyHashes: true });
      assert.equal(replay.insertedOrUpdated, 0);
      assert.equal(replay.publishedDocuments, 0);
      assert.equal(replay.republishedUnchangedDocuments, 0);

      assert.equal(await appendPostgresNovelChapters(chapters.id, [
        new File(["番外修仙龍門"], "003_番外.txt", { type: "text/plain" }),
      ]), 1);
      const appended = await pool.query<{ id: number; published_content_version: string; content_hash: string }>(
        "SELECT id, published_content_version, content_hash FROM novel_chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT 1",
        [chapters.id],
      );
      assert.match(appended.rows[0].published_content_version, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(await deletePostgresNovelChapterIds(chapters.id, [appended.rows[0].id]), 1);
      assert.equal((await pool.query("SELECT chapter_count FROM novels WHERE id = $1", [chapters.id])).rows[0].chapter_count, 2);

      await updatePostgresNovelFile({ novelId: single.id, title: "繁體單本修订", content: "修订正文修仙龍門" });
      const revised = await pool.query<{ title: string; content_hash: string; published_content_version: string }>(
        "SELECT title, content_hash, published_content_version FROM novels WHERE id = $1",
        [single.id],
      );
      assert.equal(revised.rows[0].title, "繁體單本修订");
      assert.match(revised.rows[0].published_content_version, /^sha256:[0-9a-f]{64}$/u);
    } finally {
      if (previousLibrary === undefined) delete process.env.NOVEL_LIBRARY_DIR;
      else process.env.NOVEL_LIBRARY_DIR = previousLibrary;
      await fs.rm(libraryRoot, { recursive: true, force: true });
    }
  });

  let sourceId: number;
  let novelId: number;
  await t.test("catalog accepts Unicode and enforces source uniqueness, checks and foreign keys", async () => {
    const source = await pool.query<{ id: number }>(
      "INSERT INTO novel_sources(slug, name, relative_path) VALUES ('integration', '集成书库', 'integration') RETURNING id",
    );
    sourceId = source.rows[0].id;
    await assertSqlState(pool.query("INSERT INTO novel_sources(slug, name, relative_path) VALUES ('INTEGRATION', '重复', 'duplicate')"), "23505");
    const titles = ["修仙𠮷传", "修仙校园", "修仙后传", "繁體龍門", "百分%号_及\\符号"];
    for (const [index, title] of titles.entries()) {
      const inserted = await pool.query<{ id: number }>(`
        INSERT INTO novels(title, title_search_original, title_search_hans, normalization_version,
                           file_name, relative_path, source_id, mtime_ms)
        VALUES ($1, $1, $2, 1, $3, $3, $4, 100) RETURNING id
      `, [title, title === "繁體龍門" ? "繁体龙门" : null, `integration-${index}.txt`, sourceId]);
      if (index === 0) novelId = inserted.rows[0].id;
    }
    await assertSqlState(pool.query("UPDATE novels SET word_count = -1 WHERE id = $1", [novelId!]), "23514");
    await assertSqlState(pool.query("UPDATE novels SET source_id = -1 WHERE id = $1", [novelId!]), "23503");
  });

  await t.test("real catalog queries preserve implicit AND, Hans and cursor semantics across SQL shapes", async () => {
    // Pin all shapes to one connection to exercise pg's named-statement contract.
    await withTransaction(async (executor) => {
      const andPage = await searchPostgresCatalogTitles(executor, parsedQuery("修仙 传"), { sourceId: sourceId! });
      assert.deepEqual(new Set(andPage.items.map((item) => item.title)), new Set(["修仙𠮷传", "修仙后传"]));
      const hans = await searchPostgresCatalogTitles(executor, parsedQuery("龙门"));
      assert.deepEqual(hans.items.map((item) => item.title), ["繁體龍門"]);
      const first = await searchPostgresCatalogTitles(executor, parsedQuery("修仙"), { limit: 2 });
      assert.equal(first.items.length, 2);
      assert.ok(first.nextCursor);
      const second = await searchPostgresCatalogTitles(executor, parsedQuery("修仙"), { limit: 2, cursor: first.nextCursor });
      assert.equal(second.items.length, 1);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
    }, { readOnly: true });
  });

  await t.test("bigram index executes Chinese, supplementary characters and escaped literal searches", async () => {
    await withTransaction(async (executor) => {
      await executor.query({ text: "SET LOCAL enable_seqscan = off" });
      const search = "SELECT title FROM novels WHERE title_search_original LIKE likequery($1) AND source_id = $2 ORDER BY id";
      for (const [term, expected] of [
        ["修", ["修仙𠮷传", "修仙校园", "修仙后传"]],
        ["𠮷", ["修仙𠮷传"]],
        ["%", ["百分%号_及\\符号"]],
        ["_", ["百分%号_及\\符号"]],
        ["\\", ["百分%号_及\\符号"]],
      ] as const) {
        const result = await executor.query<{ title: string }>({ text: search, values: [term, sourceId!] });
        assert.deepEqual(result.rows.map((row) => row.title), expected);
      }
      const index = await executor.query<{ definition: string }>({
        text: `SELECT pg_get_indexdef(indexrelid) AS definition
          FROM pg_index WHERE indexrelid = 'novels_title_search_original_idx'::regclass`,
      });
      assert.match(index.rows[0].definition, /USING gin .*gin_bigm_ops/iu);
      const contentIndex = await executor.query<{ definition: string }>({
        text: `SELECT pg_get_indexdef(indexrelid) AS definition
          FROM pg_index WHERE indexrelid = 'novel_search_documents_text_idx'::regclass`,
      });
      assert.match(contentIndex.rows[0].definition, /USING gin .*gin_bigm_ops/iu);
      // Content search turns recheck off inside its own transaction only; everything else
      // keeps exact LIKE semantics.
      const settings = await executor.query<{ enabled: string }>({ text: "SHOW pg_bigm.enable_recheck" });
      assert.equal(Object.values(settings.rows[0])[0], "on");
    }, { readOnly: true });
  });

  await t.test("transaction failure rolls back writes and read-only transactions reject writes", async () => {
    await assertSqlState(withTransaction(async (executor) => {
      await executor.query({ text: "INSERT INTO site_settings(key, value) VALUES ('rollback-probe', '{}'::jsonb)" });
      await executor.query({ text: "UPDATE novels SET word_count = -1 WHERE id = $1", values: [novelId!] });
    }), "23514");
    assert.equal((await database().query({ text: "SELECT 1 FROM site_settings WHERE key = 'rollback-probe'" })).rowCount, 0);
    await assertSqlState(withTransaction(async (executor) => {
      await executor.query({ text: "INSERT INTO site_settings(key, value) VALUES ('readonly-probe', '{}'::jsonb)" });
    }, { readOnly: true }), "25006");
  });

  await t.test("original catalog, paid unlock and comment counters share one transactional PostgreSQL model", async () => {
    const accounts = await pool.query<{ id: number; username: string }>(`
      INSERT INTO users (username, display_name, password_hash, soda_balance)
      VALUES ('original-author', '原创作者', 'integration', 2),
             ('original-reader', '原创读者', 'integration', 10)
      RETURNING id, username
    `);
    const authorId = Number(accounts.rows.find((row) => row.username === "original-author")!.id);
    const readerId = Number(accounts.rows.find((row) => row.username === "original-reader")!.id);
    const inserted = await pool.query<{ id: number }>(`
      INSERT INTO original_articles (
        slug, author_id, title, excerpt, body_markdown, paid_body_markdown, word_count,
        access_mode, unlock_soda_price, status, published_at,
        title_search_original, content_search_original, normalization_version
      ) VALUES (
        'pg-original-integration', $1, '繁體原創', '集成摘要', '公开正文', '付费正文', 8,
        'paid', 3, 'published', clock_timestamp(), '繁體原創', '公开正文', 1
      ) RETURNING id
    `, [authorId]);
    const articleId = Number(inserted.rows[0].id);

    const list = await listOriginalArticles({ query: "繁體", pageSize: 10 });
    assert.deepEqual(list.items.map((article) => article.id), [articleId]);
    assert.equal(list.items[0].bodyMarkdown, "", "catalog pages must not fetch large article bodies");
    const detail = await getOriginalArticleBySlug("pg-original-integration");
    assert.equal(detail?.paidBodyMarkdown, "付费正文");

    const paidContentQuery = parsedContentQuery("付费正文");
    for (const viewer of [null, { id: readerId, role: "user" as const }, { id: authorId, role: "user" as const }]) {
      assert.deepEqual((await searchPostgresOriginalArticles(database(), {
        viewer,
        contentQuery: paidContentQuery,
      })).items, [], "paid original bodies are never indexed, whoever searches");
    }
    assert.deepEqual((await searchPostgresOriginalArticles(database(), {
      viewer: null,
      contentQuery: parsedContentQuery("公开正文"),
    })).items.map((article) => article.id), [articleId], "the public part of a paid original stays discoverable");

    const firstPurchase = await purchaseOriginalArticle(articleId, readerId);
    assert.deepEqual(firstPurchase, { purchased: true, price: 3 });
    const replayedPurchase = await purchaseOriginalArticle(articleId, readerId);
    assert.deepEqual(replayedPurchase, firstPurchase);
    assert.deepEqual((await searchPostgresOriginalArticles(database(), {
      viewer: { id: readerId, role: "user" },
      contentQuery: paidContentQuery,
    })).items, [], "unlocking changes what a reader can open, not what search indexes");
    const balances = await pool.query<{ username: string; soda_balance: string }>(
      "SELECT username, soda_balance FROM users WHERE id = ANY($1::bigint[]) ORDER BY username",
      [[authorId, readerId]],
    );
    assert.deepEqual(balances.rows, [
      { username: "original-author", soda_balance: "5" },
      { username: "original-reader", soda_balance: "7" },
    ]);
    assert.equal((await pool.query(
      "SELECT count(*)::integer AS count FROM original_purchases WHERE article_id = $1 AND buyer_id = $2",
      [articleId, readerId],
    )).rows[0].count, 1);

    const comment = await pool.query<{ id: number }>(
      "INSERT INTO original_comments(article_id, author_id, body_markdown) VALUES ($1, $2, '集成评论') RETURNING id",
      [articleId, readerId],
    );
    assert.equal((await pool.query("SELECT comment_count::integer AS count FROM original_articles WHERE id = $1", [articleId])).rows[0].count, 1);
    const commentId = Number(comment.rows[0].id);
    await pool.query("UPDATE original_comments SET status = 'hidden' WHERE id = $1", [commentId]);
    assert.equal((await pool.query("SELECT comment_count::integer AS count FROM original_articles WHERE id = $1", [articleId])).rows[0].count, 0);
    await pool.query("UPDATE original_comments SET status = 'published' WHERE id = $1", [commentId]);
    await pool.query("DELETE FROM original_comments WHERE id = $1", [commentId]);
    assert.equal((await pool.query("SELECT comment_count::integer AS count FROM original_articles WHERE id = $1", [articleId])).rows[0].count, 0);
    await assertSqlState(pool.query(
      "UPDATE original_articles SET access_mode = 'free' WHERE id = $1",
      [articleId],
    ), "23514");
  });

  await t.test("content builds publish atomically, stream bounded windows and cascade", async () => {
    await pool.query("UPDATE novels SET content_hash = 'source-v1', access_mode = 'soda', soda_price = 5 WHERE id = $1", [novelId!]);
    const text = `开篇😀繁體龍門${"甲".repeat(2_500)}终章`;
    const build = await publishPostgresContent({
      novelId: novelId!, text, sourceContentVersion: "source-v1", expectedPublishedVersion: null,
    });
    const first = await readPublishedContentWindow(database(), { documentId: build.documentId, contentVersion: build.contentVersion, blockNo: 0 });
    assert.equal(first.blocks.length, 2);
    assert.equal(first.blocks[0].originalText + first.blocks[1].originalText, text.slice(0, first.blocks[1].charEnd));
    const contentMatches = await searchPostgresContent(readOnlyContentSearchTransaction, parsedContentQuery("繁体龙门 终章"), {});
    assert.deepEqual(contentMatches.items.map((item) => item.novelId), [novelId!]);
    assert.deepEqual({ total: contentMatches.totalItems, estimated: contentMatches.estimated }, { total: 1, estimated: true },
      "a four-character keyword is verified, so its total is reported as an upper bound");
    const exactMatches = await searchPostgresContent(readOnlyContentSearchTransaction, parsedContentQuery("甲甲"), {});
    assert.deepEqual({ total: exactMatches.totalItems, estimated: exactMatches.estimated }, { total: 1, estimated: false },
      "a two-character keyword is one bigram, answered exactly with recheck off");
    const searchRow = await pool.query<{ generation: number; block_starts: number[]; search_text: string }>(
      "SELECT generation, block_starts, search_text FROM novel_search_documents WHERE document_id = $1", [build.documentId]);
    assert.equal(searchRow.rows[0].generation, build.generation, "publishing writes the search row in the same transaction");
    assert.equal(searchRow.rows[0].block_starts.length, first.blockCount);
    assert.ok(searchRow.rows[0].search_text.includes("繁体龙门"), "the indexed form is the Hans one");
    await assert.rejects(
      readPublishedContentWindow(database(), { documentId: build.documentId, contentVersion: "stale", blockNo: 0 }),
      ContentVersionChangedError,
    );
    await assertSqlState(pool.query("UPDATE novel_content_blocks SET char_end = 0 WHERE document_id = $1", [build.documentId]), "23514");
    await pool.query("DELETE FROM novels WHERE id = $1", [novelId!]);
    assert.equal((await pool.query("SELECT 1 FROM novel_documents WHERE id = $1", [build.documentId])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM novel_content_blocks WHERE document_id = $1", [build.documentId])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM novel_search_documents WHERE document_id = $1", [build.documentId])).rowCount, 0);
  });
});
