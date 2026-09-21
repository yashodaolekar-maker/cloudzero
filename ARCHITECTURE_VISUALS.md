# CloudZero Digital Twin architecture and workflows

These diagrams describe the implemented local Podman architecture and the
intended production control boundaries. Document content and telemetry are data
sources; they are never treated as executable instructions.

## 0. Current application architecture

This view follows the implementation in `src/App.tsx`, `server.ts`, and the
local `compose.yaml` deployment. Solid arrows are request or data paths;
dashed arrows are optional or asynchronous paths.

```mermaid
flowchart LR
  classDef client fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef api fill:#ecfeff,stroke:#0891b2,color:#083344
  classDef domain fill:#f5f3ff,stroke:#7c3aed,color:#2e1065
  classDef data fill:#fff7ed,stroke:#ea580c,color:#431407
  classDef sidecar fill:#ecfdf5,stroke:#16a34a,color:#052e16
  classDef external fill:#f8fafc,stroke:#64748b,color:#1e293b
  classDef guard fill:#fff1f2,stroke:#e11d48,color:#4c0519

  B[Browser]:::client
  UI[React application<br/>Dashboard, incidents, agents,<br/>approvals, observability, voice]:::client
  API[Express server.ts<br/>REST API + SSE /api/stream<br/>auth, RBAC, lifecycle guards]:::api

  subgraph Runtime[Application runtime]
    ORCH[Incident and engineering orchestration]:::domain
    AGENTS[Domain twins, agent runtime,<br/>cross-silo collaboration]:::domain
    FUSION[Telemetry and cyber-fusion analysis]:::domain
    KNOW[Grounded knowledge and response]:::domain
    QI[Quantum-inspired planning<br/>shadow-mode planners]:::domain
    VOICE[Voice and multilingual workflows]:::domain
  end

  subgraph Storage[Durable state]
    PG[(PostgreSQL<br/>operational_state + incident events)]:::data
    JSONL[(JSONL fallback<br/>when DATABASE_URL is absent)]:::data
    KIDX[(Document knowledge index)]:::data
    FILES[(.data voice artifacts)]:::data
  end

  subgraph Sidecars[Local Podman sidecars]
    PROXY[gRPC command proxy<br/>simulation or mTLS production boundary]:::sidecar
    SPEECH[Speech service<br/>Whisper / Bark / VITS]:::sidecar
    OLLAMA[Ollama local model]:::sidecar
    PROM[Prometheus]:::sidecar
    GRAF[Grafana]:::sidecar
  end

  subgraph Enterprise[Enterprise integrations]
    SN[ServiceNow]:::external
    TEL[Datadog, Splunk, SolarWinds,<br/>Google Cloud Monitoring]:::external
    IDP[OIDC identity provider]:::external
    TARGET[Network, Windows, Linux,<br/>Kubernetes and security targets]:::external
  end

  B --> UI
  UI -->|JSON REST| API
  UI -->|SSE incident events| API
  API --> ORCH
  API --> AGENTS
  API --> FUSION
  API --> KNOW
  API --> QI
  API --> VOICE
  API -->|state projection| PG
  API -. fallback .-> JSONL
  KNOW --> KIDX
  VOICE --> FILES
  ORCH -->|read-only diagnostics| PROXY
  PROXY -. bounded commands .-> TARGET
  VOICE --> SPEECH
  AGENTS -. local inference .-> OLLAMA
  FUSION -->|read-only polling| TEL
  API -->|work notes / incident reads| SN
  IDP -. bearer validation .-> API
  API -. metrics .-> PROM --> GRAF

  subgraph Safety[Safety boundary]
    POLICY[Operating mode, allowlists,<br/>grounding, approval, verification]:::guard
  end
  ORCH --> POLICY
  AGENTS --> POLICY
  POLICY --> PROXY
```

## 0.1 Browser state and event flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser UI
  participant A as Express API
  participant S as Operational state store
  participant E as Incident event bus
  participant T as Telemetry aggregator

  U->>A: GET /api/state
  A->>S: Load current projection
  S-->>A: Users, incidents, agents, approvals, metrics
  A-->>U: JSON state snapshot
  U->>A: GET /api/telemetry/snapshot
  A->>T: Read bounded connector cache
  T-->>A: Normalized metrics and anomalies
  A-->>U: TelemetrySnapshot
  U->>A: GET /api/stream
  A-->>U: SSE connection
  E-->>A: Incident domain event
  A-->>U: incident-event
  U->>A: GET /api/state (reconciliation)
  A-->>U: Updated projection
```

## 0.2 Incident-to-evidence flow

```mermaid
flowchart TD
  START([Incident from simulator or ServiceNow]) --> API[Incident API / worker]
  API --> STORE[Persist domain event and update projection]
  STORE --> CMDB{Exact CMDB or resource correlation?}
  CMDB -->|No| ABSTAIN[Record limitation and abstain]
  CMDB -->|Yes| PERSONA[Select domain persona]
  PERSONA --> TEMPLATE[Choose read-only diagnostic template]
  TEMPLATE --> BIND{Incident and workflow binding valid?}
  BIND -->|No| BLOCK[Reject and audit reason]
  BIND -->|Yes| PROXY[ExecuteCommand through gRPC proxy]
  PROXY --> REDACT[Redact secrets and private addresses]
  REDACT --> EVIDENCE[Persist evidence and integrity hash]
  EVIDENCE --> FUSE[Correlate telemetry, security signals,<br/>knowledge and twin responses]
  FUSE --> QUALITY{Grounded and sufficiently supported?}
  QUALITY -->|No| NOTE[Work note with observations,<br/>limitations and escalation]
  QUALITY -->|Yes| RECOMMEND[Recommendation with citations<br/>and bounded action]
  NOTE --> STORE
  RECOMMEND --> STORE
  STORE --> STREAM[Publish incident-event]
  STREAM --> UI([Browser refreshes state])
```

## 0.3 Remediation and approval flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Operator
  participant API as Express API
  participant P as Policy and approval gates
  participant DB as PostgreSQL / event ledger
  participant X as Production executor
  participant D as Target platform
  participant SN as ServiceNow

  U->>API: Trigger workflow or accept recommendation
  API->>P: Validate operating mode, scope, allowlist and freshness
  P-->>API: Approval required
  API->>DB: Persist pending approval
  API-->>U: Approval appears in approvals view
  U->>API: Approve or deny exact action
  API->>P: Revalidate incident, workflow and approval
  alt Denied or stale or unsafe
    P-->>API: Block action
    API->>DB: Persist blocked outcome
    API->>SN: Append escalation work note
  else Approved and valid
    API->>X: Execute bounded reversible action
    X->>D: Apply target change
    D-->>X: Result
    X->>D: Verify health and expected state
    alt Verification succeeds
      X-->>API: Verified outcome
    else Verification fails
      X->>D: Roll back
      X-->>API: Rolled-back outcome
    end
    API->>DB: Persist execution and outcome
    API->>SN: Append outcome work note
  end
```

## 1. System architecture

```mermaid
flowchart LR
  classDef external fill:#eef4ff,stroke:#2563eb,color:#10204a
  classDef control fill:#f0fdfa,stroke:#0f766e,color:#123
  classDef agent fill:#f5f3ff,stroke:#7c3aed,color:#24104f
  classDef data fill:#fff7ed,stroke:#ea580c,color:#431407
  classDef guard fill:#fff1f2,stroke:#e11d48,color:#4c0519
  classDef execution fill:#ecfdf5,stroke:#16a34a,color:#052e16

  subgraph Sources[Enterprise sources]
    SN[ServiceNow incidents and CMDB]:::external
    TEL[Datadog · Splunk · SolarWinds · Google Monitoring]:::external
    KB[Grounded runbooks and document knowledge]:::external
  end

  subgraph Podman[Local Podman network]
    APP[CloudZero application]:::control
    DB[(PostgreSQL<br/>incident event ledger)]:::data
    GP[gRPC command proxy<br/>simulation sidecar]:::execution
    IDX[(Read-only knowledge index)]:::data
  end

  subgraph Runtime[Digital Twin runtime]
    ORCH[Incident orchestrator]:::control
    CMDB[CMDB correlation]:::control
    ROUTER[Persona router]:::control
    NET[Network Twin]:::agent
    WIN[Windows Twin]:::agent
    CLOUD[CloudOps / DevOps Twin]:::agent
    SEC[Security Twin]:::agent
    FUSION[Cross-domain evidence fusion]:::control
  end

  subgraph Safety[Policy and safety boundary]
    GROUND[Grounding and abstention]:::guard
    REDACT[Secret and private-IP redaction]:::guard
    POLICY[Autonomy policy]:::guard
    APPROVAL[Exact incident + workflow + action approval]:::guard
    VERIFY[Verification and rollback]:::guard
  end

  subgraph Production[Production-only execution plane]
    PXY[Secured gRPC proxy<br/>mTLS + service identity]:::execution
    DEV[Netmiko · PowerShell · Kubernetes · security playbooks]:::execution
  end

  SN --> APP
  TEL --> APP
  KB --> IDX --> APP
  APP --> ORCH --> CMDB --> ROUTER
  ROUTER --> NET
  ROUTER --> WIN
  ROUTER --> CLOUD
  ROUTER --> SEC
  NET --> FUSION
  WIN --> FUSION
  CLOUD --> FUSION
  SEC --> FUSION
  FUSION --> GROUND --> REDACT --> POLICY
  POLICY -->|read-only diagnostic| GP
  POLICY -->|production change| APPROVAL --> PXY --> DEV --> VERIFY
  ORCH <--> DB
  VERIFY --> ORCH
  ORCH -->|English work notes| SN
```

## 2. Incident investigation workflow

```mermaid
flowchart TD
  START([ServiceNow incident received]) --> INTAKE[Normalize incident metadata]
  INTAKE --> CORRELATE{One exact CMDB item?}
  CORRELATE -->|No| ABSTAIN[Abstain and request CMDB resolution]
  CORRELATE -->|Yes| PERSONA{Select persona}

  PERSONA -->|Network| N[Network template library]
  PERSONA -->|Windows| W[PowerShell template library]
  PERSONA -->|CloudOps / DevOps| C[Kubernetes and container templates]
  PERSONA -->|Security| S[Threat-analysis playbooks]

  N --> BIND
  W --> BIND
  C --> BIND
  S --> BIND
  BIND{Incident and workflow IDs match?}
  BIND -->|No| BLOCK[Block request and append audit event]
  BIND -->|Yes| ALLOW{Read-only template allowlisted?}
  ALLOW -->|No| BLOCK
  ALLOW -->|Yes| GRPC[ExecuteCommand via gRPC proxy]
  GRPC --> SANITIZE[Redact secrets and private addresses]
  SANITIZE --> EVIDENCE[Persist structured evidence and integrity hash]
  EVIDENCE --> FUSE[Correlate with telemetry, security signals, and runbooks]
  FUSE --> SUFFICIENT{Evidence sufficient and consistent?}
  SUFFICIENT -->|No| NOTE1[English work note: observations, limitations, escalation]
  SUFFICIENT -->|Yes| RECOMMEND[Create grounded recommendation]
  RECOMMEND --> NOTE2[English work note: commands, evidence, recommendation]
  NOTE1 --> SNOW[Append ServiceNow work notes]
  NOTE2 --> SNOW
  SNOW --> END([Continue monitoring])
```

## 3. Approval-gated remediation workflow

```mermaid
sequenceDiagram
  autonumber
  participant SN as ServiceNow
  participant O as Orchestrator
  participant A as Domain Twins
  participant P as Policy Engine
  participant H as Human Approver
  participant X as Production Proxy
  participant D as Target Platform
  participant DB as PostgreSQL Audit Ledger

  SN->>O: Incident + CMDB metadata
  O->>A: Investigate with persisted evidence
  A-->>O: Findings + citations + limitations
  O->>P: Proposed signed-runbook action
  P-->>O: Risk, blast radius, and autonomy decision
  O->>DB: Persist recommendation digest

  alt Simulation or shadow mode
    O->>DB: Record recommendation only
    O-->>SN: English work note; no execution
  else Live and approval required
    O->>H: Exact incident/workflow/action approval
    H-->>O: Approval ID and decision
    O->>P: Revalidate approval, evidence freshness, and policy
    alt Validation fails
      P-->>O: Block
      O->>DB: Record blocked reason
      O-->>SN: Escalation work note
    else Validation passes
      O->>X: Apply allowlisted reversible action
      X->>D: Execute within bounded target scope
      D-->>X: Execution result
      X->>D: Run verification checks
      alt Verification succeeds
        X-->>O: Verified
      else Verification fails
        X->>D: Automatic rollback
        X-->>O: Rolled back
      end
      O->>DB: Persist execution and outcome
      O-->>SN: English outcome work note
    end
  end
```

## 4. Local Podman deployment

```mermaid
flowchart LR
  USER[Browser] -->|127.0.0.1:3000| APP[cloudzero-digital-twin]
  APP -->|PostgreSQL protocol| DB[(cloudzero-postgres<br/>persistent volume)]
  APP -->|gRPC ExecuteCommand| PROXY[cloudzero-command-proxy]
  APP -->|read only| KB[(knowledge bind mount)]

  subgraph PRIVATE[Private Podman network]
    APP
    DB
    PROXY
  end

  DB -. persisted .-> VOL[(cloudzero_postgres_data)]
  PROXY -. simulation only .-> NONE[No device connection]
```

## Legend

- Blue: enterprise inputs.
- Teal: orchestration and correlation.
- Purple: domain Digital Twins.
- Orange: durable or indexed data.
- Red: safety and approval gates.
- Green: bounded execution components.
