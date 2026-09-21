# Twin activity, SLA and user journey XLA

Open [Activity & reviews](http://localhost:3000/?twinActivity=1) or the provisioned [Grafana dashboard](http://localhost:3001/d/cloudzero-twins). Prometheus is available locally on port **19090**; port 9090 belongs to another existing application. All three published application/observability ports bind to loopback. Grafana is a read-only local viewer with login disabled, not an Internet-facing deployment.

The former seeded task counts and hard-coded 99.4% SLA label are replaced with recorded activity. No historical work is invented to match the old numbers. Task totals on the fleet cards cover the retained ledger; activity metrics use a rolling 30-day start cohort plus unfinished work. Each A2A participant request/reply and owner assessment is a separate work unit, not another incident. Task inspection shows timestamps, role, incident, workflow, evidence, final assessment, model attempts, approval/execution events in the workflow history, and review revisions. Timeline inspection never reruns commands. Legacy records without captured start/policy information have unknown SLO timing. Unfinished work detected at application restart becomes interrupted; recovery does not fabricate a finish time.

## SLA: incident resolution commitments

| Priority | Resolution commitment |
| --- | --- |
| P1 | 1 hour (3600 seconds) |
| P2 | 8 hours (28800 seconds) |
| P3 | Not configured |

The selected clock is 24×7 elapsed time from the recorded ticket opening to resolution. There are no inferred business calendars or pause deductions. ServiceNow `resolved_at`/`closed_at` is used when present; otherwise the local resolution-recording time is identified as the fallback. Missing/assumed opening times, invalid chronology and reopened incidents without an agreed reopen policy remain UNKNOWN. Live ServiceNow ticket origin is distinct from simulation-mode agent execution. Resolution is a recorded ticket outcome, not proof that an agent alone fixed the service.

Each newly handled incident snapshots priority, targets and policy version. An unresolved incident becomes BREACHED once elapsed time exceeds its target. Compliance = MET / (MET + BREACHED); pending, unknown and unconfigured records are excluded. No eligible records yields N/A. The first substantive response timestamp is visible, but the user has not agreed a separate response SLA. P3 is intentionally unconfigured.

Task latency is a separate **SLO**, not incident SLA: conversation/diagnostic 120s, A2A participant/owner assessment 180s, investigation 300s by default. Those proposed engineering objectives include queue, model and tool time; a timely error can meet response-time SLO while the task failure metric still records failure. Historical runs retain their captured target.

## XLA: service journey experience

The first journey profile is **Wireless roaming**, measuring a client moving from AP A to AP B. It captures interruption duration, packet loss, latency, authentication success and continuity of an existing session. It does not infer user experience from AP availability or agent response speed.

Journey thresholds are deliberately unset until agreed for the actual application—for example, voice roaming and a background data transfer may have different expectations. Explicit authentication failure or a dropped session is POOR; measured threshold violations are POOR. GOOD requires every configured measurement, successful authentication, preserved session and fully configured thresholds. Otherwise experience is UNKNOWN. Good fraction = GOOD/(GOOD+POOR), only when thresholds are configured; UNKNOWN is shown separately. p95 uses nearest-rank over recorded non-null measurements, not zeros for missing data. These diagnostic indicators supplement, rather than replace, the user's overall experience.

No AP/client telemetry source is configured on this installation, so journey measurements initially show no data. Integrate a collector using:

```
POST /integrations/observability/wireless
Authorization: Bearer <WIRELESS_XLA_INGEST_TOKEN>
Content-Type: application/json
```

```json
{
  "sampleId": "controller-roam-unique-id",
  "clientId": "opaque-client-id",
  "fromAp": "AP-A",
  "toAp": "AP-B",
  "occurredAt": "2026-09-07T02:00:00Z",
  "incidentId": "INC-2026-1011",
  "interruptionMs": 230,
  "packetLossPercent": 1.2,
  "latencyMs": 40,
  "authenticationSucceeded": true,
  "sessionPreserved": false
}
```

This is a **schema example**, not a recorded measurement. Use actual collector values and a current timestamp. The incident link is optional; if supplied it must exist. Client identifiers are pseudonymized. Sample IDs are idempotent; conflicting duplicates are rejected. The collector endpoint is disabled until its token is configured. An authenticated collector is the provenance source; importing data does not independently verify its truth. Route it through your existing protected ingress if used outside localhost. For isolated simulator tests, authorized operators may use `/api/observability/journeys/wireless/simulation`, which always stamps SIMULATION.

Optional configuration: `WIRELESS_XLA_INGEST_TOKEN`, `XLA_ROAM_INTERRUPTION_MS`, `XLA_ROAM_PACKET_LOSS_PERCENT`, `XLA_ROAM_LATENCY_MS`. Configure actual journey targets explicitly, then recreate the application. The profile version changes with thresholds; dashboard classifications use the current profile and raw evidence remains immutable.

Interaction feedback (helpfulness, clarity, trust, effort and self-reported resolution) is also collected, but is clearly separate from service-journey XLA. Latest response per task/respondent counts once. Its normalized score is `(mean four 1–5 ratings − 1)/4 × 100`; response counts and coverage are shown. It never establishes technical correctness or changes ticket status.

## Decision quality and training

Only an authorized incident operator can mark a decision CORRECT, WRONG or INCONCLUSIVE. Every review binds the exact task/decision event and records the authenticated reviewer, rationale, correction and timestamp. Revisions append rather than overwrite history. Wrong decisions require a correction.

Accuracy = correct/(correct+wrong). Review coverage = (correct+wrong+inconclusive)/decision-bearing completed tasks. Zero decisive reviews means N/A, not 100%. The reporting quality target requires 20 decisive reviews, 90% accuracy and 80% coverage; it never grants execution rights. Simulator reviews do not establish live production quality. This new human-review scorecard is separate from the legacy autonomy policy gate.

Explicitly eligible reviews can be exported as training candidates. See [training/README.md](training/README.md) for preparation, held-out splitting, hardware preflight and the QLoRA pilot. Collection and preparation are not model weight training.

## Operations

Run `podman compose -f compose.yaml up -d --build digital-twin prometheus grafana`. Grafana and Prometheus have persistent volumes; Prometheus retains 90 days of metric snapshots and scrapes every 15 seconds. Activity polls every 10 seconds. In Grafana, time range controls historical snapshots of the rolling cohort; it does not redefine the cohort window. Incident and journey panels are service-level and therefore honor execution/data mode, not agent-role filters. No client IDs, incident IDs, prompt text or credentials become metric labels. The `/metrics/twins` endpoint requires its scrape token; the fixed token in local compose is for this loopback-only development stack, not production credentials.

Provisioning follows [Grafana's documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/) and [Prometheus configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/). Dashboard source: `scripts/build-twin-dashboard.mjs`; regenerate with `node scripts/build-twin-dashboard.mjs`.
