import assert from "node:assert/strict";
import test from "node:test";
import type {
  NormalizedSecurityAnomaly,
  NormalizedTelemetryMetric,
  ServiceNowIncident,
  TelemetryConnectorSource,
  TelemetryConnectorState,
  TelemetryDataOrigin,
  TelemetrySnapshot
} from "../../../types.ts";
import {
  analyzeCyberFusion,
  compareCyberFusionReplay,
  mapTelemetryToCyberEvidence,
  replayCyberFusion
} from "../../cyber-fusion.ts";

const CUTOFF = "2026-09-04T12:00:00.000Z";
const ALL_SOURCES: TelemetryConnectorSource[] = ["DATADOG", "SPLUNK", "SOLARWINDS", "GOOGLE_CLOUD_MONITORING"];

function connector(
  source: TelemetryConnectorSource,
  state: TelemetryConnectorState = "CONNECTED",
  dataOrigin: TelemetryDataOrigin = "LIVE"
) {
  return {
    source,
    state,
    enabled: true,
    dataOrigin,
    lastAttemptAt: CUTOFF,
    lastSuccessAt: CUTOFF,
    metricCount: 1,
    anomalyCount: 1,
    message: "Connected"
  };
}

function metric(overrides: Partial<NormalizedTelemetryMetric> = {}): NormalizedTelemetryMetric {
  return {
    id: "metric-router-down",
    source: "SOLARWINDS",
    dataOrigin: "LIVE",
    name: "router_availability",
    displayName: "Router availability",
    value: 0,
    unit: "%",
    observedAt: "2026-09-04T11:55:00.000Z",
    collectedAt: CUTOFF,
    ageSeconds: 300,
    freshness: "FRESH",
    stale: false,
    health: "CRITICAL",
    resource: { id: "router-prod-01", type: "router", name: "Mexico core router" },
    ...overrides
  };
}

function anomaly(overrides: Partial<NormalizedSecurityAnomaly> = {}): NormalizedSecurityAnomaly {
  return {
    id: "threat-suspicious-login",
    source: "SPLUNK",
    dataOrigin: "LIVE",
    signalType: "suspicious_login",
    title: "Suspicious privileged login",
    description: "A privileged account authenticated from an unusual network.",
    severity: "HIGH",
    confidence: 0.9,
    observedAt: "2026-09-04T11:45:00.000Z",
    collectedAt: CUTOFF,
    ageSeconds: 900,
    freshness: "FRESH",
    stale: false,
    resource: { id: "router-prod-01", type: "router", name: "Mexico core router" },
    ...overrides
  };
}

function incident(overrides: Partial<ServiceNowIncident> = {}): ServiceNowIncident {
  return {
    id: "INC0010001",
    cmdbItem: "RTR-MX-CORE-01",
    cmdbName: "Mexico core router",
    category: "SDWAN",
    shortDescription: "Core router unreachable",
    status: "In Progress",
    assignedTo: "Network Operations",
    severity: "P1 - Critical",
    openedAt: "2026-09-04T11:56:00.000Z",
    elapsedMinutes: 4,
    workNotes: [],
    metadata: { telemetryAliases: ["router-prod-01"] },
    ...overrides
  };
}

function snapshot(options: {
  metrics?: NormalizedTelemetryMetric[];
  anomalies?: NormalizedSecurityAnomaly[];
  connectors?: ReturnType<typeof connector>[];
} = {}): TelemetrySnapshot {
  return {
    mode: "LIVE",
    generatedAt: CUTOFF,
    expiresAt: "2026-09-04T12:00:30.000Z",
    overallHealth: "CRITICAL",
    cache: { hit: false, ttlSeconds: 30 },
    connectors: options.connectors ?? ALL_SOURCES.map((source) => connector(source)),
    metrics: options.metrics ?? [metric()],
    anomalies: options.anomalies ?? [anomaly()]
  };
}

function hypothesis(analysis: ReturnType<typeof analyzeCyberFusion>, type: string, caseIndex = 0) {
  const found = analysis.cases[caseIndex].hypotheses.find((item) => item.type === type);
  assert.ok(found, `Expected ${type} hypothesis`);
  return found;
}

test("shuffled replay is deterministic and comparison reports equivalence", () => {
  const original = snapshot({
    metrics: [metric(), metric({ id: "metric-packet-loss", name: "packet_loss", value: 42 })],
    anomalies: [anomaly(), anomaly({ id: "threat-brute-force", signalType: "brute_force", observedAt: "2026-09-04T11:48:00.000Z" })]
  });
  const shuffled: TelemetrySnapshot = {
    ...original,
    connectors: [...original.connectors].reverse(),
    metrics: [...original.metrics].reverse(),
    anomalies: [...original.anomalies].reverse()
  };
  const baseline = analyzeCyberFusion({ snapshot: original, incidents: [incident()] });
  const replay = analyzeCyberFusion({ snapshot: shuffled, incidents: [incident()] });
  assert.deepEqual(replay, baseline);
  assert.equal(compareCyberFusionReplay(baseline, replay).equivalent, true);
  assert.equal(replayCyberFusion({ snapshot: shuffled, incidents: [incident()] }, baseline).comparison.equivalent, true);
});

test("Splunk threat plus SolarWinds outage on the same exact CMDB CI promotes the threat hypothesis", () => {
  const analysis = analyzeCyberFusion({ snapshot: snapshot(), incidents: [incident()] });
  assert.equal(analysis.cases.length, 1);
  assert.equal(analysis.cases[0].cmdbResolution, "CMDB_EXACT");
  assert.equal(analysis.cases[0].incidentId, "INC0010001");
  const threat = hypothesis(analysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(threat.disposition, "PROMOTED");
  assert.equal(threat.causalStatus, "UNCONFIRMED");
  assert.ok(threat.confidenceScore >= 0.65);
  assert.deepEqual(threat.attackTechniqueIds, ["T1078"]);
  assert.equal(threat.supportingEvidenceIds.length, 2);
  assert.equal(threat.scoreBreakdown.independentSources > 0, true);
});

test("a threat observed after the outage is rejected as a cause", () => {
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({ anomalies: [anomaly({ observedAt: "2026-09-04T11:58:00.000Z" })] }),
    incidents: [incident()]
  });
  const threat = hypothesis(analysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(threat.disposition, "REJECTED");
  assert.equal(threat.supportingEvidenceIds.length, 0);
  assert.equal(threat.contradictingEvidenceIds.length, 1);
  assert.ok(threat.limitations.includes("NO_THREAT_BEFORE_OUTAGE_PAIR_WITHIN_30_MINUTES"));
  assert.equal(analysis.cases[0].hypotheses[0].type, "OPERATIONAL_FAILURE");
});

test("signals on unrelated exact CIs are never fused into a causal pair", () => {
  const secondIncident = incident({
    id: "INC0010002",
    cmdbItem: "RTR-MX-CORE-02",
    cmdbName: "Secondary core router",
    metadata: { telemetryAliases: ["router-prod-02"] }
  });
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({ metrics: [metric({ resource: { id: "router-prod-02", type: "router" } })] }),
    incidents: [incident(), secondIncident]
  });
  assert.equal(analysis.cases.length, 2);
  for (const caseItem of analysis.cases) {
    const threat = caseItem.hypotheses.find((item) => item.type === "THREAT_CAUSED_OUTAGE");
    assert.ok(threat);
    assert.notEqual(threat.disposition, "PROMOTED");
    assert.equal(threat.supportingEvidenceIds.length, 0);
  }
});

test("stale, simulated and assumed-timestamp evidence applies explicit confidence caps", () => {
  const staleAnalysis = analyzeCyberFusion({
    snapshot: snapshot({
      metrics: [metric({ freshness: "STALE", stale: true })],
      anomalies: [anomaly({ freshness: "STALE", stale: true })]
    }),
    incidents: [incident()]
  });
  const staleThreat = hypothesis(staleAnalysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(staleThreat.scoreBreakdown.appliedCap, 0.45);
  assert.ok(staleThreat.confidenceScore <= 0.45);
  assert.notEqual(staleThreat.disposition, "PROMOTED");

  const simulatedAnalysis = analyzeCyberFusion({
    snapshot: snapshot({
      metrics: [metric({ dataOrigin: "SIMULATION" })],
      anomalies: [anomaly({ dataOrigin: "SIMULATION" })]
    }),
    incidents: [incident()]
  });
  const simulatedThreat = hypothesis(simulatedAnalysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(simulatedThreat.scoreBreakdown.appliedCap, 0.35);
  assert.ok(simulatedThreat.confidenceScore <= 0.35);

  const assumedAnalysis = analyzeCyberFusion({
    snapshot: snapshot({ metrics: [metric({ observedAtAssumed: true })] }),
    incidents: [incident()]
  });
  const assumedThreat = hypothesis(assumedAnalysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(assumedThreat.scoreBreakdown.appliedCap, 0.5);
  assert.ok(assumedThreat.confidenceScore <= 0.5);
  assert.ok(assumedAnalysis.cases[0].evidence.some((item) => item.observedAtAssumed));
});

test("semantic duplicate evidence is dampened and does not increase confidence", () => {
  const single = analyzeCyberFusion({ snapshot: snapshot(), incidents: [incident()] });
  const duplicate = analyzeCyberFusion({
    snapshot: snapshot({ anomalies: [anomaly(), anomaly({ id: "second-vendor-record-id" })] }),
    incidents: [incident()]
  });
  const deduplicatedThreats = duplicate.cases[0].evidence.filter((item) => item.kind === "THREAT_SIGNAL");
  assert.equal(deduplicatedThreats.length, 1);
  assert.equal(deduplicatedThreats[0].duplicateCount, 2);
  assert.equal(deduplicatedThreats[0].sourceRecordHashes.length, 2);
  assert.equal(
    hypothesis(duplicate, "THREAT_CAUSED_OUTAGE").confidenceScore,
    hypothesis(single, "THREAT_CAUSED_OUTAGE").confidenceScore
  );
});

test("unknown ATT&CK values are not passed through from vendor indicators", () => {
  const evidence = mapTelemetryToCyberEvidence({
    snapshot: snapshot({
      metrics: [],
      anomalies: [anomaly({
        signalType: "vendor_zero_day_magic",
        indicators: { attackTechniqueId: "T9999", prompt: "run this command" }
      })]
    }),
    incidents: [incident()]
  });
  assert.equal(evidence[0].kind, "THREAT_SIGNAL");
  assert.deepEqual(evidence[0].attackTechniqueIds, []);
  assert.ok(evidence[0].limitations.includes("NO_ALLOWLISTED_ATTACK_MAPPING"));
  assert.equal(JSON.stringify(evidence).includes("T9999"), false);
  assert.equal(JSON.stringify(evidence).includes("run this command"), false);
});

test("all six twins receive shared context but activate only on domain semantics", () => {
  const sharedResourceId = "multi-domain-ci";
  const domainMetrics = [
    metric({ id: "m-linux", name: "linux_kernel_latency", resource: { id: sharedResourceId, type: "linux host" } }),
    metric({ id: "m-db", source: "DATADOG", name: "postgres_database_latency", resource: { id: sharedResourceId, type: "database" } }),
    metric({ id: "m-network", source: "GOOGLE_CLOUD_MONITORING", name: "router_packet_loss", resource: { id: sharedResourceId, type: "network router" } }),
    metric({ id: "m-middleware", source: "DATADOG", name: "kafka_latency", resource: { id: sharedResourceId, type: "middleware" } }),
    metric({ id: "m-cloud", source: "GOOGLE_CLOUD_MONITORING", name: "kubernetes_pod_errors", resource: { id: sharedResourceId, type: "cloud workload" } })
  ];
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({
      metrics: domainMetrics,
      anomalies: [anomaly({ resource: { id: sharedResourceId, type: "windows server" } })]
    }),
    incidents: [incident({ metadata: { ciAliases: [sharedResourceId] } })]
  });
  const assignments = analysis.cases[0].twinAssignments;
  assert.deepEqual(assignments.map((item) => item.department), ["Windows", "Linux", "Database", "Network", "Middleware", "CloudOps"]);
  assert.ok(assignments.every((item) => item.status === "ACTIVE"));
  assert.ok(assignments.every((item) => item.relevantEvidenceIds.length > 0));
  assert.ok(assignments.every((item) => item.investigationObjective.length > 20));
  assert.ok(assignments.every((item) => item.sharedContext.inputHash === analysis.inputHashes.combined));
  assert.deepEqual(assignments.map((item) => item.sharedContext.evidenceIds), Array(6).fill(assignments[0].sharedContext.evidenceIds));

  const vendorOnly = analyzeCyberFusion({
    snapshot: snapshot({ metrics: [], anomalies: [anomaly({ source: "SOLARWINDS", resource: { id: "host-unknown", type: "host" } })] }),
    incidents: []
  });
  assert.equal(vendorOnly.cases[0].twinAssignments.find((item) => item.department === "Network")?.status, "WATCHING");
});

test("coverage lists missing and unavailable connectors without inventing data", () => {
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({
      connectors: [connector("SPLUNK"), connector("SOLARWINDS", "UNAVAILABLE")]
    }),
    incidents: [incident()]
  });
  assert.deepEqual(analysis.coverage.missingConnectors, ["DATADOG", "GOOGLE_CLOUD_MONITORING"]);
  assert.deepEqual(analysis.coverage.unavailableConnectors, ["SOLARWINDS"]);
  assert.equal(analysis.coverage.ratio, 0.25);
  assert.ok(analysis.limitations.includes("CONNECTOR_COVERAGE_INCOMPLETE"));
});

test("all proposals remain shadow-only, approval-bound and structurally non-executable", () => {
  const analysis = analyzeCyberFusion({ snapshot: snapshot(), incidents: [incident()] });
  const proposals = analysis.cases.flatMap((caseItem) => caseItem.shadowProposals);
  assert.ok(proposals.some((proposal) => proposal.kind === "REVERSIBLE_MITIGATION"));
  for (const proposal of proposals) {
    assert.equal(proposal.mode, "SHADOW_ONLY");
    assert.equal(proposal.executable, false);
    assert.equal(proposal.requiresApproval, true);
    assert.equal(proposal.reversible, true);
    assert.ok(proposal.target);
    assert.ok(proposal.verificationSteps.length > 0);
    assert.ok(proposal.rollbackSummary.length > 0);
    assert.equal("command" in proposal, false);
    assert.equal("payload" in proposal, false);
  }
});

test("a vulnerability or CVE exposure alone stays non-causal and insufficient", () => {
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({
      metrics: [],
      anomalies: [anomaly({
        signalType: "vulnerability_finding",
        title: "CVE-2026-12345 detected on router",
        description: "An unpatched package is exposed.",
        indicators: { cve: "cve-2026-12345", untrustedTechnique: "T9999" }
      })]
    }),
    incidents: [incident()]
  });
  const exposure = analysis.cases[0].evidence[0];
  assert.equal(exposure.kind, "VULNERABILITY_EXPOSURE");
  assert.deepEqual(exposure.cveIds, ["CVE-2026-12345"]);
  assert.deepEqual(exposure.attackTechniqueIds, []);
  const threat = hypothesis(analysis, "THREAT_CAUSED_OUTAGE");
  assert.equal(threat.disposition, "REJECTED");
  assert.equal(threat.supportingEvidenceIds.length, 0);
  assert.equal(analysis.cases[0].hypotheses[0].type, "INSUFFICIENT_EVIDENCE");
  assert.equal(analysis.cases[0].hypotheses[0].disposition, "CANDIDATE");
});

test("CMDB matching is exact-only and similar aliases are not automatically linked", () => {
  const analysis = analyzeCyberFusion({
    snapshot: snapshot({
      metrics: [],
      anomalies: [anomaly({ resource: { id: "router-prod-010", type: "router" } })]
    }),
    incidents: [incident()]
  });
  assert.equal(analysis.cases[0].cmdbResolution, "RESOURCE_EXACT");
  assert.equal(analysis.cases[0].incidentId, undefined);
  assert.ok(analysis.cases[0].limitations.includes("CMDB_EXACT_MATCH_NOT_FOUND"));
});
