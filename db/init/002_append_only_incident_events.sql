-- Apply this migration explicitly to existing volumes; init scripts run only on a fresh database.
CREATE OR REPLACE FUNCTION reject_incident_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incident_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS incident_events_append_only ON incident_events;
CREATE TRIGGER incident_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON incident_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_incident_event_mutation();
