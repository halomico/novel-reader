-- The application is PostgreSQL-only. The one-time cutover receipt is no longer
-- part of the runtime schema and fresh installations must not retain it.
DROP TABLE IF EXISTS sqlite_import_runs;
