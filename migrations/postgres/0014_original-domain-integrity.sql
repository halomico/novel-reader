-- Keep the denormalized public comment counter correct for every writer,
-- including imports, admin moderation and future background jobs.
UPDATE original_articles article
SET comment_count = counts.published_count
FROM (
  SELECT article.id,
         COUNT(comment.id) FILTER (WHERE comment.status = 'published')::bigint AS published_count
  FROM original_articles article
  LEFT JOIN original_comments comment ON comment.article_id = article.id
  GROUP BY article.id
) counts
WHERE article.id = counts.id
  AND article.comment_count IS DISTINCT FROM counts.published_count;

CREATE OR REPLACE FUNCTION maintain_original_article_comment_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    UPDATE original_articles
    SET comment_count = comment_count + 1
    WHERE id = NEW.article_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    UPDATE original_articles
    SET comment_count = GREATEST(comment_count - 1, 0)
    WHERE id = OLD.article_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.article_id IS DISTINCT FROM NEW.article_id THEN
      IF OLD.status = 'published' THEN
        UPDATE original_articles SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.article_id;
      END IF;
      IF NEW.status = 'published' THEN
        UPDATE original_articles SET comment_count = comment_count + 1 WHERE id = NEW.article_id;
      END IF;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      UPDATE original_articles
      SET comment_count = GREATEST(
        comment_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE -1 END,
        0
      )
      WHERE id = NEW.article_id;
    END IF;
  END IF;
  -- The return value of an AFTER trigger is ignored.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS original_comments_count_guard ON original_comments;
CREATE TRIGGER original_comments_count_guard
AFTER INSERT OR DELETE OR UPDATE OF status, article_id ON original_comments
FOR EACH ROW EXECUTE FUNCTION maintain_original_article_comment_count();

-- The numeric price is authoritative. Repair any pre-cutover drift before
-- making the invariant impossible to violate again.
UPDATE original_articles
SET access_mode = CASE WHEN unlock_soda_price > 0 THEN 'paid' ELSE 'free' END
WHERE access_mode IS DISTINCT FROM CASE WHEN unlock_soda_price > 0 THEN 'paid' ELSE 'free' END;

ALTER TABLE original_articles
  ADD CONSTRAINT original_articles_price_access_consistent
  CHECK (
    (unlock_soda_price = 0 AND access_mode = 'free') OR
    (unlock_soda_price > 0 AND access_mode = 'paid')
  ) NOT VALID;

ALTER TABLE original_articles
  VALIDATE CONSTRAINT original_articles_price_access_consistent;

CREATE INDEX original_purchases_buyer_time_idx
  ON original_purchases (buyer_id, created_at DESC, id DESC)
  INCLUDE (article_id);

CREATE INDEX original_articles_excerpt_search_idx
  ON original_articles USING gin (lower(excerpt) gin_bigm_ops) WITH (fastupdate = off)
  WHERE status = 'published';
