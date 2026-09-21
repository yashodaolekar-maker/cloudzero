-- A separate PostgreSQL instance: these credentials and records are local demo data only.
CREATE ROLE demo_app LOGIN PASSWORD 'demo-app-local-only';
CREATE ROLE demo_proxy LOGIN PASSWORD 'demo-proxy-local-only';
CREATE TABLE demo_guard (purpose text PRIMARY KEY CHECK (purpose = 'CLOUDZERO_A2A_DEMO_ONLY'), schema_version integer NOT NULL);
INSERT INTO demo_guard VALUES ('CLOUDZERO_A2A_DEMO_ONLY', 1);
CREATE TABLE demo_sessions (
 id uuid PRIMARY KEY, scenario_id text NOT NULL, title text NOT NULL, revision integer NOT NULL DEFAULT 1,
 state text NOT NULL CHECK (state IN ('FAULTED','REPAIRED')), status text NOT NULL DEFAULT 'IDLE',
 incident_id text NOT NULL UNIQUE, workflow_id text, last_investigated_revision integer, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_resources (
 id text PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), role text NOT NULL,
 name text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,role)
);
CREATE TABLE demo_incidents (id text PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), role text NOT NULL, record jsonb NOT NULL);
CREATE TABLE demo_changes (id text PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), record jsonb NOT NULL);
CREATE TABLE demo_orders (id text PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), status text NOT NULL, amount numeric(10,2) NOT NULL);
CREATE TABLE demo_queries (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), template_id text NOT NULL, persona text NOT NULL,
 device_id text NOT NULL, revision integer NOT NULL, output jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_events (id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), type text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE demo_work_notes (id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX demo_queries_session ON demo_queries(session_id,observed_at);
CREATE INDEX demo_events_session ON demo_events(session_id,occurred_at);
GRANT CONNECT ON DATABASE cloudzero_demo TO demo_app,demo_proxy;
GRANT USAGE ON SCHEMA public TO demo_app,demo_proxy;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO demo_app;
GRANT INSERT,UPDATE ON demo_sessions,demo_resources,demo_incidents,demo_changes,demo_orders TO demo_app;
GRANT INSERT ON demo_events,demo_work_notes TO demo_app;
GRANT SELECT ON demo_guard,demo_sessions,demo_resources,demo_incidents,demo_changes,demo_orders TO demo_proxy;
GRANT SELECT,INSERT ON demo_queries TO demo_proxy;
