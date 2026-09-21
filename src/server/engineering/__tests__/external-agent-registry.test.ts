import test from "node:test";
import assert from "node:assert/strict";
import { ExternalAgentRegistry } from "../../external-agent-registry.ts";
import type { ServiceNowIncident } from "../../../types.ts";

const incident: ServiceNowIncident = {
  id: "INC-EXT-1", shortDescription: "Access VLAN differs from the approved VLAN", category: "Switch",
  severity: "P2 - High", status: "In Progress", assignedTo: "Network Engineering", cmdbItem: "switch-01", cmdbName: "switch-01",
  openedAt: new Date().toISOString(), elapsedMinutes: 1, workNotes: []
};

test("external registry hides API keys and routes matching evidence", async () => {
  const registry = new ExternalAgentRegistry();
  const configured = registry.upsert({ name: "Network API Agent", endpoint: "http://127.0.0.1:8080/investigate", apiKey: "top-secret",
    domains: ["NETWORK"], capabilities: ["vlan-validation"] }, true);
  assert.equal(configured.hasApiKey, true);
  assert.equal(JSON.stringify(registry.list()).includes("top-secret"), false);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer top-secret");
    return new Response(JSON.stringify({ status: "EVIDENCE_COLLECTED", summary: "VLAN mismatch observed", confidence: 0.94,
      checks: [{ command: "show interfaces switchport", purpose: "Validate access VLAN", result: "VLAN 230", expected: "VLAN 220", outcome: "FAILED" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await registry.investigate(incident, "wf-ext-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].evidence.incidentId, incident.id);
    assert.equal(result[0].evidence.workflowId, "wf-ext-1");
    assert.equal(result[0].evidence.payload?.checks[0].outcome, "FAILED");
    assert.match(result[0].evidence.integrityHash || "", /^[a-f0-9]{64}$/);
  } finally { globalThis.fetch = originalFetch; }
});

test("external registry rejects unsafe remote HTTP endpoints", () => {
  const registry = new ExternalAgentRegistry();
  assert.throws(() => registry.upsert({ name: "Unsafe", endpoint: "http://example.com/agent", apiKey: "secret",
    domains: ["NETWORK"], capabilities: ["routing"] }, true), /require HTTPS/);
});
