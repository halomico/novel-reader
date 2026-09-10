CREATE TABLE media_folders (
  kind text NOT NULL CHECK(kind IN ('video', 'audio', 'file')),
  storage_node_id text NOT NULL DEFAULT '',
  path text NOT NULL CHECK(path <> '' AND length(path) <= 600),
  mtime_ms bigint NOT NULL DEFAULT 0 CHECK(mtime_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(kind, storage_node_id, path)
);

WITH RECURSIVE asset_folders AS (
  SELECT kind, COALESCE(storage_node_id, '') AS storage_node_id,
    regexp_replace(substr(stored_name, length(kind) + 2), '(^|/)[^/]+$', '') AS path,
    mtime_ms
  FROM media_assets
), expanded AS (
  SELECT kind, storage_node_id, path, mtime_ms
  FROM asset_folders
  WHERE path <> ''
  UNION ALL
  SELECT kind, storage_node_id, regexp_replace(path, '/[^/]+$', ''), mtime_ms
  FROM expanded
  WHERE position('/' IN path) > 0
)
INSERT INTO media_folders (kind, storage_node_id, path, mtime_ms)
SELECT kind, storage_node_id, path, MAX(mtime_ms)
FROM expanded
GROUP BY kind, storage_node_id, path
ON CONFLICT (kind, storage_node_id, path) DO UPDATE
SET mtime_ms = GREATEST(media_folders.mtime_ms, EXCLUDED.mtime_ms),
    updated_at = clock_timestamp();

CREATE INDEX idx_media_folders_kind_path ON media_folders(kind, path text_pattern_ops);
CREATE INDEX idx_media_assets_kind_stored_name ON media_assets(kind, stored_name text_pattern_ops);

ALTER TABLE media_playback_jobs
  ADD COLUMN storage_node_id text NOT NULL DEFAULT '';

UPDATE media_playback_jobs job
SET storage_node_id = COALESCE(asset.storage_node_id, ''),
    status = CASE WHEN job.status = 'processing' THEN 'pending' ELSE job.status END,
    updated_at = clock_timestamp()
FROM media_assets asset
WHERE asset.id = job.media_id;

CREATE UNIQUE INDEX media_playback_jobs_one_processing_per_node
  ON media_playback_jobs(storage_node_id)
  WHERE status = 'processing';
