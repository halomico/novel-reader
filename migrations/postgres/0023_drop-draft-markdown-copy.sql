-- Drafts no longer carry a copy of the article they edit.
--
-- Opening a published article in the composer used to copy its markdown into the draft
-- row, purely so the editor had something to import when the draft had no Lexical state
-- yet. The draft now reads that markdown from `original_articles` directly, which is one
-- fewer copy to keep, and removes the window where a draft opened before an edit shows
-- the text as it was rather than as it is.
--
-- Nothing published ever came from these columns: publishing requires the draft's editor
-- state and refuses an empty one.
ALTER TABLE original_article_drafts
  DROP COLUMN legacy_public_markdown,
  DROP COLUMN legacy_paid_markdown;
