CREATE INDEX engagement_events_recent_counted_idx
  ON engagement_events (viewer_key, content_type, content_id, action, created_at DESC)
  WHERE counted = TRUE;

ALTER TABLE user_reading_history
  ADD COLUMN client_saved_at_ms bigint NOT NULL DEFAULT 0
  CHECK (client_saved_at_ms >= 0);

CREATE INDEX analytics_events_created_idx
  ON analytics_events (created_at DESC, id DESC);

CREATE INDEX analytics_events_novel_created_idx
  ON analytics_events (novel_id, created_at DESC, id DESC)
  WHERE novel_id IS NOT NULL;

CREATE INDEX user_reading_history_recent_idx
  ON user_reading_history (user_id, recorded_in_history, last_read_at DESC, id DESC);
