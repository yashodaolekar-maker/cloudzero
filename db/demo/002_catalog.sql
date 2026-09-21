-- Safe additive migration for existing demo instances; also runs on fresh initialization.
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS seed_key text;
CREATE UNIQUE INDEX IF NOT EXISTS demo_sessions_seed_key ON demo_sessions(seed_key) WHERE seed_key IS NOT NULL;
