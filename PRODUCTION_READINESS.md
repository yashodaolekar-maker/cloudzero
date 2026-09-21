# CloudZero production-readiness gate

## Current decision

**Not approved for production remediation.** The repository now has a production-shaped, hardened local simulation profile, but it is not yet a highly available production service. It is safe to use the Podman profile for demonstrations and integration development because live telemetry, external writes, model translation, bridge publishing, and remediation execution are disabled.

## Deployment profiles

| Profile | Intended use | Identity | Telemetry | Actions |
| --- | --- | --- | --- | --- |
| `DEVELOPMENT` | Local source development | Read-only fallback unless explicitly configured | Simulation by default | Legacy simulation APIs remain blocked while hardening is enabled |
| `LOCAL_SIMULATION` | Loopback-only Podman demo | Explicit local operator persona | Simulation only | Shadow recommendations; no live execution or external writes |
| `PRODUCTION` | Future managed deployment | Required OIDC bearer validation | Explicitly configured read-only connectors | Exact approvals plus all current evidence, policy, and quality gates |

The server refuses a `PRODUCTION` startup when OIDC, Google Cloud project/Secret Manager, or hardening requirements are missing. This validation is a guardrail, not a declaration that the remaining production gates below have passed.

## Implemented trust controls

- Incident, workflow, recommendation, approval, target, parameters, expiry, and action digest are bound and revalidated before the only allowlisted executor path.
- Approval completes the approval step only. It never records an action as executed.
- Recommendations require exact CMDB identity, current integrity metadata, two independent evidence families, a trusted action binding, and a retrieved runbook. Otherwise the orchestrator emits a structured abstention.
- Live execution repeats the evidence checks and also requires current live data, the operational quality gate, an allowlisted reversible action, and an explicit approval ID.
- Incident Q&A and postmortems are deterministic and evidence-bound. Unknown facts and unconfirmed root causes are labeled as such; raw logs must enter through a connector before use.
- New incident events form a serialized SHA-256 hash chain. Startup fails if a hash-chained record was edited or reordered.
- Production ignores `.env` files. The container build context excludes `.env*`, local data, build output, and dependencies.
- The local container runs as UID/GID 10001, drops Linux capabilities, uses a read-only root filesystem, mounts a dedicated data volume, and exposes port 3000 only on host loopback.
- ServiceNow, Datadog, Splunk, SolarWinds, and Google Cloud Monitoring collectors are read-only. Missing or failed live connectors report unavailable/stale state rather than generating substitute telemetry.
- The simplified UI uses grouped navigation and progressive disclosure so the default view prioritizes exceptions, connector trust, and approval work.

## Production blockers

These are release blockers, not optional polish:

1. **Complete interactive identity.** The API validates OIDC JWTs, but the browser still needs an approved Authorization Code + PKCE or BFF session flow, secure cookie/CSRF design, logout/revocation, group-to-role governance, and authentication for streaming updates. Native `EventSource` cannot attach the current bearer token by itself.
2. **Replace the single-node event file.** The hash-chained JSONL volume is durable for one local container, not a transactional multi-replica store. Introduce PostgreSQL (or an approved managed event store), optimistic concurrency per incident, idempotency constraints, an outbox, retention, backup/restore tests, encryption, and a broker for cross-replica streaming.
3. **Certify each connector.** Validate least-privilege scopes, pagination, rate limits, schema drift, timeouts, retry budgets, circuit breakers, certificate trust, egress allowlists, data classification, and a canonical CMDB ownership process against non-production vendor tenants.
4. **Build the executor as a separate service.** Implement vendor-specific validate/apply/verify/rollback adapters, signed workload identity, network isolation, idempotency, command allowlists, maintenance-window checks, concurrency locks, and automatic rollback drills. Do not put SSH, NETCONF, Kubernetes, or cloud-admin credentials in this web process.
5. **Finish model governance.** Keep generative output out of the control path. Version prompts/models/retrieval corpora, enforce citation coverage and abstention tests, add prompt-injection and poisoned-evidence evaluations, maintain multilingual translation golden sets, and require canary/shadow review before any model change.
6. **Operationalize security and reliability.** Add centralized immutable audit export, redaction/DLP, OpenTelemetry traces and metrics, SLOs, alerting, dependency and container scanning, SBOM/provenance, image signing, penetration testing, disaster recovery, load/soak tests, and incident-response runbooks for CloudZero itself.
7. **Replace simulated business claims.** Seeded performance, team-enablement, SLA, and ROI values must remain visibly labeled simulation or be removed. Production dashboards may show only connector-derived measurements with source, collection time, freshness, and error state.

## Autonomy release gates

Production remediation must remain disabled until all platform blockers pass and a representative replay/shadow sample meets approved thresholds for:

- recommendation precision and recall by action and service;
- false-positive rate;
- rollback and failed-verification rate;
- evidence/citation coverage and abstention correctness;
- operator acceptance and override reasons;
- blast-radius violations (target: zero);
- authorization/approval-binding violations (target: zero);
- mean time to detect, explain, approve, verify, and recover.

Thresholds need owners, confidence intervals, minimum sample sizes, and per-domain sign-off. A global average must not hide a poorly performing domain twin.

## Local Podman runbook

Prerequisites: a running Podman machine and a Compose provider available to `podman compose`.

```powershell
.\scripts\podman-up.ps1
.\scripts\podman-status.ps1
```

Open <http://localhost:3000>. Stop the app without deleting its incident-data volume:

```powershell
.\scripts\podman-down.ps1
```

The local Compose file deliberately does not load `.env.local` or inject an AI API key. See the official [Podman Compose](https://docs.podman.io/en/latest/markdown/podman-compose.1.html), [healthcheck](https://docs.podman.io/en/latest/markdown/podman-healthcheck-run.1.html), and [secret](https://docs.podman.io/en/latest/markdown/podman-secret.1.html) documentation before adapting this setup.
