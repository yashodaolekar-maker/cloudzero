import { Pool } from "pg";
import type { BackupItem, ChangeRecord, CrossSiloWorkflow, DigitalTwinAgent, HITLApproval, IncidentEvidence, IncidentLifecycleState, PerformanceMetrics, ServiceNowIncident, SSOUser, SystemLog, TeamEnablementMetric, WorkflowInstance } from "../types.ts";

export interface OperationalIncidentState {
  users: SSOUser[];
  agents: DigitalTwinAgent[];
  serviceNowIncidents: ServiceNowIncident[];
  demoHumanResponseSlaMinutes?: number;
  approvals: HITLApproval[];
  workflows: WorkflowInstance[];
  backups: BackupItem[];
  systemLogs: SystemLog[];
  changeRecords: ChangeRecord[];
  crossSiloWorkflows: CrossSiloWorkflow[];
  teamEnablementMetrics: TeamEnablementMetric[];
  currentMetrics: PerformanceMetrics;
  incidentEvidence: IncidentEvidence[];
  lifecycleOverrides: [string, IncidentLifecycleState][];
  recommendations: [string, unknown][];
  agentEvaluations: unknown[];
  voiceOutputs: [string, unknown][];
  cyberFusionRuns: [string, unknown][];
  cyberFusionReplays: unknown[];
  cyberWorkNoteSignatures: [string, string][];
  serviceNowIngestHashes: [string, string][];
  uiStates: [string, unknown][];
}

function validState(value: unknown): value is OperationalIncidentState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["users", "agents", "serviceNowIncidents", "approvals", "workflows", "backups", "systemLogs", "changeRecords", "crossSiloWorkflows", "teamEnablementMetrics", "incidentEvidence", "lifecycleOverrides", "recommendations", "agentEvaluations", "voiceOutputs", "cyberFusionRuns", "cyberFusionReplays", "cyberWorkNoteSignatures", "serviceNowIngestHashes", "uiStates"].every(key => Array.isArray(record[key])) && Boolean(record.currentMetrics && typeof record.currentMetrics === "object");
}

export class PostgresOperationalStateStore {
  private readonly pool: Pool;
  private writeChain = Promise.resolve();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
  }

  async initialize(seed: OperationalIncidentState) {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS operational_state (
      state_key VARCHAR(80) PRIMARY KEY,
      schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const inserted = await this.pool.query(`INSERT INTO operational_state (state_key, schema_version, payload)
      VALUES ('incident-control-plane', 1, $1::jsonb) ON CONFLICT (state_key) DO NOTHING RETURNING payload`, [JSON.stringify(seed)]);
    if (inserted.rows.length) return { state: structuredClone(seed), seeded: true };
    const loaded = await this.pool.query<{ payload: unknown }>("SELECT payload FROM operational_state WHERE state_key='incident-control-plane'");
    if (!validState(loaded.rows[0]?.payload)) throw new Error("PostgreSQL operational incident state is missing or invalid.");
    return { state: loaded.rows[0].payload, seeded: false };
  }

  async save(state: OperationalIncidentState) {
    const snapshot = structuredClone(state);
    const operation = this.writeChain.then(() => this.pool.query(`UPDATE operational_state SET payload=$1::jsonb, updated_at=NOW()
      WHERE state_key='incident-control-plane'`, [JSON.stringify(snapshot)]).then(result => {
        if (result.rowCount !== 1) throw new Error("Operational incident state update did not commit.");
      }));
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async flush() { await this.writeChain; }
  async close() { await this.flush(); await this.pool.end(); }
}
