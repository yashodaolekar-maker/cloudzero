import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { IncidentAggregate, ServiceNowIncident } from "../../../types.ts";
import { collaborateOnIncident } from "../../agent-collaboration.ts";
import { simulationEvidenceHandler } from "../../agent-exchange-simulator.ts";
import { collaborationPlan, correlateCmdbTarget, GrpcCommandProxy, redactOperationalText, selectEngineerPersona, SimulationCommandProxy, type AgentEvidenceMessage, type CommandProxy } from "../../engineering-orchestrator.ts";

function incident(summary = "Network certificate expiry", metadata = {}): IncidentAggregate {
  const serviceNowIncident: ServiceNowIncident = { id: "INC001", cmdbItem: "ci-001", cmdbName: "router", category: "Switch", shortDescription: summary,
    metadata, status: "In Progress", assignedTo: "Digital Twin", severity: "P1 - Critical", openedAt: new Date().toISOString(), elapsedMinutes: 0, workNotes: [] };
  return { incidentId: "INC001", title: summary, severity: "P1 - Critical", lifecycleState: "INVESTIGATING", operatingMode: "SIMULATION", serviceNowIncident,
    workflows: [{ id: "wf-001", incidentId: "INC001", name: "Diagnostics", agentId: "twin", status: "ACTIVE", startedAt: new Date().toISOString(), steps: [] }],
    crossSiloWorkflows: [], approvals: [], changeRecords: [], evidence: [], updatedAt: new Date().toISOString() };
}

test("resolves each supplied demo domain to its own CMDB target", () => {
  const owner = incident("Checkout API intermittent timeouts", {
    ciClass: "middleware",
    cmdbSysId: "demo-ci-session-middleware",
    relatedChange: "DEMO-CHG-1"
  }).serviceNowIncident!;
  const resources = [
    { role: "NETWORK", id: "demo-ci-session-network", name: "demo-network-01" },
    { role: "MIDDLEWARE", id: "demo-ci-session-middleware", name: "demo-middleware-01" },
    { role: "DATABASE", id: "demo-ci-session-database", name: "demo-database-01" }
  ] as const;

  for (const resource of resources) {
    const target: ServiceNowIncident = {
      ...owner,
      id: `${owner.id}-${resource.role}`,
      cmdbItem: resource.id,
      cmdbName: resource.name,
      metadata: {
        ...owner.metadata,
        cmdbSysId: resource.id,
        ciClass: resource.role.toLowerCase()
      }
    };
    assert.equal(correlateCmdbTarget(target), resource.id);
    assert.equal(selectEngineerPersona(target), resource.role);
  }
});

test("routes CI classes and assigns cross-domain remediation ownership", () => {
  const azure = collaborationPlan(incident("Azure ISE network outage", { ciClass: "cmdb_ci_cloud_resource" }).serviceNowIncident!);
  assert.equal(azure.initialPersona, "CLOUDOPS");
  assert.equal(azure.responsiblePersona, "CLOUDOPS");
  assert.deepEqual(new Set(azure.participants), new Set(["NETWORK", "CLOUDOPS"]));
  const certificate = collaborationPlan(incident().serviceNowIncident!);
  assert.equal(certificate.responsiblePersona, "NETWORK");
  assert.ok(certificate.participants.includes("SECURITY"));
});

test("collaboration persists before exchange, redacts observations, and shares a final common context", async () => {
  const events: { type: string; payload: any }[] = [];
  const messages: AgentEvidenceMessage[] = [];
  const proxy: CommandProxy = {
    executeCommand: async r => ({ executionId: `exec-${r.persona}`, status: "SUCCEEDED", output: 'host=10.1.2.3 token=hidden Authorization: Bearer xyz', observedAt: new Date().toISOString() }),
    exchangeEvidence: async r => {
      assert.equal(events.at(-1)?.type, "AgentEvidenceExchangeRequested");
      messages.push(r);
      return { ...r, status: "ACKNOWLEDGED" };
    }
  };
  const result = await collaborateOnIncident({ incident: incident(), workflowId: "wf-001", actorId: "test", proxy,
    audit: async (type, payload) => { events.push({ type, payload }); } });
  assert.equal(result.disposition, "ABSTAIN");
  assert.equal(result.remediationExecuted, false);
  assert.ok(result.evidence.length >= 2);
  assert.equal(JSON.parse(messages.at(-1)!.evidenceJson).length, result.evidence.length);
  assert.ok(!JSON.stringify(events).includes("10.1.2.3"));
  assert.ok(!JSON.stringify(events).includes("hidden"));
  assert.ok(!JSON.stringify(events).includes("xyz"));
  assert.match(result.workNote, /CHECKS COMPLETED/);
  assert.match(result.workNote, /TEAM COMMUNICATION/);
  assert.match(result.workNote, /Responsible remediation team: NETWORK/);
  assert.match(result.workNote, /Final verdict:/);
});

test("never dispatches Kubernetes diagnostics to Azure ISE", async () => {
  const requests: string[] = [];
  const proxy = new SimulationCommandProxy();
  const original = proxy.executeCommand.bind(proxy);
  proxy.executeCommand = async r => { requests.push(r.templateId); return original(r); };
  const result = await collaborateOnIncident({ incident: incident("Azure ISE network outage"), workflowId: "wf-001", actorId: "test", proxy, audit: async () => {} });
  assert.ok(requests.includes("NETWORK_INTERFACE_SUMMARY"));
  assert.ok(!requests.some(template => template.startsWith("KUBERNETES_")));
  assert.equal(result.responsiblePersona, "CLOUDOPS");
  assert.match(result.workNote, /no applicable read-only cloud template/);
});

test("fails closed before dispatch when the audit store is unavailable", async () => {
  const proxy: CommandProxy = { executeCommand: async () => { assert.fail("must not dispatch"); }, exchangeEvidence: async () => { assert.fail("must not share"); } };
  await assert.rejects(collaborateOnIncident({ incident: incident(), workflowId: "wf-001", actorId: "test", proxy, audit: async () => { throw new Error("ledger unavailable"); } }), /ledger unavailable/);
});

test("Network requests Windows maintenance validation and consumes the correlated reply", async () => {
  const aggregate = incident("Network connectivity failed after Windows maintenance", { ciClass: "network", relatedChange: "CHG001" });
  const windows = { ...aggregate.serviceNowIncident!, id: "INC-WIN", cmdbItem: "ci-windows", cmdbName: "windows-host", metadata: { ciClass: "windows", relatedChange: "CHG001" } };
  const requests: any[] = [];
  const prompts: string[] = [];
  const events: any[] = [];
  const proxy: CommandProxy = {
    executeCommand: async request => { requests.push(request); return { executionId: `exec-${request.persona}`, status: "SUCCEEDED", output: "Diagnostic observation recorded", observedAt: new Date().toISOString() }; },
    exchangeEvidence: async request => ({ ...request, status: "ACKNOWLEDGED" })
  };
  const result = await collaborateOnIncident({ incident: aggregate, workflowId: "wf-001", actorId: "test", proxy,
    relatedTargets: { WINDOWS: windows },
    generate: async messages => { prompts.push(JSON.stringify(messages)); return JSON.stringify({ assessment: "Maintenance timing needs comparison with the failure onset.", nextCheck: "Compare event timestamps with the change window.", evidenceIds: [] }); },
    audit: async (type, payload) => { events.push({ type, payload }); }
  });
  assert.equal(requests.find(request => request.persona === "WINDOWS").deviceId, "ci-windows");
  const reply = result.replies.find(item => item.sender === "WINDOWS")!;
  assert.equal(reply.recipient, "NETWORK");
  assert.equal(reply.validationStatus, "OBSERVATIONS_AVAILABLE");
  assert.equal(reply.causalStatus, "UNCONFIRMED");
  assert.deepEqual(reply.validationChecks.map(check => check.templateId), ["WINDOWS_NETWORK_VALIDATION"]);
  assert.ok(reply.validationChecks.every(check => check.command && check.output && check.evidenceId));
  assert.ok(events.some(event => event.type === "AgentInvestigationRequested" && event.payload.messageId === reply.inReplyTo));
  assert.ok(prompts.at(-1)!.includes('WINDOWS'));
  assert.ok(prompts.at(-1)!.includes('priorReplies'));
  assert.equal(result.ownerAssessment.modelStatus, "GENERATED");
});

test("missing Windows target returns an evidence request without running host commands on the router", async () => {
  const aggregate = incident("Network failure after Windows maintenance", { ciClass: "network" });
  const proxy = new SimulationCommandProxy();
  const commands: string[] = [];
  proxy.executeCommand = async request => { commands.push(request.templateId); return { executionId: "exec", status: "SIMULATED", output: "simulation", observedAt: new Date().toISOString() }; };
  const result = await collaborateOnIncident({ incident: aggregate, workflowId: "wf-001", actorId: "test", proxy, audit: async () => {} });
  assert.ok(!commands.includes("WINDOWS_RECENT_SYSTEM_ERRORS"));
  assert.equal(result.replies.find(reply => reply.sender === "WINDOWS")?.validationStatus, "NEEDS_EVIDENCE");
});

test("invented LLM citations cannot become validation and simulation is never live evidence", async () => {
  const result = await collaborateOnIncident({ incident: incident(), workflowId: "wf-001", actorId: "test", proxy: new SimulationCommandProxy(), audit: async () => {},
    generate: async () => JSON.stringify({ assessment: "Verified", nextCheck: "Close it", evidenceIds: ["invented"] }) });
  assert.equal(result.ownerAssessment.modelStatus, "INVALID_RESPONSE");
  assert.equal(result.ownerAssessment.validationStatus, "SIMULATED");
  assert.equal(result.remediationExecuted, false);
});

test("rejects another workflow and mismatched recipient receipts", async () => {
  const proxy = new SimulationCommandProxy();
  await assert.rejects(collaborateOnIncident({ incident: incident(), workflowId: "wf-other", actorId: "test", proxy, audit: async () => {} }), /incident-bound/);
  proxy.exchangeEvidence = async r => ({ ...r, recipient: "WINDOWS", status: "ACKNOWLEDGED" });
  const result = await collaborateOnIncident({ incident: incident(), workflowId: "wf-001", actorId: "test", proxy, audit: async () => {} });
  assert.equal(result.disposition, "ABSTAIN");
  assert.match(result.workNote, /exchange failed/);
  assert.ok(!result.evidence.some(e => e.payload?.persona === "SECURITY"));
});

test("simulation acknowledgements cannot authorize live collaboration", async () => {
  const aggregate = incident(); aggregate.operatingMode = "LIVE";
  const result = await collaborateOnIncident({ incident: aggregate, workflowId: "wf-001", actorId: "test", proxy: new SimulationCommandProxy(), audit: async () => {} });
  assert.match(result.workNote, /exchange failed/);
  assert.equal(result.disposition, "ABSTAIN");
});

test("redacts quoted credentials, URI passwords, private IPv6 and bearer tokens", () => {
  const value = redactOperationalText('password="two word secret" https://user:pass@example.com Authorization: Bearer abc.def fd12:3456::1');
  for (const secret of ["two word secret", "user:pass", "abc.def", "fd12:3456::1"]) assert.ok(!value.includes(secret));
});

test("gRPC exchanges use the real protobuf contract and authenticated simulator", async () => {
  const definition = protoLoader.loadSync(path.resolve("proto/command_proxy.proto"), { keepCase: false, defaults: true });
  const service = (grpc.loadPackageDefinition(definition) as any).cloudzero.commandproxy.v1.CommandProxy;
  const server = new grpc.Server();
  server.addService(service.service, { exchangeEvidence: simulationEvidenceHandler("test-service-token") });
  const port = await new Promise<number>((resolve, reject) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  const previous = process.env.OPERATING_MODE;
  process.env.OPERATING_MODE = "SIMULATION";
  const proxy = new GrpcCommandProxy({ get: async () => "test-service-token" }, `127.0.0.1:${port}`);
  const message: AgentEvidenceMessage = { incidentId: "INC001", workflowId: "wf-001", correlationId: "corr-001", sender: "NETWORK", recipient: "SECURITY", evidenceJson: "[]", candidateActionsJson: "[]" };
  try {
    assert.equal((await proxy.exchangeEvidence(message)).status, "SIMULATED");
    await assert.rejects(proxy.exchangeEvidence({ ...message, evidenceJson: JSON.stringify([{ incidentId: "OTHER", workflowId: "wf-001" }]) }), /Agent exchange failed/);
    await assert.rejects(proxy.exchangeEvidence({ ...message, evidenceJson: JSON.stringify([{ incidentId: "INC001", workflowId: "wf-001", summary: "token=secret" }]) }), /Agent exchange failed/);
    const wrongIdentity = new GrpcCommandProxy({ get: async () => "wrong-token" }, `127.0.0.1:${port}`);
    try { await assert.rejects(wrongIdentity.exchangeEvidence(message), /Agent exchange failed: 16/); }
    finally { wrongIdentity.close(); }
  } finally {
    proxy.close();
    server.forceShutdown();
    if (previous === undefined) delete process.env.OPERATING_MODE; else process.env.OPERATING_MODE = previous;
  }
});
