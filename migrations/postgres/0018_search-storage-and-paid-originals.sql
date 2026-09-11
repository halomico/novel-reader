-- Full-text search storage, rebuild and paid-original hygiene.

-- Chinese UTF-8 blocks almost never reach pglz's 25% minimum saving, so PostgreSQL has
-- been storing every block uncompressed plus TOAST overhead (measured on a 1 GB Chinese
-- corpus: 0% of rows compressed, 1.17x the raw text per column). lz4 compresses any
-- saving (97% of rows, 0.92-0.96x). New and rewritten values use it; the content
-- normalization v3 rebuild below rewrites every block.
DO $$
BEGIN
  ALTER TABLE novel_content_blocks
    ALTER COLUMN original_text SET COMPRESSION lz4,
    ALTER COLUMN search_text_original SET COMPRESSION lz4,
    ALTER COLUMN search_text_hans SET COMPRESSION lz4;
EXCEPTION WHEN feature_not_supported THEN
  RAISE NOTICE 'This PostgreSQL build has no lz4; content blocks keep pglz';
END $$;

-- Same key columns as the primary key (document_id, generation, block_no); every lookup
-- it served is served by the key, and it would be ~0.02x of the library in extra writes.
DROP INDEX IF EXISTS novel_content_blocks_document_generation_block_range_idx;

-- A rebuild publishes a new generation per document and the cleanup job then deletes the
-- previous one. Vacuum at 2% dead rows instead of the 20% default so the next build
-- reuses that space instead of growing the table (a rebuilt test library measured twice
-- its compact size before VACUUM FULL).
ALTER TABLE novel_content_blocks SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02
);

-- Paid original bodies used to be concatenated into content_search_*, which made locked
-- text findable. Strip it before the new code serves a single search: rebuild the public
-- body form here (an approximation of the application normalizer, exact for plain
-- Chinese text) and mark the rows stale so `index:originals` writes the exact forms.
UPDATE original_articles
SET content_search_original = regexp_replace(lower(body_markdown), '[[:space:][:punct:]]+', '', 'g'),
    content_search_hans = NULL,
    normalization_version = 0
WHERE paid_body_markdown <> '';

-- Content normalization v3 narrows each block's search context to the longest public
-- keyword, which marks every indexed document stale. Queue the incremental rebuild so
-- search converges without an operator action; the dedupe key is the admin page's, so
-- this merges with a rebuild an operator has already queued. Search keeps serving the
-- current generation of each document until its replacement is published.
INSERT INTO content_jobs (id, kind, dedupe_key, payload, priority, max_attempts)
VALUES (gen_random_uuid(), 'search-index', 'content-index:global', '{"force": false}'::jsonb, 0, 5)
ON CONFLICT (kind, dedupe_key) WHERE status IN ('queued', 'running') DO NOTHING;
