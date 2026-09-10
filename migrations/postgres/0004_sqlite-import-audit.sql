-- Historical access markers can contain proxy labels such as "unknown". Keep
-- the audit value verbatim instead of making cutover depend on lossy coercion.
ALTER TABLE novels ALTER COLUMN last_accessed_ip TYPE text USING last_accessed_ip::text;

CREATE TABLE sqlite_import_runs (
  id uuid PRIMARY KEY,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  source_schema_version integer NOT NULL CHECK (source_schema_version >= 0),
  table_counts jsonb NOT NULL,
  settings_imported boolean NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sqlite_import_runs_single_cutover UNIQUE (contract_version)
);

COMMENT ON TABLE sqlite_import_runs IS
  'Immutable receipt for the one-time, all-or-nothing SQLite cutover.';
