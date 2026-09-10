CREATE TABLE content_access_rate_buckets (
  policy_id bigint NOT NULL REFERENCES content_access_policies(id) ON DELETE CASCADE,
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  window_expires_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  blocked_until timestamptz,
  PRIMARY KEY (policy_id, identity_hash),
  CHECK (window_expires_at > window_started_at)
);

CREATE INDEX content_access_rate_buckets_expiry_idx
  ON content_access_rate_buckets (greatest(window_expires_at, coalesce(blocked_until, window_expires_at)));
