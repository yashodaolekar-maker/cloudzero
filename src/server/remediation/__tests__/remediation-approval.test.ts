import assert from "node:assert/strict";
import test from "node:test";
import type { HITLApproval } from "../../../types.ts";
import type { RemediationRecommendation } from "../../agent-runtime.ts";
import {
  buildRemediationApprovalPayload,
  canonicalJson,
  computeRemediationActionDigest,
  remediationApprovalAction,
  validateRemediationApproval
} from "../../remediation-approval.ts";

function recommendation(parameterOrder: "normal" | "reversed" = "normal"): RemediationRecommendation {
  const parameters = parameterOrder === "normal"
    ? { peer: "ISP-Alpha", prependCount: 3, constraints: { maxLatencyMs: 80, preserveSession: true } }
    : { constraints: { preserveSession: true, maxLatencyMs: 80 }, prependCount: 3, peer: "ISP-Alpha" };
  const draft = {
    id: "rec-exact-1",
    incidentId: "INC-2026-1001",
    workflowId: "wf-remediation-INC-2026-1001-rec-exact-1",
    actionType: "BGP_PATH_PREPEND" as const,
    summary: "Bounded peer path change",
    target: "spine-switch-02:peer-ISP-Alpha",
    parameters,
    rollback: { peer: "ISP-Alpha", prependCount: 0 },
    verification: ["BGP session remains established", "packet loss below 0.5%"],
    evidenceIds: ["evidence-1"],
    runbookIds: ["runbook-1"],
    confidence: 0.94,
    blastRadius: "SINGLE_RESOURCE" as const,
    reversibility: "AUTOMATIC" as const,
    autonomyLevel: "APPROVE" as const,
    shadowMode: false,
    createdAt: "2026-09-04T10:00:00.000Z"
  };
  return { ...draft, actionDigest: computeRemediationActionDigest(draft) };
}

function approval(rec = recommendation()): HITLApproval {
  return {
    id: "approval-exact-1",
    incidentId: rec.incidentId,
    workflowId: rec.workflowId,
    agentId: "agent-sre",
    agentName: "Incident Orchestrator",
    action: remediationApprovalAction(rec),
    system: "AristaSwitches",
    description: "Approve one exact remediation",
    payload: buildRemediationApprovalPayload(rec, "2026-09-04T11:00:00.000Z"),
    status: "APPROVED",
    requestedAt: "2026-09-04T10:00:00.000Z",
    reviewedBy: "NRE",
    reviewedAt: "2026-09-04T10:01:00.000Z"
  };
}

function validate(rec: RemediationRecommendation, gate: HITLApproval, approvalId = gate.id) {
  return validateRemediationApproval({
    approvalId,
    approval: gate,
    recommendation: rec,
    now: new Date("2026-09-04T10:30:00.000Z")
  });
}

test("canonical action digest is deterministic across object key order", () => {
  const normal = recommendation("normal");
  const reversed = recommendation("reversed");
  assert.equal(normal.actionDigest, reversed.actionDigest);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
});

test("parameter tampering is rejected", () => {
  const rec = recommendation();
  const gate = approval(rec);
  const tampered = { ...rec, parameters: { ...rec.parameters, prependCount: 8 } };
  const result = validate(tampered, gate);
  assert.equal(result.valid, false);
  assert.equal(result.code, "APPROVAL_PARAMETERS_MISMATCH");
});

test("rollback or verification tampering invalidates the immutable recommendation digest", () => {
  const rec = recommendation();
  const gate = approval(rec);
  const tampered = { ...rec, rollback: { peer: "ISP-Alpha", prependCount: 2 } };
  const result = validate(tampered, gate);
  assert.equal(result.valid, false);
  assert.equal(result.code, "RECOMMENDATION_DIGEST_MISMATCH");
});

test("wrong explicit approval ID is rejected", () => {
  const rec = recommendation();
  const result = validate(rec, approval(rec), "another-approval");
  assert.equal(result.valid, false);
  assert.equal(result.code, "APPROVAL_ID_MISMATCH");
});

test("wrong incident, workflow, recommendation, action, or target is rejected", async t => {
  const rec = recommendation();
  const base = approval(rec);
  const cases: Array<[string, HITLApproval, string]> = [
    ["incident", { ...base, incidentId: "INC-OTHER" }, "APPROVAL_INCIDENT_MISMATCH"],
    ["workflow", { ...base, workflowId: "wf-other" }, "APPROVAL_WORKFLOW_MISMATCH"],
    ["recommendation", { ...base, payload: { ...base.payload, recommendationId: "rec-other" } }, "APPROVAL_RECOMMENDATION_MISMATCH"],
    ["action", { ...base, payload: { ...base.payload, actionType: "RESTART_SINGLE_POD" } }, "APPROVAL_ACTION_MISMATCH"],
    ["target", { ...base, payload: { ...base.payload, target: "router-other" } }, "APPROVAL_TARGET_MISMATCH"]
  ];
  for (const [name, gate, expected] of cases) {
    await t.test(name, () => {
      const result = validate(rec, gate);
      assert.equal(result.valid, false);
      assert.equal(result.code, expected);
    });
  }
});

test("expired remediation approval is rejected", () => {
  const rec = recommendation();
  const base = approval(rec);
  const gate = { ...base, payload: { ...base.payload, expiresAt: "2026-09-04T10:29:59.000Z" } };
  const result = validate(rec, gate);
  assert.equal(result.valid, false);
  assert.equal(result.code, "APPROVAL_EXPIRED");
});

test("an unrelated approved Teams voice gate cannot authorize remediation", () => {
  const rec = recommendation();
  const gate: HITLApproval = {
    ...approval(rec),
    action: "Publish localized voice update to bridge",
    system: "Teams",
    payload: { incidentId: rec.incidentId, workflowId: rec.workflowId, locale: "es-MX" }
  };
  const result = validate(rec, gate);
  assert.equal(result.valid, false);
  assert.equal(result.code, "APPROVAL_UNRELATED");
});

test("a valid exact, approved, unexpired binding passes", () => {
  const rec = recommendation();
  const result = validate(rec, approval(rec));
  assert.equal(result.valid, true);
  assert.equal(result.recomputedActionDigest, rec.actionDigest);
});
