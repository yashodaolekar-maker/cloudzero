import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCyberFusion } from "../../cyber-fusion.ts";
import {
  buildCyberFusionEnglishWorkNote,
  cyberFusionWorkNoteSignature,
  normalizeServiceNowSignals
} from "../../digital-twin-service.ts";
import type { TelemetrySnapshot } from "../../../types.ts";

test("ServiceNow records are normalized without retaining the raw ticket", () => {
  const incidents = normalizeServiceNowSignals([{
    externalId: "INC0012345",
    source: "ServiceNow",
    severity: "1",
    summary: "Core switch unavailable",
    observedAt: "2026-09-04T10:00:00.000Z",
    resource: "blr-core-switch-01",
    raw: {
      sys_id: "0123456789abcdef0123456789abcdef",
      state: "2",
      priority: "1",
      opened_at: "2026-09-04T09:00:00.000Z",
      cmdb_ci: { value: "ci-core-01", display_value: "blr-core-switch-01" },
      "cmdb_ci.sys_class_name": { value: "cmdb_ci_ip_switch", display_value: "Network switch" },
      assigned_to: { display_value: "Digital Twin Service" },
      secret_field: "must-not-survive"
    }
  }], new Date("2026-09-04T10:00:00.000Z"));

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].id, "INC0012345");
  assert.equal(incidents[0].cmdbItem, "ci-core-01");
  assert.equal(incidents[0].cmdbName, "blr-core-switch-01");
  assert.equal(incidents[0].metadata?.ciClass, "Network switch");
  assert.equal(incidents[0].metadata?.cmdbSysId, "ci-core-01");
  assert.equal(incidents[0].severity, "P1 - Critical");
  assert.equal(incidents[0].elapsedMinutes, 60);
  assert.equal("secret_field" in (incidents[0].metadata || {}), false);
});

test("cyber work notes are English-compatible, explicitly unconfirmed, and deduplicatable", () => {
  const snapshot: TelemetrySnapshot = {
    mode: "LIVE",
    generatedAt: "2026-09-04T10:10:00.000Z",
    expiresAt: "2026-09-04T10:11:00.000Z",
    overallHealth: "CRITICAL",
    cache: { hit: false, ttlSeconds: 60 },
    connectors: [
      { source: "SPLUNK", state: "CONNECTED", enabled: true, dataOrigin: "LIVE", lastAttemptAt: "2026-09-04T10:10:00.000Z", metricCount: 0, anomalyCount: 1, message: "ok" },
      { source: "SOLARWINDS", state: "CONNECTED", enabled: true, dataOrigin: "LIVE", lastAttemptAt: "2026-09-04T10:10:00.000Z", metricCount: 1, anomalyCount: 0, message: "ok" }
    ],
    metrics: [{
      id: "sw-loss", source: "SOLARWINDS", dataOrigin: "LIVE", name: "packet_loss_percent", displayName: "Packet loss", value: 19,
      unit: "%", observedAt: "2026-09-04T10:08:00.000Z", collectedAt: "2026-09-04T10:10:00.000Z", ageSeconds: 120,
      freshness: "FRESH", stale: false, health: "CRITICAL", resource: { id: "ci-core-01", type: "network_switch", name: "blr-core-switch-01" }
    }],
    anomalies: [{
      id: "splunk-threat", source: "SPLUNK", dataOrigin: "LIVE", signalType: "valid_accounts", title: "Suspicious account use",
      description: "Credential activity preceded loss", severity: "HIGH", confidence: 0.9, observedAt: "2026-09-04T10:02:00.000Z",
      collectedAt: "2026-09-04T10:10:00.000Z", ageSeconds: 480, freshness: "FRESH", stale: false,
      resource: { id: "ci-core-01", type: "network_switch", name: "blr-core-switch-01" }
    }]
  };
  const analysis = analyzeCyberFusion({ snapshot, incidents: [{
    id: "INC0012345", cmdbItem: "ci-core-01", cmdbName: "blr-core-switch-01", category: "Switch",
    shortDescription: "Core switch unavailable", status: "In Progress", assignedTo: "Digital Twin Service", severity: "P1 - Critical",
    openedAt: "2026-09-04T10:00:00.000Z", elapsedMinutes: 10, workNotes: []
  }] });
  const caseItem = analysis.cases.find((item) => item.incidentId === "INC0012345");
  assert.ok(caseItem);
  const note = buildCyberFusionEnglishWorkNote(analysis, caseItem);
  assert.match(note, /Causation is not confirmed/);
  assert.match(note, /No remediation was executed/);
  assert.ok(note.length <= 4_000);
  assert.match(note, /^[\x09\x0A\x0D\x20-\x7E]+$/);
  assert.equal(cyberFusionWorkNoteSignature(analysis, caseItem), cyberFusionWorkNoteSignature(analysis, caseItem));
});
