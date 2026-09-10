-- Performance optimization indexes for common query patterns
-- This migration addresses missing indexes discovered during PostgreSQL migration audit

-- Index for original reading history pagination (most common user query)
-- Covers: user_id, recorded_in_history filter, ORDER BY last_read_at DESC
CREATE INDEX IF NOT EXISTS original_reading_history_user_recorded_time_idx
  ON original_reading_history (user_id, last_read_at DESC, article_id DESC)
  WHERE recorded_in_history = TRUE;

-- Index for content block range queries with preview ratio
-- Covers: document_id, generation, char_start filtering for preview queries
CREATE INDEX IF NOT EXISTS novel_content_blocks_document_generation_char_start_idx
  ON novel_content_blocks (document_id, generation, char_start)
  INCLUDE (block_no, char_end);

-- Index for content block window queries (neighboring blocks)
-- Covers: document_id, generation, block_no range queries
-- Note: Removed original_text from INCLUDE as it can exceed btree size limits
CREATE INDEX IF NOT EXISTS novel_content_blocks_document_generation_block_range_idx
  ON novel_content_blocks (document_id, generation, block_no)
  INCLUDE (char_start, char_end);

-- Index for original article searching by title/excerpt
-- Improves ILIKE performance on title and excerpt fields
CREATE INDEX IF NOT EXISTS original_articles_title_trgm_idx
  ON original_articles USING gin (title gin_bigm_ops);

CREATE INDEX IF NOT EXISTS original_articles_excerpt_trgm_idx
  ON original_articles USING gin (excerpt gin_bigm_ops)
  WHERE excerpt IS NOT NULL AND excerpt <> '';

-- Index for original articles by author and status (common filter)
CREATE INDEX IF NOT EXISTS original_articles_author_status_idx
  ON original_articles (author_id, status, id);

-- Index for original comments by article and status (common filter)
CREATE INDEX IF NOT EXISTS original_comments_article_status_created_idx
  ON original_comments (article_id, created_at ASC, id ASC)
  WHERE status = 'published';

-- Index for original comment daily usage (quota checking)
CREATE INDEX IF NOT EXISTS original_comment_daily_usage_user_date_idx
  ON original_comment_daily_usage (user_id, usage_date);

-- Index for blocked author lookups
CREATE INDEX IF NOT EXISTS user_original_author_blocks_user_author_idx
  ON user_original_author_blocks (user_id, author_id);

-- Index for purchase lookups (common access check)
CREATE INDEX IF NOT EXISTS original_purchases_article_buyer_idx
  ON original_purchases (article_id, buyer_id);

-- Index for novel content search with multiple joins
-- Helps with the main content search query performance
CREATE INDEX IF NOT EXISTS novel_documents_novel_chapter_state_idx
  ON novel_documents (novel_id, chapter_id, state, active_generation)
  WHERE state = 'ready' AND active_generation > 0;

-- Index for content generations by state (filtering published content)
CREATE INDEX IF NOT EXISTS novel_content_generations_document_state_idx
  ON novel_content_generations (document_id, generation, state)
  WHERE state = 'published';

-- Index for novels by source and access mode (catalog filtering)
CREATE INDEX IF NOT EXISTS novels_source_access_updated_idx
  ON novels (source_id, access_mode, mtime_ms DESC, id DESC);

-- Partial index for free content (opposite of existing soda indexes)
CREATE INDEX IF NOT EXISTS novels_free_updated_idx
  ON novels (mtime_ms DESC, id DESC)
  WHERE access_mode <> 'soda' OR soda_price <= 0;

CREATE INDEX IF NOT EXISTS novels_source_free_updated_idx
  ON novels (source_id, mtime_ms DESC, id DESC)
  WHERE access_mode <> 'soda' OR soda_price <= 0;

-- Index for chapter navigation with effective ordering
-- Already exists from migration 0007, but ensure it's covering enough cases
CREATE INDEX IF NOT EXISTS novel_chapters_novel_effective_order_navigation_idx
  ON novel_chapters (novel_id, (COALESCE(sort_override, sort_order)), id)
  INCLUDE (title, title_override);

-- Analyze tables to update statistics after index creation
ANALYZE original_reading_history;
ANALYZE novel_content_blocks;
ANALYZE original_articles;
ANALYZE original_comments;
ANALYZE novel_documents;
ANALYZE novels;
ANALYZE novel_chapters;
