# Engineering command proxy

The Digital Twin never connects to private devices. It selects a domain persona
from the ServiceNow incident, resolves one opaque CMDB identifier, and sends an
allowlisted diagnostic template to the command proxy over gRPC.

## Safety boundary

- API callers submit a template ID, never a raw command.
- Templates in `src/server/engineering-orchestrator.ts` are read-only.
- Incident and workflow IDs must be exactly bound before dispatch.
- Private IPv4 addresses, credentials, tokens, and unsafe characters are removed
  before evidence, HTTP responses, events, or ServiceNow work notes.
- The proxy owns credentials and the Netmiko, PowerShell, Kubernetes, or security
  playbook implementation.
- Diagnostics cannot remediate. Changes still use the signed-runbook, policy,
  exact-approval, executor, verification, and rollback path.

## gRPC contract

Implement `proto/command_proxy.proto` in a separately secured proxy deployment.
The proxy must independently enforce the template allowlist. Use mTLS or a
service-mesh identity in production in addition to the service credential.

```text
COMMAND_PROXY_GRPC_ENDPOINT=command-proxy.internal.example:443
COMMAND_PROXY_ACCESS_TOKEN=<Secret Manager secret>
COMMAND_PROXY_TIMEOUT_MS=15000
```

Podman starts a separate gRPC simulation sidecar and makes no device connection.
Production startup fails if the real proxy endpoint is missing.

## API

```text
GET /api/engineering/incidents/:incidentId/diagnostic-templates
POST /api/engineering/incidents/:incidentId/prepare
POST /api/engineering/incidents/:incidentId/diagnose
```

Example POST body:

```json
{
  "workflowId": "wf-001",
  "templateId": "NETWORK_BGP_SUMMARY",
  "parameters": {}
}
```

The response contains sanitized output, structured evidence, and an English work
note. Simulation keeps the note locally. Live publication additionally requires
`ENABLE_SERVICENOW_WORK_NOTES=true` and the restricted work-note token.

## Cross-persona collaboration

ServiceNow intake retains the CMDB `sys_class_name` for initial routing. Overlapping
incident context selects collaborating personas, with these explicit ownership rules:

- Azure ISE: Network investigates networking; CloudOps/DevOps owns remediation and closure.
- Network certificate expiry: Security investigates security/PKI; Network owns configuration and closure.
- Windows, Network, Security and CloudOps/DevOps can otherwise participate together.
  CloudOps and DevOps continue to share the existing `CLOUDOPS_DEVOPS` persona.

New or materially changed cross-domain ServiceNow incidents automatically run one
bounded collaboration round when live ingestion is enabled. Set
`AGENT_COLLABORATION_ENABLED=false` to disable automatic rounds. A persisted routing
fingerprint prevents polling from repeating the same investigation. Failed rounds
require human review or an explicit API retry; they are not automatically retried.
Manual simulation uses the same orchestration:

```text
POST /api/engineering/incidents/:incidentId/prepare
POST /api/engineering/incidents/:incidentId/collaborate
GET  /api/engineering/incidents/:incidentId/collaboration
```

Pass the returned workflow ID to `collaborate`:

```json
{ "workflowId": "wf-diagnostic-INC001" }
```

The response reports participating agents, the initial and responsible personas,
closure ownership, candidate investigations, collected evidence, disposition,
English work note, and publication status. The GET endpoint exposes the incident's
collaboration audit events. Commands remain template-only and read-only.

`ExchangeEvidence` in `proto/command_proxy.proto` carries the incident/workflow,
sender/recipient, correlation ID, redacted structured evidence, and non-executable
candidate investigations. The orchestrator persists requests before dispatch and
validates receipt bindings. Diagnostic evidence is persisted before it is shared.
Each participant receives the final common evidence snapshot; full evidence and
exchange records are in the existing hash-chained event ledger and restored on restart.
The exchange payload is bounded to the latest 20 diagnostics in this workflow.
It is an event-ledger view, not an update to the static PDF knowledge index.

The bundled recipient is a **simulation adapter**. Production proxy implementations
must implement authenticated persona delivery, independently authorize incident and
workflow membership, enforce the read-only schema/redaction rules, and return
`ACKNOWLEDGED` only after delivery. An unimplemented RPC, mismatched receipt,
unavailable ledger, or simulated receipt in live mode fails closed. Production must
provide its own Netmiko, PowerShell, Kubernetes and security adapters as before.

Current collaboration deliberately abstains from remediation: generic diagnostics
do not prove causation or establish a safe change. PKI validation and Azure ISE
remediation need approved domain playbooks; Kubernetes commands are dispatched only
when Kubernetes context and a validated namespace are available. Subsequent changes
must enter the existing policy/approval/executor flow with verification and rollback.
No collaboration message grants execution or closure authority.

Work notes include agents, commands and observed outputs, exchanged evidence IDs,
limitations, recommendation, and remediation/closure ownership. Full details remain
in the ledger when a note reaches ServiceNow's 4,000-character bound. Live publication
still requires `ENABLE_SERVICENOW_WORK_NOTES=true`. `DISABLED` and `FAILED` statuses
retain the generated note in the ledger without claiming ServiceNow delivery.

## Append-only PostgreSQL migration

Fresh volumes load `db/init/002_append_only_incident_events.sql` automatically.
Apply it once to an existing database, for example with Podman from PowerShell:

```powershell
Get-Content db/init/002_append_only_incident_events.sql -Raw | podman exec -i cloudzero-postgres psql -v ON_ERROR_STOP=1 -U cloudzero -d cloudzero
```

The trigger rejects UPDATE, DELETE and TRUNCATE, including zero-row statements.
Hash validation continues on startup. A database owner/superuser can disable triggers;
production must restrict schema ownership and use protected backups for stronger
tamper resistance. The JSONL development fallback is hash-chained, not immutable storage.

Validation: `npm run test:engineering` includes a real local gRPC transport test,
ownership routing, redaction, shared evidence, receipt binding and audit-failure checks.
