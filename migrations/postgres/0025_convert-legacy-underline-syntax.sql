-- Rewrite the retired `==text==` underline syntax as the `<u>text</u>` the editor and the
-- reader both produce today, so the two places that still translated it can be deleted.
--
-- Fence-aware, because a formatting sample can legitimately show `==` inside a code
-- block, and the reader's renderer was careful about exactly that. Fences are tracked the
-- way CommonMark defines them — an opening run of three or more backticks is closed only
-- by a run at least as long with nothing after it — so a four-backtick block quoting a
-- three-backtick one does not throw the scan out of step.
CREATE FUNCTION pg_migration_underline_marks(source text) RETURNS text AS $$
DECLARE
  line text;
  fence integer := 0;
  opening integer;
  rebuilt text[] := ARRAY[]::text[];
BEGIN
  FOREACH line IN ARRAY string_to_array(source, E'\n') LOOP
    opening := coalesce(length((regexp_match(line, '^\s{0,3}(`{3,})'))[1]), 0);
    IF fence = 0 AND opening > 0 THEN
      fence := opening;
    ELSIF fence > 0 AND opening >= fence AND line ~ ('^\s{0,3}`{' || fence || ',}\s*$') THEN
      fence := 0;
    ELSIF fence = 0 THEN
      line := regexp_replace(line, '==([^=]+)==', '<u>\1</u>', 'g');
    END IF;
    rebuilt := rebuilt || line;
  END LOOP;
  RETURN array_to_string(rebuilt, E'\n');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE original_articles
SET body_markdown = pg_migration_underline_marks(body_markdown),
    paid_body_markdown = pg_migration_underline_marks(paid_body_markdown)
WHERE body_markdown ~ '==[^=]+==' OR paid_body_markdown ~ '==[^=]+==';

UPDATE original_article_revisions
SET body_markdown = pg_migration_underline_marks(body_markdown),
    paid_body_markdown = pg_migration_underline_marks(paid_body_markdown)
WHERE body_markdown ~ '==[^=]+==' OR paid_body_markdown ~ '==[^=]+==';

DROP FUNCTION pg_migration_underline_marks(text);
