CREATE TABLE IF NOT EXISTS incident_events (
  sequence_no BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  incident_id VARCHAR(160) NOT NULL,
  event_type VARCHAR(160) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id VARCHAR(160) NOT NULL,
  correlation_id VARCHAR(160) NOT NULL,
  payload JSONB NOT NULL,
  schema_version SMALLINT NOT NULL CHECK (schema_version = 2),
  previous_hash VARCHAR(64) NOT NULL,
  event_hash CHAR(64) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS incident_events_incident_time_idx
  ON incident_events (incident_id, occurred_at DESC);
