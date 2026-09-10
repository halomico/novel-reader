ALTER TABLE telegram_outbox ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE telegram_outbox ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_telegram_outbox_claimable
  ON telegram_outbox(next_attempt_at, lease_expires_at, id)
  WHERE status = 'pending';
