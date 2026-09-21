import assert from "node:assert/strict";
import test from "node:test";
import type { IncidentAggregate, IncidentEvidence } from "../../../types.ts";
import { OrchestratorRuntime } from "../../agent-runtime.ts";

function incident(evidence: IncidentEvidence[] = []): IncidentAggregate {
  return {
    incidentId: "INC-GROUND-1",
    title: "BGP route instability",
    severity: "P1 - Critical",
    lifecycleState: "INVESTIGATING",
    operatingMode: "SIMULATION",
    workflows: [],
    crossSiloWorkflows: [],
    approvals: [],
    changeRecords: [],
    evidence,
    updatedAt: "2026-09-05T10:00:00.000Z"
  };
}

const context = {
  operatingMode: "SIMULATION" as const,
  approved: false,
  productionExecutionEnabled: false,
  qualityGatePassed: false
};

test("orchestrator abstains with zero confidence when no domain evidence exists", async () => {
  const result = await new OrchestratorRuntime().investigate(incident(), context);

  assert.equal(result.recommendation, null);
  assert.equal(result.counterfactualSimulation, null);
  assert.equal(result.abstention?.code, "NO_DOMAIN_EVIDENCE");
  assert.ok(result.findings.every(finding => finding.confidence === 0));
  assert.ok(result.findings.every(finding => finding.freshness === "STALE"));
});

test("orchestrator never invents an action target from corroborated telemetry", async () => {
  const common = {
    incidentId: "INC-GROUND-1",
    summary: "BGP route health anomaly observed on router-ci-17",
    confidenceScore: 0.9,
    observedAt: "2026-09-05T10:00:00.000Z",
    integrityHash: "evidence-integrity",
    payload: { relevantDepartments: ["Network"] }
  } satisfies Partial<IncidentEvidence>;
  const evidence: IncidentEvidence[] = [
    {
      ...common,
      id: "ev-network",
      source: "SOLARWINDS:NETWORK_OBSERVABILITY",
      provenance: {
        sourceRecordHash: "source-network",
        connector: "SOLARWINDS",
        sourceFamily: "NETWORK_OBSERVABILITY",
        dataOrigin: "LIVE",
        freshness: "FRESH",
        stale: false,
        observedAtAssumed: false,
        canonicalCiId: "router-ci-17",
        cmdbResolution: "CMDB_EXACT"
      }
    },
    {
      ...common,
      id: "ev-siem",
      source: "SPLUNK:SIEM",
      provenance: {
        sourceRecordHash: "source-siem",
        connector: "SPLUNK",
        sourceFamily: "SIEM",
        dataOrigin: "LIVE",
        freshness: "FRESH",
        stale: false,
        observedAtAssumed: false,
        canonicalCiId: "router-ci-17",
        cmdbResolution: "CMDB_EXACT"
      }
    }
  ];

  const result = await new OrchestratorRuntime().investigate(incident(evidence), context);

  assert.equal(result.recommendation, null);
  assert.equal(result.abstention?.code, "NO_SIGNED_ACTION_CANDIDATE");
  assert.doesNotMatch(JSON.stringify(result), /spine-switch-02|ISP-Alpha|prod-web\/customer-portal/);
});
