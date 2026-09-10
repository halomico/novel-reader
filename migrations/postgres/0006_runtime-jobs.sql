-- Durable PostgreSQL job leases. This migration deliberately evolves the
-- original table so already-applied 0001 checksums remain immutable.

ALTER TABLE content_jobs
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN max_attempts smallint NOT NULL DEFAULT 5,
  ADD COLUMN lease_token uuid,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN finished_at timestamptz;

-- A legacy running row without a usable lease cannot have a live owner. Put it
-- back in the queue before enforcing the lease invariant.
UPDATE content_jobs
SET status = 'queued',
    lease_owner = NULL,
    lease_expires_at = NULL,
    available_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE status = 'running'
  AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_token IS NULL);

UPDATE content_jobs
SET lease_owner = NULL,
    lease_expires_at = NULL,
    lease_token = NULL,
    finished_at = COALESCE(finished_at, updated_at)
WHERE status IN ('done', 'failed', 'cancelled');

UPDATE content_jobs
SET last_error = left(last_error, 2048)
WHERE char_length(last_error) > 2048;

ALTER TABLE content_jobs
  ADD CONSTRAINT content_jobs_dedupe_key_length
    CHECK (char_length(dedupe_key) BETWEEN 1 AND 256),
  ADD CONSTRAINT content_jobs_payload_object
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072),
  ADD CONSTRAINT content_jobs_progress_object
    CHECK (jsonb_typeof(progress) = 'object' AND octet_length(progress::text) <= 32768),
  ADD CONSTRAINT content_jobs_max_attempts_range
    CHECK (max_attempts BETWEEN 1 AND 100),
  ADD CONSTRAINT content_jobs_lease_shape
    CHECK (
      (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_token IS NOT NULL)
      OR
      (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL AND lease_token IS NULL)
    ),
  ADD CONSTRAINT content_jobs_lease_owner_length
    CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128),
  ADD CONSTRAINT content_jobs_error_length
    CHECK (last_error IS NULL OR char_length(last_error) <= 2048),
  ADD CONSTRAINT content_jobs_finished_state
    CHECK (
      (status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL)
      OR
      (status IN ('queued', 'running') AND finished_at IS NULL)
    );

DROP INDEX content_jobs_ready_idx;
CREATE INDEX content_jobs_ready_idx
  ON content_jobs (priority DESC, available_at, created_at, id)
  WHERE status = 'queued' AND cancel_requested = false;

CREATE INDEX content_jobs_expired_lease_idx
  ON content_jobs (lease_expires_at, id)
  WHERE status = 'running';

CREATE INDEX content_jobs_status_created_idx
  ON content_jobs (status, created_at DESC);
