import assert from "node:assert/strict";
import test from "node:test";
import type { IncidentAggregate, IncidentEvidence } from "../../../types.ts";
import type { IncidentDomainEvent } from "../../incident-runtime.ts";
import {
  buildGroundedIncidentAnswer,
  buildGroundedKnowledgeAnswer,
  buildGeneralVoiceKnowledgeAnswer,
  buildGroundedPostmortem
} from "../../grounded-response.ts";

function aggregate(overrides: Partial<IncidentAggregate> = {}): IncidentAggregate {
  return {
    incidentId: "INC-GROUND",
    title: "Customer portal degradation",
    severity: "P1 - Critical",
    lifecycleState: "INVESTIGATING",
    operatingMode: "SIMULATION",
    workflows: [],
    crossSiloWorkflows: [],
    approvals: [],
    changeRecords: [],
    evidence: [],
    updatedAt: "2026-09-05T08:30:00.000Z",
    ...overrides
  };
}

function evidence(overrides: Partial<IncidentEvidence> = {}): IncidentEvidence {
  return {
    id: "evidence-cpu-1",
    incidentId: "INC-GROUND",
    source: "Datadog",
    summary: "CPU utilization is elevated on the customer portal node.",
    observedAt: "2026-09-05T08:25:00.000Z",
    integrityHash: "1f4c9a8c1f4c9a8c1f4c9a8c1f4c9a8c1f4c9a8c1f4c9a8c1f4c9a8c1f4c9a8c",
    ...overrides
  };
}

function event(type: string, payload: Record<string, unknown> = {}, id = `event-${type}`): IncidentDomainEvent {
  return {
    id,
    incidentId: "INC-GROUND",
    type,
    occurredAt: "2026-09-05T08:28:00.000Z",
    actorId: "agent-sre",
    correlationId: "correlation-1",
    payload
  };
}

test("incident answer abstains when causal evidence is absent", () => {
  const answer = buildGroundedIncidentAnswer("What caused the outage?", aggregate());
  assert.equal(answer.groundingStatus, "ABSTAINED");
  assert.equal(answer.actionBlocked, false);
  assert.match(answer.text, /unconfirmed/i);
  assert.equal(answer.citations.length, 0);
});

test("numeric questions never invent a missing measurement", () => {
  const answer = buildGroundedIncidentAnswer(
    "What is the exact CPU percentage?",
    aggregate({ evidence: [evidence()] })
  );
  assert.equal(answer.groundingStatus, "PARTIAL");
  assert.match(answer.text, /CPU utilization is elevated/);
  assert.doesNotMatch(answer.text, /\d+\s*%/);
  assert.match(answer.limitations.join(" "), /no persisted numeric value/i);
});

test("action intent is blocked and names the exact approval and execution APIs", () => {
  const incident = aggregate({
    workflows: [{
      id: "wf-remediation-7",
      incidentId: "INC-GROUND",
      name: "Bounded Production Remediation",
      agentId: "agent-sre",
      status: "ACTIVE",
      startedAt: "2026-09-05T08:20:00.000Z",
      steps: []
    }],
    approvals: [{
      id: "approval-exact-7",
      incidentId: "INC-GROUND",
      workflowId: "wf-remediation-7",
      agentId: "agent-sre",
      agentName: "Incident Orchestrator",
      action: "Execute RESTART_SINGLE_POD on prod/pod-7",
      system: "Kubernetes",
      description: "Exact gate",
      payload: {
        approvalKind: "REMEDIATION_EXECUTION",
        recommendationId: "recommendation-7",
        actionDigest: "digest-7"
      },
      status: "PENDING",
      requestedAt: "2026-09-05T08:20:00.000Z"
    }]
  });
  const answer = buildGroundedIncidentAnswer("Please restart the pod now", incident);
  assert.equal(answer.actionBlocked, true);
  assert.match(answer.text, /POST \/api\/approve-action/);
  assert.match(answer.text, /POST \/api\/agent-runtime\/recommendations\/recommendation-7\/execute-safe/);
  assert.match(answer.text, /wf-remediation-7/);
  assert.match(answer.text, /approval-exact-7/);
  assert.match(answer.text, /Approval alone does not record execution/);
});

test("evidence answers preserve evidence ID, provenance time, source, and integrity hash", () => {
  const item = evidence({ summary: "Packet loss measured at 4.2 percent on router edge-7." });
  const answer = buildGroundedIncidentAnswer("What packet loss was measured?", aggregate({ evidence: [item] }));
  assert.equal(answer.groundingStatus, "GROUNDED");
  assert.equal(answer.citations.length, 1);
  assert.deepEqual(answer.citations[0], {
    kind: "EVIDENCE",
    evidenceId: item.id,
    source: item.source,
    observedAt: item.observedAt,
    integrityHash: item.integrityHash
  });
  assert.match(answer.text, /4\.2 percent/);
});

test("a recommendation is not reported as an executed action", () => {
  const recommendation = event("RecommendationCreated", {
    recommendationId: "rec-1",
    target: "do-not-report-as-executed"
  });
  const answer = buildGroundedIncidentAnswer("What actions were executed?", aggregate(), [recommendation]);
  assert.equal(answer.groundingStatus, "PARTIAL");
  assert.match(answer.text, /recommendation is not execution/i);
  assert.doesNotMatch(answer.text, /do-not-report-as-executed/);

  const executed = event("SafeActionExecuted", {
    recommendationId: "rec-1",
    approvalId: "approval-1",
    result: { status: "VERIFIED", logs: ["RAW_PROVIDER_SECRET_SHOULD_NOT_APPEAR"] }
  }, "event-executed-1");
  const executedAnswer = buildGroundedIncidentAnswer("What actions were executed?", aggregate(), [recommendation, executed]);
  assert.equal(executedAnswer.groundingStatus, "GROUNDED");
  assert.match(executedAnswer.text, /SafeActionExecuted/);
  assert.match(executedAnswer.text, /result=VERIFIED/);
  assert.doesNotMatch(executedAnswer.text, /RAW_PROVIDER_SECRET/);
  assert.equal(executedAnswer.citations.some(citation => citation.kind === "EVENT" && citation.eventId === "event-executed-1"), true);
});

test("unmarked causal language remains an unconfirmed root-cause hypothesis", () => {
  const answer = buildGroundedIncidentAnswer(
    "What caused the outage?",
    aggregate({ evidence: [evidence({ summary: "Router failure may have caused the outage." })] })
  );
  assert.equal(answer.groundingStatus, "PARTIAL");
  assert.match(answer.text, /^Root cause is unconfirmed/);
  assert.doesNotMatch(answer.text, /^Confirmed root cause/);
});

test("postmortem output is an auditable ITSM RCA and excludes raw logs and recommendations", () => {
  const incident = aggregate({ evidence: [evidence()] });
  const recommended = event("RecommendationCreated", { recommendationId: "rec-only", logs: ["RAW_RECOMMENDATION_LOG"] });
  const executed = event("SafeActionExecuted", {
    recommendationId: "rec-executed",
    result: { status: "VERIFIED", logs: ["RAW_EXECUTOR_LOG"] }
  }, "event-executed");
  const first = buildGroundedPostmortem(incident, [recommended, executed]);
  const second = buildGroundedPostmortem(incident, [executed, recommended]);
  assert.equal(first.markdown, second.markdown);
  for (const heading of ["## 1. Issue summary", "## 5. Root cause", "## 7. Five whys", "## 8. Temporary fix or containment", "## 9. Permanent corrective action", "## 12. Actions actually recorded", "## 14. Known unknowns and evidence gaps"]) {
    assert.match(first.markdown, new RegExp(heading));
  }
  assert.match(first.markdown, /SafeActionExecuted/);
  assert.doesNotMatch(first.markdown, /RecommendationCreated|RAW_EXECUTOR_LOG|RAW_RECOMMENDATION_LOG|rec-only/);
  assert.match(first.markdown, /UNCONFIRMED/);
});

test("voice knowledge answers the reported ASA question including transcription noise", () => {
  for (const question of ["Do you know about Cisco ASA firewall?", "Pics. Do you know about Cisco ASA firewall?", "Apex, are you familiar with Cisco ASA?"]) {
    const answer = buildGeneralVoiceKnowledgeAnswer(question);
    assert.equal(answer?.groundingStatus, "GROUNDED");
    assert.match(answer!.text, /Adaptive Security Appliance/);
    assert.equal(answer?.actionBlocked, false);
  }
});

test("simple phishing questions use the phishing basics article", () => {
  const answer = buildGeneralVoiceKnowledgeAnswer("What is a phishing attack?");
  assert.equal(answer?.groundingStatus, "GROUNDED");
  assert.equal(answer?.citations.some(citation => citation.kind === "KNOWLEDGE" && citation.kbId === "kb-phishing-basics"), true);
  assert.match(answer!.text, /social-engineering attack/i);
  assert.doesNotMatch(answer!.text, /Dark Web|infostealer|Raccoon|Command & Control/i);
});

test("voice knowledge does not bypass incident evidence or execution controls", () => {
  for (const question of ["What is our Cisco ASA status?", "Tell me about this Cisco ASA outage", "Do you know about Cisco ASA? Restart our firewall", "Explain the flux capacitor calibration lattice"]) {
    assert.equal(buildGeneralVoiceKnowledgeAnswer(question), undefined);
  }
});

test("knowledge answer abstains when no direct KB title or keyword matches", () => {
  const answer = buildGroundedKnowledgeAnswer("Explain the flux capacitor calibration lattice");
  assert.equal(answer.groundingStatus, "ABSTAINED");
  assert.equal(answer.citations.length, 0);
  assert.match(answer.text, /no direct title or keyword match/i);
});

test("knowledge answer responds naturally to a voice greeting", () => {
  const answer = buildGroundedKnowledgeAnswer("Apex, how are you doing today?");
  assert.equal(answer.groundingStatus, "PARTIAL");
  assert.match(answer.text, /doing well and ready to help/i);
  assert.doesNotMatch(answer.text, /cannot answer|knowledge base/i);
});

test("knowledge answer cites the directly matched KB article", () => {
  const answer = buildGroundedKnowledgeAnswer("How does enterprise DNS troubleshooting work?");
  assert.equal(answer.groundingStatus, "GROUNDED");
  assert.equal(answer.citations.some(citation => citation.kind === "KNOWLEDGE" && citation.kbId === "kb-dns"), true);
  assert.match(answer.text, /Enterprise DNS Resolution Troubleshooting Procedure/);
});

test("generic URL connectivity questions do not match malicious URL guidance", () => {
  const answer = buildGeneralVoiceKnowledgeAnswer("Users cannot connect to a specific URL. What preliminary checks should I do?");
  assert.equal(answer, undefined);
});

test("wireless questions rank the specific 9800 client-drop procedure above generic Catalyst switching", () => {
  const answer = buildGeneralVoiceKnowledgeAnswer("What are the common causes and troubleshooting steps for corporate wireless client drops on Catalyst 9800 controller?");
  assert.equal(answer?.groundingStatus, "GROUNDED");
  assert.match(answer!.text, /Catalyst 9800 WLC/);
  assert.match(answer!.text, /802\.1X EAP timeouts/);
  assert.doesNotMatch(answer!.text, /StackWise Virtual|TCAM utilization/);
});
