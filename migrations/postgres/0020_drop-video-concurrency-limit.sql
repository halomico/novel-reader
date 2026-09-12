-- Per-level video concurrency is retired. Instantaneous capacity is enforced by the
-- storage node (MEDIA_NODE_MAX_VIDEO_STREAMS / MEDIA_NODE_VIDEO_BANDWIDTH_MBPS), which
-- reflects what the hardware can actually serve; a per-account ceiling on top of it only
-- blocked legitimate viewers on a second device.
ALTER TABLE user_levels DROP COLUMN IF EXISTS video_concurrency_limit;
