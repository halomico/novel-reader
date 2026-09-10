-- Content coordinates are UTF-16 offsets in the unmodified decoded source.
-- A composite foreign key prevents a chapter document belonging to another book.
ALTER TABLE novel_chapters ADD CONSTRAINT novel_chapters_owner_unique UNIQUE (novel_id, id);
ALTER TABLE novel_documents DROP CONSTRAINT novel_documents_chapter_id_fkey;
ALTER TABLE novel_documents ADD CONSTRAINT novel_documents_chapter_owner_fk
  FOREIGN KEY (novel_id, chapter_id) REFERENCES novel_chapters(novel_id, id) ON DELETE CASCADE;

-- Search context is derived; never duplicate overlapping source text on disk.
ALTER TABLE novel_content_blocks DROP COLUMN search_source_text;
ALTER TABLE novel_content_blocks DROP CONSTRAINT novel_content_blocks_original_text_check;
ALTER TABLE novel_content_blocks ADD CONSTRAINT novel_content_blocks_nonempty CHECK (octet_length(original_text) > 0);
ALTER TABLE novel_content_blocks ADD CONSTRAINT novel_content_blocks_bounded
  CHECK (octet_length(original_text) <= 65536 AND octet_length(search_text_original) <= 131072
    AND (search_text_hans IS NULL OR octet_length(search_text_hans) <= 131072));

ALTER TABLE novel_documents ADD COLUMN next_generation integer NOT NULL DEFAULT 1 CHECK (next_generation > 0);
UPDATE novel_documents SET next_generation = greatest(active_generation, coalesce(staging_generation, 0)) + 1;

CREATE TABLE novel_content_generations (
  document_id bigint NOT NULL REFERENCES novel_documents(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  build_token uuid NOT NULL UNIQUE,
  source_content_version text NOT NULL,
  expected_published_version text,
  content_version text NOT NULL,
  normalization_version integer NOT NULL CHECK (normalization_version > 0),
  total_utf16_length integer NOT NULL CHECK (total_utf16_length >= 0),
  stored_utf16_length integer NOT NULL DEFAULT 0 CHECK (stored_utf16_length >= 0 AND stored_utf16_length <= total_utf16_length),
  block_count integer NOT NULL DEFAULT 0 CHECK (block_count >= 0),
  state text NOT NULL DEFAULT 'building' CHECK (state IN ('building', 'published', 'obsolete', 'failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (document_id, generation)
);

-- Existing experimental generations are retained for inspection but cannot be
-- published by the new builder: only a complete manifest can be published.
CREATE INDEX novel_content_generations_cleanup_idx
  ON novel_content_generations (updated_at, document_id, generation)
  WHERE state IN ('obsolete', 'failed');
