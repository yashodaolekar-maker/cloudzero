import assert from "node:assert/strict";
import test from "node:test";
import type { IncidentAggregate, ServiceNowIncident, WorkflowInstance } from "../../../types.ts";
import { EngineeringIncidentOrchestrator, correlateCmdbTarget, diagnosticPlanFor, redactOperationalText, selectEngineerPersona, type CommandProxy } from "../../engineering-orchestrator.ts";

function aggregate(summary = "BGP neighbors down", category: ServiceNowIncident["category"] = "SDWAN"): IncidentAggregate {
  const incident: ServiceNowIncident = { id: "INC001", cmdbItem: "ci-router-01", cmdbName: "router", category, shortDescription: summary, status: "In Progress", assignedTo: "Digital Twin", severity: "P1 - Critical", openedAt: new Date().toISOString(), elapsedMinutes: 1, workNotes: [], metadata: {} };
  const workflow: WorkflowInstance = { id: "wf-001", incidentId: incident.id, name: "Diagnostics", agentId: "agent-nre", status: "ACTIVE", startedAt: new Date().toISOString(), steps: [] };
  return { incidentId: incident.id, title: summary, severity: incident.severity, lifecycleState: "INVESTIGATING", operatingMode: "SIMULATION", serviceNowIncident: incident, workflows: [workflow], crossSiloWorkflows: [], approvals: [], changeRecords: [], evidence: [], updatedAt: new Date().toISOString() };
}

test("selects security before infrastructure keywords", () => assert.equal(selectEngineerPersona(aggregate("Router down after malware threat").serviceNowIncident!), "SECURITY"));
test("uses explicit network category before incidental cloud wording", () => assert.equal(selectEngineerPersona(aggregate("SD-WAN path to cloud is down").serviceNowIncident!), "NETWORK"));
test("redacts secrets and private IP addresses", () => assert.equal(redactOperationalText("token=abc host=10.1.2.3"), "token=[REDACTED] host=[PRIVATE_IP_REDACTED]"));
test("rejects private IP as CMDB target", () => assert.throws(() => correlateCmdbTarget({ ...aggregate().serviceNowIncident!, cmdbItem: "10.1.2.3" })));
test("rejects missing CMDB placeholder targets", () => assert.throws(() => correlateCmdbTarget({ ...aggregate().serviceNowIncident!, cmdbItem: "unknown-ci" })));
test("requires exact workflow binding", async () => {
  const proxy: CommandProxy = { executeCommand: async () => ({ executionId: "x", status: "SIMULATED", output: "ok", observedAt: new Date().toISOString() }) };
  await assert.rejects(() => new EngineeringIncidentOrchestrator(proxy).diagnose({ incident: aggregate(), workflowId: "wf-other", templateId: "NETWORK_BGP_SUMMARY", actorId: "user" }), /not bound/);
});
test("executes only persona-matched templates and emits structured evidence", async () => {
  let request: any;
  const proxy: CommandProxy = { executeCommand: async input => { request = input; return { executionId: "exec-1", status: "SUCCEEDED", output: "neighbor 192.168.1.1 token=oops", observedAt: "2026-01-01T00:00:00.000Z" }; } };
  const result = await new EngineeringIncidentOrchestrator(proxy).diagnose({ incident: aggregate(), workflowId: "wf-001", templateId: "NETWORK_BGP_SUMMARY", actorId: "user" });
  assert.equal(request.deviceId, "ci-router-01");
  assert.match(result.response.output, /PRIVATE_IP_REDACTED/);
  assert.match(result.workNote, /REDACTED DEVICE ID/);
  assert.equal(result.evidence.workflowId, "wf-001");
  assert.ok(result.evidence.integrityHash);
});
test("blocks cross-persona commands", async () => {
  const proxy: CommandProxy = { executeCommand: async () => { throw new Error("must not run"); } };
  await assert.rejects(() => new EngineeringIncidentOrchestrator(proxy).diagnose({ incident: aggregate(), workflowId: "wf-001", templateId: "WINDOWS_SERVICE_STATUS", parameters: { service_name: "Spooler" }, actorId: "user" }), /not allowlisted/);
});

test("proxy response projection never returns unexpected credential fields", async () => {
  const proxy: CommandProxy = { executeCommand: async () => ({ executionId: "exec-1", status: "SUCCEEDED", output: "ok", observedAt: "2026-01-01T00:00:00.000Z", rawCredential: "never-return-this" }) };
  const result = await new EngineeringIncidentOrchestrator(proxy).diagnose({ incident: aggregate(), workflowId: "wf-001", templateId: "NETWORK_BGP_SUMMARY", actorId: "user" });
  assert.ok(!JSON.stringify(result).includes("never-return-this"));
});

test("builds bounded device-specific network validation plans", () => {
  const firewall = aggregate("Firewall session missing for application flow", "Switch").serviceNowIncident!;
  firewall.metadata = { ciClass: "firewall", sourceRef: "client-a", destinationRef: "app-a" };
  assert.deepEqual(diagnosticPlanFor("NETWORK", firewall).map(item => item.templateId), [
    "NETWORK_FIREWALL_SESSION_SUMMARY"
  ]);
  const wireless = aggregate("WLC reports access point roaming failure", "Wireless").serviceNowIncident!;
  assert.ok(diagnosticPlanFor("NETWORK", wireless).some(item => item.templateId === "NETWORK_WIRELESS_CLIENT_SUMMARY"));
  const sdwan = aggregate("SDWAN control connection tunnel down").serviceNowIncident!;
  assert.ok(diagnosticPlanFor("NETWORK", sdwan).some(item => item.templateId === "NETWORK_SDWAN_CONTROL_SUMMARY"));
});

test("Windows reachability incident selects the correlated host network check", () => {
  const windows = aggregate("Windows application cannot reach service").serviceNowIncident!;
  windows.metadata = { ciClass: "windows", destinationRef: "app-service" };
  const plan = diagnosticPlanFor("WINDOWS", windows);
  assert.deepEqual(plan.map(item => item.templateId), ["WINDOWS_NETWORK_VALIDATION"]);
});
