import assert from "node:assert/strict";
import test from "node:test";
import { findTwinWorkspace, redactTwinInput, searchCuratedTwinKnowledge, simulateTwinIncident, TWIN_WORKSPACES } from "../../../data/twinWorkspaces";

test("catalog exposes every required workspace with explicit capability coverage", () => {
  const required = ["networking", "windows", "dba", "cloudops", "devops", "middleware", "security", "sre", "collaboration"];
  assert.deepEqual(required.filter(id => !findTwinWorkspace(id)), []);
  for (const profile of TWIN_WORKSPACES) {
    assert.ok(profile.capabilities.length > 0);
    assert.ok(profile.workflows.length > 0);
    assert.ok(profile.capabilities.every(item => item.confidence >= 0 && item.confidence <= 100));
    assert.ok(profile.capabilities.every(item => ["CONNECTED", "SIMULATED", "PARTIAL", "PLANNED"].includes(item.coverage)));
  }
});

test("every critical workflow preserves the engineering decision trace and human gate", () => {
  for (const profile of TWIN_WORKSPACES) {
    for (const workflow of profile.workflows) {
      assert.deepEqual(workflow.steps.map(item => item.phase), ["OBSERVE", "CORRELATE", "VALIDATE", "PROPOSE", "HUMAN_GATE"]);
      assert.ok(workflow.steps.find(item => item.phase === "VALIDATE")?.command);
      assert.match(workflow.approval, /human/i);
    }
  }
});

test("simulation is deterministic, read-only, and redacts sensitive input", () => {
  const profile = findTwinWorkspace("networking")!;
  const input = "BGP route flap from 10.20.30.40 token=abc123\nBearer top.secret";
  const first = simulateTwinIncident(profile, input);
  const second = simulateTwinIncident(profile, input);
  assert.equal(first.matchedWorkflow.id, "net-bgp");
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.incident, /10\.20\.30\.40|abc123|top\.secret/);
  assert.match(first.incident, /PRIVATE_IP_REDACTED|REDACTED/);
  assert.equal(first.governance.find(item => item.label === "Read-only boundary")?.status, "PASS");
  assert.equal(first.governance.find(item => item.label === "Immutable ledger")?.status, "PENDING");
});

test("curated knowledge query is contextual and bounded", () => {
  const profile = findTwinWorkspace("network")!;
  const results = searchCuratedTwinKnowledge(profile, "Infoblox DHCP troubleshooting");
  assert.equal(results[0]?.id, "net-kb-dhcp");
  assert.equal(redactTwinInput("x".repeat(900)).length, 600);
  assert.throws(() => simulateTwinIncident(profile, "\u0000\n"), /Enter a test incident/);
});
