-- Convert the two retired default-avatar markers to the one the generator reads.
--
-- `default-avatar:<n>` and `/default-avatars/<nn>.svg` predate the generated avatars and
-- were resolved in application code on every render. Rewriting the stored values to the
-- current `generated-avatar:<seed>` marker keeps each account looking exactly as it does
-- today and lets that translation be deleted.
--
-- The seeds match what the resolver produced: the numbered marker used its number as the
-- seed, and the file name used its number minus one, since those files were 1-indexed.
UPDATE users
SET avatar_path = 'generated-avatar:' || substring(avatar_path from '^default-avatar:(\d{1,2})$')
WHERE avatar_path ~ '^default-avatar:\d{1,2}$';

UPDATE users
SET avatar_path = 'generated-avatar:'
  || greatest(substring(avatar_path from '^/default-avatars/(\d{2})\.svg$')::integer - 1, 0)::text
WHERE avatar_path ~ '^/default-avatars/\d{2}\.svg$';
