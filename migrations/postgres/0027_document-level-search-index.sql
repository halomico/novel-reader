-- Full-text search moves from a per-block index to a per-document one.
--
-- The old index answered "which blocks contain this bigram". The question search
-- actually asks is "which documents contain this keyword", and a 1200-code-point block
-- is the wrong unit for it: a word occurring in 96% of the library has one posting per
-- block (millions) instead of one per document (tens of thousands). Counting matches was
-- therefore impossible, and the code above the index had grown a 3000-result cap, a
-- 3-second budget and two competing scan strategies to hide that -- which is why a
-- common word took seconds and a mid-frequency word returned one result out of 4043.
--
-- Measured on a corpus built from a real Chinese lexicon: 0.259 index postings per
-- character at document level against 0.753 per block, and at 170,000 documents a first
-- page carrying an exact total in 24 ms for the worst keyword in the library.
--
-- The row must stay narrow. Its whole point is that the main heap (~20 MB for the
-- production library) is small enough to sit in cache permanently, so a bitmap scan over
-- tens of thousands of candidates never touches disk. search_text is large and is read
-- only when a keyword longer than one bigram has to be verified, so it belongs out of
-- line in TOAST; do not add wide columns here.
CREATE TABLE novel_search_documents (
  document_id bigint PRIMARY KEY REFERENCES novel_documents(id) ON DELETE CASCADE,
  novel_id integer NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  source_id integer REFERENCES novel_sources(id) ON DELETE SET NULL,
  generation integer NOT NULL CHECK (generation > 0),
  -- Normalized offset at which each block starts, so a match position in search_text
  -- resolves to the block whose original text renders the excerpt.
  block_starts integer[] NOT NULL,
  search_text text NOT NULL
);

ALTER TABLE novel_search_documents ALTER COLUMN search_text SET COMPRESSION lz4;

-- A row exists exactly while its document is published, so eligibility is row existence
-- and no query needs a correlated check against novel_documents to establish it.
CREATE INDEX novel_search_documents_text_idx
  ON novel_search_documents USING gin (search_text gin_bigm_ops) WITH (fastupdate = off);
CREATE INDEX novel_search_documents_source_idx ON novel_search_documents (source_id, document_id DESC);
CREATE INDEX novel_search_documents_novel_idx ON novel_search_documents (novel_id, document_id DESC);

-- Republishing rewrites one row per document, so reclaim at the same rate the block
-- table does instead of letting a rebuild double the table before autovacuum notices.
ALTER TABLE novel_search_documents SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02
);

-- Moving a book between libraries has to follow onto the relation that filters searches.
CREATE OR REPLACE FUNCTION propagate_novel_source_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    UPDATE novel_documents SET source_id = NEW.source_id WHERE novel_id = NEW.id;
    UPDATE novel_search_documents SET source_id = NEW.source_id WHERE novel_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

-- The per-block search text and its two GIN indexes are what this replaces. They are the
-- largest objects in the database (about 5.6 GB of index for a 10 GB library) and nothing
-- reads them any more. `npm run index:search-text` rebuilds novel_search_documents from
-- original_text, which is untouched here, so this is recoverable without the library
-- files. Dropping columns only unlinks them; run VACUUM FULL on novel_content_blocks
-- during a maintenance window to return the space to the filesystem.
DROP INDEX IF EXISTS novel_content_blocks_original_idx;
DROP INDEX IF EXISTS novel_content_blocks_hans_idx;
ALTER TABLE novel_content_blocks
  DROP COLUMN search_text_original,
  DROP COLUMN search_text_hans,
  DROP COLUMN search_window_start,
  DROP COLUMN search_window_end;

ANALYZE novel_search_documents;
