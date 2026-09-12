-- Turn content rate limiting on.
--
-- The guard itself was always live: `checkPostgresContentAccess` meters every book page,
-- chapter page, media route and search request against `content_access_policies`. It
-- simply had nothing to meter against, because the table ships empty — so a deployment
-- that set CONTENT_RATE_LIMIT_PER_MINUTE in its environment was configuring a knob that
-- reached no enforcement path. That knob is gone; this row is what it meant.
--
-- Guests only, so a signed-in reader is never throttled for reading quickly, and a block
-- that does trip clears in five minutes rather than an hour. Both numbers, the scope and
-- the audience are editable in 后台 → 访问控制 → 频率策略; deleting the row turns the
-- limit off again.
--
-- Only seeds an empty table: a deployment that already configured its own policies keeps
-- exactly what it configured.
INSERT INTO content_access_policies
  (name, enabled, scope, country_mode, audience, window_seconds, max_requests, block_seconds)
SELECT '访客内容访问频率', TRUE, 'all', 'all', 'guest', 60, 120, 300
WHERE NOT EXISTS (SELECT 1 FROM content_access_policies);
