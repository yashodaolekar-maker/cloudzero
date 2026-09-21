# Interactive A2A database demo

Open http://localhost:3000/?a2aDemo=1 (A2A Mesh → investigation lab).

1. Choose from the 20 seeded incident cases in **Session history**, or select a scenario and **Create demo** for a fresh incident.
2. **Investigate** queries persisted PostgreSQL rows through the authenticated gRPC command proxy. The optional **Use local LLM** checkbox uses the existing quantized Ollama model to interpret those observations; unchecked runs use evidence summaries without model generation.
3. Inspect resource state, SQL evidence, agent requests/replies, incident and maintenance rows, work notes and session history.
4. **Apply demo repair** changes only this session's sandbox rows after an investigation of the current revision. **Investigate** again to collect fresh recovery evidence. **Inject demo fault** starts another revision; earlier observations remain visible.

This uses an actual separate PostgreSQL instance (`cloudzero-demo-postgres`, database `cloudzero_demo`) with fictional ITSM, CMDB and business records. It does not connect to ServiceNow or production devices. It models a DNS service failing to restart and a saturated connection pool; it does not stop a real DNS server or exhaust the PostgreSQL server's own connection pool. The legacy prewritten walkthrough remains visibly labelled, with obsolete execution controls disabled.

The 20 cases cover DNS, VLAN, wireless roaming, MTU, Kerberos, IIS, connection pools, transaction locks, replication, database log space, Linux disk/service/permissions, cloud routing/capacity/health probes, image rollout/readiness, middleware queues and certificate expiry. The main view shows deterministic team findings, the blocker, the responsible team and clickable workflow steps. These summaries use current-revision SQL evidence; unqueried checks remain pending and repaired rows remain unverified until investigated again.

`DEMO_SEED_CATALOG=true` creates exactly one retained seed session per catalogue case using a unique seed key. Restarting does not duplicate or reset those sessions. Existing manually created sessions also remain available. For a fresh SLA clock during a presentation, create a new demo; historical tickets retain their original opening time.

`training/demo/ENGINEER_RUNBOOKS.md` and `training/demo/evaluation-cases.jsonl` provide the curriculum and 20 synthetic exercises. The corresponding investigation procedure is supplied to the local model at runtime; expected answers are reserved for evaluation. These are not new model weights or reviewed SFT examples. Run `npx tsx scripts/build-demo-curriculum.ts` after changing the catalogue.

## Local services and parameters

`compose.yaml` enables the demo only in `LOCAL_SIMULATION` / `SIMULATION`. The application uses `demo_app`; the command proxy uses `demo_proxy`, which can read resource rows and append query evidence but cannot repair resources. Startup checks the dedicated database marker, schema version and proxy mutation privileges. Database unavailability produces an error, not fabricated evidence. The command proxy has its own TCP health check rather than the application's HTTP check.

The dedicated volume `cloudzero_demo_postgres_data` retains sessions across container restarts. Port 15433 binds to loopback for SQL inspection. Local-only credentials are in `compose.yaml` and `db/demo/001_demo.sql`; never use these settings for a live deployment. `compose.production.yaml` does not enable the demo. SQL initialization runs when the new volume is first created.

Existing demo databases require the additive `db/demo/002_catalog.sql` migration before enabling catalogue seeding. It adds a unique seed key and preserves existing records.

Each session has a revision and one active investigation. Repairs require all assigned roles' diagnostic queries for that revision. A restart marks unfinished investigations interrupted; operators can retry. Previous evidence is preserved in the ledger but excluded from the next demo round's model context. Requests accept predefined scenarios/actions, never arbitrary SQL or shell commands.

## Observability and limitations

Every agent exchange and decision is recorded against the owner incident in Activity & reviews and the existing Grafana simulation cohort. Each related team has a separate incident linked by the exact maintenance change. Session history also records faults, repairs and investigation outcomes. Model failures remain visible in task telemetry, with evidence-based fallback summaries.

The P1 one-hour / P2 eight-hour SLA policy remains unchanged. Repairing sandbox rows does not silently resolve an incident, label a decision correct, or prove a user's wireless roaming experience. Correct/wrong decisions require reviewer feedback. XLA needs the relevant user journey observations and agreed experience thresholds. These synthetic examples do not establish live accuracy or train model weights automatically.

## Verification

With the local stack running, `npx tsx scripts/test-a2a-demo.ts` creates two retained demo sessions and verifies SQL evidence before/after repairs, work notes, agent replies, stale-revision rejection, forged workflow rejection and denied proxy writes. `DEMO_TEST_BASE_URL` and `DEMO_TEST_DATABASE_URL` can point to another explicitly isolated test deployment.

Set `DEMO_TEST_ALL=true` to verify all 20 scenarios. These checks measure the deterministic workflow and SQL integration; they do not establish LLM answer accuracy. The local ledger's initial demo events before 2026-09-07 11:47 UTC used a legacy Date encoding. Verification preserves their original hashes with a narrowly scoped compatibility path; their source timestamp was not covered by the original digest. Newly appended payloads are JSON-normalized before hashing. No existing chain hashes are rewritten.
