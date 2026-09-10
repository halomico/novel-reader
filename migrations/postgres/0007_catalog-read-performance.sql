-- Stable keyset order for the public catalog. The explicit C collation makes
-- ordering deterministic across database hosts and matches the read query.
CREATE INDEX novels_title_order_idx
  ON novels ((lower(title) COLLATE "C"), id);
CREATE INDEX novels_source_title_order_idx
  ON novels (source_id, (lower(title) COLLATE "C"), id);

-- Paid titles are normally a small subset. Partial indexes prevent a paid-only
-- catalog request from walking most of the free catalog before finding a page.
CREATE INDEX novels_soda_updated_idx
  ON novels (mtime_ms DESC, id DESC)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_source_soda_updated_idx
  ON novels (source_id, mtime_ms DESC, id DESC)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_soda_words_idx
  ON novels (word_count DESC, id DESC)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_source_soda_words_idx
  ON novels (source_id, word_count DESC, id DESC)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_soda_title_order_idx
  ON novels ((lower(title) COLLATE "C"), id)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_source_soda_title_order_idx
  ON novels (source_id, (lower(title) COLLATE "C"), id)
  WHERE access_mode = 'soda' AND soda_price > 0;

-- Reader navigation consistently applies overrides before the scanned order.
-- Index the exact expression so chapter pagination and adjacent navigation do
-- not need to sort every chapter on each page transition.
CREATE INDEX novel_chapters_effective_order_idx
  ON novel_chapters (novel_id, (COALESCE(sort_override, sort_order)), id);
