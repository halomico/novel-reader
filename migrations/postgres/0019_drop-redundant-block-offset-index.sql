-- The only char_start predicate (the paid-preview read) bounds char_start inside one
-- (document_id, generation), whose blocks the primary key already returns in block_no
-- order. Like the block_no index 0018 dropped, this one served nothing the key does not,
-- and cost ~3% of the library's text size plus a btree write per indexed block.
DROP INDEX IF EXISTS novel_content_blocks_document_generation_char_start_idx;
