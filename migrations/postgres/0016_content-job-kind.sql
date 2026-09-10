-- Keep the durable queue aligned with the only executable production job.
-- Retired placeholder kinds never had a worker and therefore cannot be resumed.
DELETE FROM content_jobs WHERE kind <> 'search-index';

ALTER TABLE content_jobs
  DROP CONSTRAINT content_jobs_kind_check,
  ADD CONSTRAINT content_jobs_kind_check CHECK (kind = 'search-index');
