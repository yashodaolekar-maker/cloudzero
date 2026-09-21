<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

> Production status: the included Podman deployment is a hardened, loopback-only simulation—not an approved production remediation service. Review [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for implemented controls, release blockers, and the local runbook.

> Local document knowledge: see [KNOWLEDGE_INGESTION.md](./KNOWLEDGE_INGESTION.md) for page-cited PDF ingestion, integrity validation, and agent abstention behavior.

> Local containers: see [PODMAN_LOCAL.md](./PODMAN_LOCAL.md) for the application, PostgreSQL, and gRPC proxy Podman stack.

> Architecture diagrams: see [ARCHITECTURE_VISUALS.md](./ARCHITECTURE_VISUALS.md) for system, investigation, remediation, and Podman workflow visuals.

> Client production configuration: see [CLIENT_DEPLOYMENT.md](./CLIENT_DEPLOYMENT.md) for identity, ServiceNow, SolarWinds, Catalyst Center, SD-WAN, firewall, mTLS, secret, and go-live requirements.

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b6a1ad87-42d1-4be2-adae-a9c656123471

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Phase 2 runtime

The Podman server appends incident domain events to PostgreSQL and stores the
complete mutable application projection in the `operational_state` PostgreSQL
table. This includes incidents, notes, evidence, agents, approvals, workflows,
changes, backups, logs, cross-silo dialogue, metrics, recommendations, voice
metadata, cyber-fusion state, and Teams conversation state. Seed data is
inserted once when the projection is absent; subsequent starts restore the
database projection. A direct local
Node.js run without `DATABASE_URL` falls back to `.data/incident-events.jsonl`.
streams new events over `/api/stream`, and exposes lifecycle transitions through
`/api/incidents/:incidentId/transition`. Do not delete its configured persistent
volume if incident replay must survive a restart.

Authentication supports OIDC bearer tokens validated against a configured JWKS.
Set `AUTH_REQUIRED=true` with `OIDC_ISSUER`, `OIDC_AUDIENCE`, and
`OIDC_JWKS_URI` in deployed environments. Local simulation retains the persona
selector when authentication is not required.

For Google Cloud deployment, use Application Default Credentials or Workload
Identity and set `USE_SECRET_MANAGER=true`. The runtime reads
`SERVICENOW_INSTANCE_URL` and `SERVICENOW_ACCESS_TOKEN` from Secret Manager.
The read-only connectors are available at:

- `GET /api/connectors/servicenow/incidents`
- `GET /api/connectors/google-monitoring/signals`

The Monitoring connector reads a configured metric for the preceding 15 minutes.
Neither read connector has write permissions. Browser configuration never
persists client secrets to local storage. A separate, narrowly scoped
ServiceNow work-note writer can be enabled for multilingual voice audit notes;
it can patch only `work_notes` and remains disabled by default.

## Connector-sourced telemetry foundation

The normalized telemetry aggregator supports Datadog, Splunk, SolarWinds, and
Google Cloud Monitoring. Its `TELEMETRY_MODE` is deliberately independent from
the remediation `OPERATING_MODE` and `ENABLE_LIVE_EXECUTION` gate. This permits
real, read-only observation while every remediation action remains simulated.
Only the exact value `TELEMETRY_MODE=LIVE` enables vendor polling; an absent or
invalid value safely selects `SIMULATION`.

The current normalized endpoint is:

- `GET /api/telemetry/snapshot`

A successful request returns the `TelemetrySnapshot` directly, including mode,
generation and expiry times, aggregate health, cache metadata, connector
statuses, normalized metrics, and normalized anomalies. Normal requests use the
bounded collector cache. Administrators, DevOps Platform Engineers, and Network
Reliability Engineers can explicitly bypass that cache with
`GET /api/telemetry/snapshot?refresh=true`. For other roles the same query is
safe but does not force a vendor refresh, protecting API quotas. A collector
failure returns HTTP 503 with a sanitized error rather than vendor details.
The existing individual ServiceNow and Google Monitoring routes listed above
are unchanged.

In `SIMULATION`, the aggregator never calls a vendor and labels every connector,
metric, and anomaly as synthetic. In `LIVE`, each connector must also have its
own enable flag and required configuration. A disabled or incomplete connector
returns `UNAVAILABLE` with no sample data; it is never replaced by a fake
healthy value. Successful snapshots use a bounded cache to avoid turning a
thirty-second dashboard poll into a vendor API fan-out. If a transient refresh
fails, a recent last-successful sample may be retained only for the bounded
stale-retention interval. Such data is explicitly marked `STALE`, its metric
health becomes `UNKNOWN`, and the aggregate cannot report it as healthy.

Non-secret configuration:

| Source | Required enable and endpoint/project | Optional read configuration |
| --- | --- | --- |
| Datadog | `DATADOG_ENABLED`, `DATADOG_API_URL` | `DATADOG_METRIC_QUERIES_JSON`, `DATADOG_SECURITY_SIGNALS_ENABLED` |
| Splunk | `SPLUNK_ENABLED`, `SPLUNK_API_URL` | `SPLUNK_SEARCH_EXPORT_PATH`, `SPLUNK_METRIC_SEARCHES_JSON`, `SPLUNK_ANOMALY_SEARCH_ENABLED`, `SPLUNK_ANOMALY_SEARCH` |
| SolarWinds | `SOLARWINDS_ENABLED`, `SOLARWINDS_API_URL` | `SOLARWINDS_AUTH_MODE`, `SOLARWINDS_NODE_QUERY` |
| Google Cloud Monitoring | `GOOGLE_MONITORING_ENABLED`, `GOOGLE_CLOUD_PROJECT` | `GOOGLE_MONITORING_METRIC_TYPE` |

Global tuning values are `TELEMETRY_CACHE_TTL_MS`,
`TELEMETRY_STALE_RETENTION_MS`, `TELEMETRY_CONNECTOR_TIMEOUT_MS`, and
`TELEMETRY_FRESHNESS_MS`. The adapter constrains timeouts, cache durations,
retention, query counts, and response normalization even if larger values are
configured. Vendor endpoints require HTTPS, with HTTP permitted only for a
localhost development service. Splunk defaults to the current
`/services/search/v2/jobs/export` path; an older deployment can explicitly set a
compatible read endpoint. SolarWinds accepts only a read-only SWQL `SELECT`.
Native Orion SWIS REST authentication defaults to
`SOLARWINDS_AUTH_MODE=BASIC`, which requires the least-privilege
`SOLARWINDS_USERNAME` and `SOLARWINDS_PASSWORD` secrets. Set
`SOLARWINDS_AUTH_MODE=BEARER` only for an explicit relay or custom deployment
that supports bearer authentication; that mode uses `SOLARWINDS_ACCESS_TOKEN`.
Credentials embedded in connector URLs are rejected.

Credential values are read through the configured secret provider and use
these exact names:

- `DATADOG_API_KEY`
- `DATADOG_APP_KEY`
- `SPLUNK_ACCESS_TOKEN`
- `SOLARWINDS_USERNAME` and `SOLARWINDS_PASSWORD` for the default Basic mode
- `SOLARWINDS_ACCESS_TOKEN` only for explicitly selected Bearer mode

Google Cloud Monitoring uses Application Default Credentials or Workload
Identity rather than a static API secret. With `USE_SECRET_MANAGER=true`, create
the credentials required by the enabled connectors and selected authentication
modes as Google Secret Manager secrets; flags, URLs, auth-mode selection,
project IDs, and queries remain ordinary non-secret configuration.

Datadog security-signal polling and the Splunk anomaly search have separate
enable flags because their permissions and costs differ from metric reads. If
an optional anomaly request is denied, valid live metrics are retained and the
connector exposes a sanitized partial-success warning. Normalized anomalies are
structured evidence for correlation and agent hypotheses. They are not proof
that a threat caused an outage, and they never authorize autonomous remediation.
Causal conclusions require corroborating evidence and remediation continues to
use the existing policy, approval, quality, and execution gates.

Run the connector safety and normalization tests with:

```powershell
npm run test:telemetry
```

## Invisible Digital Twin and cyber-fusion service

The Digital Twin now runs as an internal backend worker under the logical
identity `service-account:cloudzero-digital-twin`. Every bounded cycle can:

1. Read active ServiceNow incidents when
   `SERVICENOW_INCIDENT_INGEST_ENABLED=true` and `TELEMETRY_MODE=LIVE`.
   `SERVICENOW_ASSIGNED_TO` and `SERVICENOW_ASSIGNMENT_GROUP` can narrow the
   allowlisted ticket scope without accepting a free-form encoded query.
2. Collect read-only normalized telemetry and security signals from the enabled
   Splunk, SolarWinds, Datadog, and Google Cloud Monitoring connectors.
3. Resolve evidence to an incident only through exact CMDB/resource aliases.
4. Persist the normalized evidence and immutable analysis input in the incident
   event log.
5. Rank operational, change-induced, threat-related, and insufficient-evidence
   hypotheses, then share one evidence context with all six domain twins.
6. Create investigation or reversible-mitigation suggestions in `SHADOW_ONLY`
   mode. These objects are structurally non-executable and are never sent to the
   production executor.
7. Add a deduplicated English audit note to the local simulated incident. A real
   ServiceNow note additionally requires live telemetry, no simulated source in
   the analysis, `OPERATING_MODE=LIVE`, and
   `ENABLE_SERVICENOW_WORK_NOTES=true` with the dedicated work-note token.

The worker deliberately does not SSH into devices or accept raw vendor commands.
Device truth is collected through least-privilege read-only monitoring APIs; any
future direct-device adapter must implement the same normalization, timeout,
credential, and read-only boundaries. Cyber correlation never claims causation:
all V1 hypotheses are marked `UNCONFIRMED`, independent evidence is required to
promote a threat/outage relationship, and a vulnerability finding by itself is
non-causal.

Cyber-fusion APIs:

- `GET /api/cyber-fusion/state`
- `POST /api/cyber-fusion/analyze`
- `POST /api/cyber-fusion/analyses/:analysisId/replay`

The replay endpoint reruns the exact persisted input and compares its integrity
hash and case graph with the baseline. Configure the worker with
`DIGITAL_TWIN_WORKER_ENABLED`, `CYBER_FUSION_POLL_MS`, and
`CYBER_FUSION_HISTORY_LIMIT`. V1 is a deterministic explainable rules/graph
engine, not a trained ML model. Predictive training should be introduced only
after collecting labeled incident windows, CMDB topology, verified outcomes,
false positives, and rollback/acceptance feedback.

Run the cyber engine and service-note tests with:

```powershell
npm run test:cyber
```

## Multilingual incident voice

`Sync-Teams-Twin` now prepares a voice workflow whenever the ServiceNow
simulator emits an incident. Region resolution uses ticket metadata first, then
the authenticated user profile, and finally English. The configured mappings
are:

- Mexico: `es-MX` / `tts_models/es/css10/vits`
- China: `zh-CN` / `tts_models/zh-CN/baker/vits`
- India: `hi-IN` / `tts_models/hi/cv/vits`
- Default: `en-US` / `tts_models/en/ljspeech/vits`

For non-English regions Gemini translates the ticket summary, after which the
server invokes the local Coqui `tts` command without a shell. It writes one
artifact per incident at
`.data/voice/<safe-incident-id>/incident_voice_output.wav`, verifies its WAV
header, hashes it, and streams it from a same-origin authenticated endpoint.

Install the maintained Coqui fork in a dedicated Python environment and make
its `tts` executable available on `PATH`, or set `COQUI_TTS_COMMAND` to the full
executable path. Coqui's current installation also requires an appropriate
PyTorch installation; follow the platform-specific PyTorch selection before
installing `coqui-tts[languages]`. Verify this app's exact model set with:

```powershell
tts --list_models
Invoke-RestMethod http://localhost:3000/api/voice/readiness
```

The readiness endpoint intentionally fails when an exact configured model ID is
not registered. The maintained Coqui registry may not include the requested
Mandarin and Hindi VITS identifiers, so those model artifacts must be supplied
to the local installation or the product mapping must be explicitly revised;
the runtime never silently substitutes a different voice.

Voice APIs:

- `GET /api/voice/readiness`
- `GET /api/incidents/:incidentId/voice-update`
- `POST /api/incidents/:incidentId/voice-update`
- `GET /api/incidents/:incidentId/voice-audio`

Generating and playing the browser preview is safe in simulation. Publishing
to Teams/Webex requires an approved gate bound to the exact incident and voice
workflow. In `SIMULATION` mode that delivery is recorded as simulated. A real
relay additionally requires `LIVE`, `ENABLE_BRIDGE_AUDIO_PUBLISH=true`,
`BRIDGE_AUDIO_RELAY_URL`, and `BRIDGE_AUDIO_RELAY_TOKEN`.

English audit notes are always assembled server-side and never include the
translated text. Local simulation mirrors them into the ticket. Real
ServiceNow writes additionally require `LIVE`,
`ENABLE_SERVICENOW_WORK_NOTES=true`, and the existing least-privilege
`SERVICENOW_INSTANCE_URL` plus a dedicated
`SERVICENOW_WORK_NOTE_ACCESS_TOKEN` credential.

## Phase 3 agent runtime

`POST /api/agent-runtime/incidents/:incidentId/investigate` runs the six domain
twins concurrently, retrieves relevant runbooks, emits structured findings, and
produces a policy-classified recommendation. Recommendations default to shadow
mode and are persisted as replayable incident events.

Evaluation and feedback endpoints:

- `GET /api/agent-runtime/recommendations?incidentId=...`
- `POST /api/agent-runtime/recommendations/:id/accept`
- `POST /api/agent-runtime/recommendations/:id/feedback`
- `POST /api/agent-runtime/recommendations/:id/evaluate`
- `GET /api/agent-runtime/evaluations`

The quality gate measures recommendation accuracy, rollback rate, false-positive
rate, and operational acceptance. It cannot pass until the configured minimum
sample count has been reached.

## Phase 4 controlled execution

`POST /api/agent-runtime/recommendations/:id/execute-safe` is restricted to the
small allowlist in `src/server/production-executor.ts`. It requires all of:

1. OIDC-authenticated Administrator or NRE identity.
2. Server operating mode `LIVE` and `ENABLE_LIVE_EXECUTION=true`.
3. A recommendation generated with `AGENT_SHADOW_MODE=false`.
4. A passed historical quality gate.
5. A human-approved gate for the same incident.
6. Automatic reversibility and single-resource blast radius.

The external executor must expose authenticated `validate`, `apply`, `verify`,
and `rollback` endpoints. Verification failure invokes rollback automatically.
Every request includes an idempotency key. Add new action types to the allowlist
only after their measured outcomes satisfy the quality thresholds.

## Quantum-inspired classical runtime — Q0 and Q1

The first gated increment implements deterministic optimization contracts,
validated feature configuration, hard deadlines, output validation, and automatic
fallback. The evidence-interference engine weights support and contradiction using
source reliability, freshness, independence, confidence, and duplicate damping.

It defaults to `SHADOW`: scores and explanations are recorded, but the original
agent confidence remains authoritative. Promote `QI_EVIDENCE_INTERFERENCE_MODE`
to `ASSISTED` only after replay metrics meet the criteria in
`QUANTUM_INSPIRED_IMPLEMENTATION_PLAN.md`.

Evidence runs can be inspected at:

- `GET /api/quantum/incidents/:incidentId/evidence-scores`

Run deterministic safety tests with `npm run test:quantum`.

Q2 adds a diversity-preserving, superposition-inspired hypothesis beam search.
It keeps competing domain causes active, prunes weak candidates within strict
depth/candidate/deadline budgets, and records the full diagnostic path. It also
defaults to `SHADOW`, so the existing remediation selector remains authoritative.

- `GET /api/quantum/incidents/:incidentId/hypotheses`

Q3 adds a versioned counterfactual transition model. Every run evaluates a
`NO_ACTION` baseline plus bounded allowlisted alternatives, and reports recovery
probability, expected MTTR, SLO impact, secondary-failure risk, rollback risk,
verification checks, and a utility score. It remains shadow-only.

- `GET /api/quantum/incidents/:incidentId/counterfactuals`

Q4 adds bounded seeded simulated annealing for incident-role assignment and a
change-collision planner. Assignment must satisfy availability, eligibility, and
separation-of-duty constraints and can never score worse than its deterministic
greedy baseline. Change plans detect shared operational scope, block approved
conflicts, and produce a pause/validate/apply/verify/resume sequence.

- `POST /api/quantum/incidents/:incidentId/responder-assignment`
- `POST /api/quantum/incidents/:incidentId/change-collision-plan`

Q5 adds an energy-auditable QUBO remediation portfolio planner. Small models use
exact enumeration; larger models use bounded seeded simulated annealing. Returned
energy is independently rescored, hard constraints prohibit incompatible action
combinations, and the result cannot score worse than its deterministic baseline.
It does not extend the Phase 4 production executor allowlist.

- `POST /api/quantum/incidents/:incidentId/remediation-portfolio`

Persona-routed, template-only gRPC diagnostics and ServiceNow audit behavior are
documented in [ENGINEERING_COMMAND_PROXY.md](./ENGINEERING_COMMAND_PROXY.md).
