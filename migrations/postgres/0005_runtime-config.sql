ALTER TABLE users
  ADD CONSTRAINT users_status_valid
  CHECK (status IN ('active', 'disabled', 'pending')) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_status_valid;

CREATE UNIQUE INDEX users_username_normalized_unique
  ON users ((lower(username)));

ALTER TABLE user_sessions
  ADD CONSTRAINT user_sessions_id_format
  CHECK (id ~ '^[A-Za-z0-9_-]{20,80}$') NOT VALID,
  ADD CONSTRAINT user_sessions_token_hash_format
  CHECK (token_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE user_sessions VALIDATE CONSTRAINT user_sessions_id_format;
ALTER TABLE user_sessions VALIDATE CONSTRAINT user_sessions_token_hash_format;

-- 0002 already indexes user_id. Replace the expiry-only index with the exact
-- order used by bounded session cleanup instead of paying for duplicate indexes.
DROP INDEX idx_user_sessions_expires;
CREATE INDEX user_sessions_expiry_idx ON user_sessions (expires_at, id);

ALTER TABLE site_settings
  ADD CONSTRAINT site_settings_key_format
  CHECK (key ~ '^[a-z0-9]([a-z0-9._-]{0,126}[a-z0-9])?$') NOT VALID,
  ADD CONSTRAINT site_settings_value_size
  CHECK (octet_length(value::text) <= 1048576) NOT VALID;
ALTER TABLE site_settings VALIDATE CONSTRAINT site_settings_key_format;
ALTER TABLE site_settings VALIDATE CONSTRAINT site_settings_value_size;

CREATE OR REPLACE FUNCTION enforce_site_settings_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key <> OLD.key THEN
    RAISE EXCEPTION 'site_settings keys are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'site_settings version must advance by exactly one';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_settings_revision_guard
BEFORE UPDATE ON site_settings
FOR EACH ROW EXECUTE FUNCTION enforce_site_settings_revision();

CREATE OR REPLACE FUNCTION notify_site_settings_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'site_settings_changed',
    json_build_object('key', NEW.key, 'version', NEW.version)::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_settings_changed_notify
AFTER INSERT OR UPDATE ON site_settings
FOR EACH ROW EXECUTE FUNCTION notify_site_settings_changed();
