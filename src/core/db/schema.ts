import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 2026090402;

export type SchemaMigrationRecord = {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
};

export function ensureCoreSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mutation_receipts (
      mutation_id TEXT PRIMARY KEY,
      user_id INTEGER,
      operation TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mutation_receipts_user_operation_time
      ON mutation_receipts(user_id, operation, created_at DESC);

    CREATE TABLE IF NOT EXISTS engagement_events (
      event_id TEXT PRIMARY KEY,
      viewer_key TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK(content_type IN ('novel', 'original', 'video', 'audio', 'file')),
      content_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('detail_view', 'read_open', 'play_start')),
      counted INTEGER NOT NULL DEFAULT 0 CHECK(counted IN (0, 1)),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_engagement_events_dedupe
      ON engagement_events(viewer_key, content_type, content_id, action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_engagement_events_created
      ON engagement_events(created_at);

    CREATE TABLE IF NOT EXISTS original_article_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER,
      author_id INTEGER NOT NULL,
      client_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      editor_state_json TEXT NOT NULL DEFAULT '',
      legacy_public_markdown TEXT NOT NULL DEFAULT '',
      legacy_paid_markdown TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      unlock_soda_price INTEGER NOT NULL DEFAULT 0 CHECK(unlock_soda_price >= 0),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      content_hash TEXT NOT NULL DEFAULT '',
      autosaved_at INTEGER NOT NULL,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(author_id, client_key),
      FOREIGN KEY(article_id) REFERENCES original_articles(id) ON DELETE SET NULL,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_original_drafts_author_updated
      ON original_article_drafts(author_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_original_drafts_article_author
      ON original_article_drafts(article_id, author_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS original_article_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      revision_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      paid_body_markdown TEXT NOT NULL DEFAULT '',
      outline_json TEXT NOT NULL DEFAULT '[]',
      editor_state_json TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(article_id, revision_no),
      FOREIGN KEY(article_id) REFERENCES original_articles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_original_revisions_article_created
      ON original_article_revisions(article_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS original_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      article_id INTEGER,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL CHECK(width > 0),
      height INTEGER NOT NULL CHECK(height > 0),
      size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
      alt_text TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      access_scope TEXT NOT NULL DEFAULT 'draft' CHECK(access_scope IN ('draft', 'public', 'paid')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES original_articles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_original_assets_article_scope
      ON original_assets(article_id, access_scope, id);
    CREATE INDEX IF NOT EXISTS idx_original_assets_owner_created
      ON original_assets(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_user_anonymization_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      previous_username TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_user_anonymization_user_time
      ON admin_user_anonymization_audit(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS background_leases (
      name TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      template TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_outbox_ready
      ON email_outbox(status, next_attempt_at, id);
  `);

  db.prepare(
    `INSERT INTO schema_migrations (version, name, checksum)
     VALUES (?, ?, ?)
     ON CONFLICT(version) DO NOTHING`,
  ).run(
    CURRENT_SCHEMA_VERSION,
    "core-hardening-and-original-drafts",
    "sha256:1d739405727bf14f4fe16d873f53f5471efb68b0958d82a6d73d60064ea67720",
  );
}

export function getAppliedSchemaVersion(db: DatabaseSync): number {
  const exists = db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get() as { found: number } | undefined;
  if (!exists) return 0;
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
    version: number;
  };
  return Number(row.version) || 0;
}

export function listSchemaMigrations(db: DatabaseSync): SchemaMigrationRecord[] {
  const exists = db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get() as { found: number } | undefined;
  if (!exists) return [];
  return (db.prepare(
    "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC",
  ).all() as Array<{ version: number; name: string; checksum: string; applied_at: string }>).map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}
