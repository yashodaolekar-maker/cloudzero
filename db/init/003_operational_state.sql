CREATE TABLE IF NOT EXISTS operational_state (
  state_key VARCHAR(80) PRIMARY KEY,
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE DELETE, TRUNCATE ON operational_state FROM PUBLIC;
