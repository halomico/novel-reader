ALTER TABLE original_articles
  ADD COLUMN title_search_original text NOT NULL DEFAULT '',
  ADD COLUMN title_search_hans text,
  ADD COLUMN content_search_original text NOT NULL DEFAULT '',
  ADD COLUMN content_search_hans text,
  ADD COLUMN normalization_version integer NOT NULL DEFAULT 0
    CHECK (normalization_version >= 0);

-- Existing PostgreSQL rows remain searchable while the deterministic
-- application reindexer produces the versioned OpenCC forms.
UPDATE original_articles
SET title_search_original = lower(title),
    content_search_original = regexp_replace(
      lower(body_markdown || E'\n' || paid_body_markdown),
      '[[:space:][:punct:]]+',
      '',
      'g'
    );

ALTER TABLE original_articles
  ALTER COLUMN title_search_original DROP DEFAULT,
  ALTER COLUMN content_search_original DROP DEFAULT;

CREATE INDEX original_articles_title_search_original_idx
  ON original_articles USING gin (title_search_original gin_bigm_ops) WITH (fastupdate = off);
CREATE INDEX original_articles_title_search_hans_idx
  ON original_articles USING gin (title_search_hans gin_bigm_ops) WITH (fastupdate = off)
  WHERE title_search_hans IS NOT NULL;
CREATE INDEX original_articles_content_search_original_idx
  ON original_articles USING gin (content_search_original gin_bigm_ops) WITH (fastupdate = off);
CREATE INDEX original_articles_content_search_hans_idx
  ON original_articles USING gin (content_search_hans gin_bigm_ops) WITH (fastupdate = off)
  WHERE content_search_hans IS NOT NULL;

CREATE INDEX original_articles_search_visibility_idx
  ON original_articles (published_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX original_purchases_buyer_article_idx
  ON original_purchases (buyer_id, article_id);
