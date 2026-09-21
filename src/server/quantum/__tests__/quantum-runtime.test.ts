import assert from "node:assert/strict";
import test from "node:test";
import type { IncidentEvidence } from "../../../types.ts";
import { scoreEvidenceInterference, validEvidenceInterference } from "../evidence-interference.ts";
import { SeededRandom, seedFrom } from "../random.ts";
import { QuantumInspiredRuntime } from "../runtime.ts";
import type { QuantumFeatureConfig } from "../contracts.ts";
import type { StructuredAgentFinding } from "../../agent-runtime.ts";
import { searchHypotheses, validHypothesisSearch } from "../hypothesis-search.ts";
import { simulateCounterfactuals, validCounterfactualSimulation } from "../counterfactual-simulator.ts";
import type { RemediationRecommendation } from "../../agent-runtime.ts";
import { assignResponders, validResponderAssignment } from "../responder-assignment.ts";
import { planChangeCollisions, validChangeCollisionPlan } from "../change-collision.ts";
import type { ResponderCandidate } from "../contracts.ts";
import { quboEnergy, solveQubo } from "../qubo.ts";
import { planRemediationPortfolio, validRemediationPortfolio } from "../remediation-portfolio.ts";
import { compressKnowledgeTensor, validTensorCompression } from "../tensor-compression.ts";
import { KNOWLEDGE_BASE } from "../../../data/kb.ts";

const evidence: IncidentEvidence[] = [
  {
    id: "ev-1",
    incidentId: "INC-1",
    source: "Prometheus telemetry",
    summary: "Packet loss increased after the BGP route change",
    confidenceScore: 96,
    observedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "ev-2",
    incidentId: "INC-1",
    source: "Cloud monitoring",
    summary: "Database is healthy and operational",
    confidenceScore: 92,
    observedAt: "2026-01-01T00:00:00.000Z"
  }
];

test("seeded random output is deterministic", () => {
  const seed = seedFrom("INC-1:agent-nre:1.0.0");
  const first = new SeededRandom(seed);
  const second = new SeededRandom(seed);
  assert.deepEqual([first.next(), first.next(), first.next()], [second.next(), second.next(), second.next()]);
});

test("evidence interference is deterministic, bounded, and explainable", () => {
  const first = scoreEvidenceInterference(evidence, 0.75, Date.parse("2026-01-01T00:05:00.000Z"));
  const second = scoreEvidenceInterference(evidence, 0.75, Date.parse("2026-01-01T00:05:00.000Z"));
  assert.deepEqual(first, second);
  assert.equal(validEvidenceInterference(first), true);
  assert.equal(first.contributions.length, 2);
  assert.equal(first.contributions.some(item => item.relation === "SUPPORTS"), true);
  assert.equal(first.contributions.some(item => item.relation === "CONTRADICTS"), true);
  assert.equal(first.provenanceCoverage, 1);
  assert.ok(first.contributions.every(item => Number.isFinite(item.amplitude.real) && Number.isFinite(item.amplitude.imaginary)));
  assert.ok(Number.isFinite(first.coherentAmplitude.intensity));
});

test("two-site TT-SVD compresses incident knowledge within its accuracy gate", () => {
  const result = compressKnowledgeTensor(KNOWLEDGE_BASE.slice(0, 5), 0.25);
  assert.equal(validTensorCompression(result), true);
  assert.equal(result.method, "TT_SVD_TWO_SITE_MPS");
  assert.equal(result.accuracyGatePassed, true);
  assert.ok(result.compressedParameters < result.originalParameters);
});

test("duplicate evidence is dampened", () => {
  const duplicated = scoreEvidenceInterference([evidence[0], { ...evidence[0], id: "ev-copy" }], 0.75, Date.parse("2026-01-01T00:05:00.000Z"));
  assert.ok(duplicated.contributions.every(item => item.duplicatePenalty < 1));
});

const config: QuantumFeatureConfig = {
  feature: "EVIDENCE_INTERFERENCE",
  rolloutState: "SHADOW",
  timeoutMs: 10,
  maxCandidates: 100,
  maxIterations: 10,
  algorithmVersion: "test"
};

test("runtime falls back on timeout", async () => {
  const runtime = new QuantumInspiredRuntime();
  const result = await runtime.run({
    incidentId: "INC-1",
    seed: 1,
    config,
    algorithm: "timeout-test",
    parameters: {},
    operation: () => new Promise<number>(resolve => setTimeout(() => resolve(1), 30)),
    validate: Number.isFinite,
    fallback: () => 0.5
  });
  assert.equal(result.value, 0.5);
  assert.equal(result.run.status, "TIMED_OUT");
  assert.equal(result.run.usedFallback, true);
});

test("runtime falls back on invalid output", async () => {
  const runtime = new QuantumInspiredRuntime();
  const result = await runtime.run({
    incidentId: "INC-1",
    seed: 1,
    config,
    algorithm: "validation-test",
    parameters: {},
    operation: () => Number.NaN,
    validate: Number.isFinite,
    fallback: () => 0.4
  });
  assert.equal(result.value, 0.4);
  assert.equal(result.run.status, "FAILED");
  assert.equal(result.run.fallbackReason, "INVALID_OPTIMIZATION_OUTPUT");
});

function finding(id: string, department: StructuredAgentFinding["department"], confidence: number, evidenceCount = 1): StructuredAgentFinding {
  return {
    id,
    incidentId: "INC-1",
    agentId: `agent-${department.toLowerCase()}`,
    department,
    claim: `${department} root-cause candidate`,
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      id: `${id}-ev-${index}`,
      incidentId: "INC-1",
      source: `${department} telemetry`,
      summary: `${department} anomaly ${index}`,
      observedAt: "2026-01-01T00:00:00.000Z"
    })),
    runbooks: [{ runbookId: `${id}-runbook`, title: `${department} Runbook`, excerpt: "Validate telemetry", relevanceScore: 0.8 }],
    confidence,
    freshness: "LIVE",
    limitations: [],
    producedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("hypothesis beam search is deterministic and bounded", () => {
  const findings = [finding("net", "Network", 0.91, 3), finding("db", "Database", 0.84, 2), finding("linux", "Linux", 0.72), finding("cloud", "CloudOps", 0.61)];
  const options = { incidentId: "INC-1", beamWidth: 3, maxDepth: 2, maxCandidates: 20, pruneThreshold: 0.2, seed: 42 };
  const first = searchHypotheses(findings, options);
  const second = searchHypotheses(findings, options);
  assert.deepEqual(first, second);
  assert.equal(validHypothesisSearch(first), true);
  assert.ok(first.ranked.length <= options.beamWidth);
  assert.ok(first.exploredCandidates <= options.maxCandidates);
  assert.equal(first.selected?.department, "Network");
});

test("hypothesis search prunes weak candidates and retains domain diversity", () => {
  const findings = [finding("net", "Network", 0.95, 3), finding("db", "Database", 0.82, 2), finding("weak", "Windows", 0.01, 0)];
  const result = searchHypotheses(findings, { incidentId: "INC-1", beamWidth: 2, maxDepth: 1, maxCandidates: 10, pruneThreshold: 0.5, seed: 7 });
  assert.equal(result.pruned.some(item => item.department === "Windows"), true);
  assert.equal(result.diversityDepartments, 2);
});

test("counterfactual simulation is deterministic and includes one baseline", () => {
  const hypotheses = searchHypotheses([finding("net", "Network", 0.94, 3), finding("db", "Database", 0.72)], {
    incidentId: "INC-1", beamWidth: 2, maxDepth: 1, maxCandidates: 10, pruneThreshold: 0.2, seed: 9
  });
  const recommendation: RemediationRecommendation = {
    id: "rec-1",
    incidentId: "INC-1",
    workflowId: "wf-remediation-INC-1-rec-1",
    actionDigest: "quantum-fixture-rec-1",
    actionType: "BGP_PATH_PREPEND",
    summary: "Shift degraded traffic",
    target: "spine-1:peer-a",
    parameters: { prependCount: 3 },
    rollback: { prependCount: 0 },
    verification: ["packet loss below 0.5%"],
    evidenceIds: ["net-ev-0"],
    runbookIds: ["net-runbook"],
    confidence: 0.9,
    blastRadius: "SINGLE_RESOURCE",
    reversibility: "AUTOMATIC",
    autonomyLevel: "DRY_RUN",
    shadowMode: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const args = { recommendation, hypotheses, seed: 77, maxCandidates: 3 };
  const first = simulateCounterfactuals(args);
  const second = simulateCounterfactuals(args);
  assert.deepEqual(first, second);
  assert.equal(validCounterfactualSimulation(first), true);
  assert.equal(first.outcomes.filter(item => item.action === "NO_ACTION").length, 1);
  assert.ok(first.outcomes.filter(item => item.action !== "NO_ACTION").every(item => item.rollbackPlan && item.verificationChecks.length));
});

test("counterfactual candidate budget remains bounded", () => {
  const hypotheses = searchHypotheses([finding("net", "Network", 0.9)], {
    incidentId: "INC-1", beamWidth: 1, maxDepth: 0, maxCandidates: 2, pruneThreshold: 0, seed: 1
  });
  const recommendation: RemediationRecommendation = {
    id: "rec-2", incidentId: "INC-1", workflowId: "wf-remediation-INC-1-rec-2", actionDigest: "quantum-fixture-rec-2", actionType: "RESTART_SINGLE_POD", summary: "Restart", target: "pod-1",
    parameters: {}, rollback: { restorePreviousReplica: true }, verification: ["ready"], evidenceIds: [], runbookIds: [],
    confidence: 0.7, blastRadius: "SINGLE_RESOURCE", reversibility: "AUTOMATIC", autonomyLevel: "DRY_RUN", shadowMode: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const result = simulateCounterfactuals({ recommendation, hypotheses, seed: 1, maxCandidates: 2 });
  assert.ok(result.evaluatedCandidates <= 2);
  assert.equal(result.baseline.action, "NO_ACTION");
});

test("annealing responder assignment is deterministic, valid, and no worse than baseline", () => {
  const candidates: ResponderCandidate[] = [
    { id: "admin", name: "Admin", skills: ["coordination"], available: true, workload: 0.4, responseMinutes: 4, eligibleRoles: ["INCIDENT_COMMANDER", "TECHNICAL_LEAD", "COMMUNICATIONS_LEAD"] },
    { id: "nre", name: "NRE", skills: ["network"], available: true, workload: 0.2, responseMinutes: 2, eligibleRoles: ["INCIDENT_COMMANDER", "TECHNICAL_LEAD"] },
    { id: "devops", name: "DevOps", skills: ["platform"], available: true, workload: 0.1, responseMinutes: 3, eligibleRoles: ["TECHNICAL_LEAD", "COMMUNICATIONS_LEAD"] },
    { id: "away", name: "Away", skills: ["comms"], available: false, workload: 0, responseMinutes: 1, eligibleRoles: ["COMMUNICATIONS_LEAD"] }
  ];
  const first = assignResponders("INC-1", candidates, 123, 100);
  const second = assignResponders("INC-1", candidates, 123, 100);
  assert.deepEqual(first, second);
  assert.equal(validResponderAssignment(first), true);
  assert.ok(first.objectiveScore <= first.baselineScore);
  assert.equal(new Set(first.assignments.map(item => item.responderId)).size, 3);
});

test("change collision plan detects overlap and never increases risk", () => {
  const recommendation: RemediationRecommendation = {
    id: "rec-change", incidentId: "INC-1", workflowId: "wf-remediation-INC-1-rec-change", actionDigest: "quantum-fixture-rec-change", actionType: "BGP_PATH_PREPEND", summary: "Shift BGP traffic from ISP Alpha", target: "spine-switch-02 ISP-Alpha",
    parameters: { peer: "ISP-Alpha" }, rollback: { prependCount: 0 }, verification: ["BGP established"], evidenceIds: [], runbookIds: [], confidence: 0.9,
    blastRadius: "SINGLE_RESOURCE", reversibility: "AUTOMATIC", autonomyLevel: "DRY_RUN", shadowMode: true, createdAt: "2026-01-01T00:00:00.000Z"
  };
  const plan = planChangeCollisions("INC-1", recommendation, [{
    id: "CR-1", incidentId: "INC-2", title: "BGP maintenance on spine-switch-02", status: "APPROVED", context: "Modify ISP-Alpha peer",
    openedAt: "2026-01-01T00:00:00.000Z", openedBy: "operator", steps: [{ id: "s1", description: "Update BGP peer", status: "PENDING" }]
  }]);
  assert.equal(validChangeCollisionPlan(plan), true);
  assert.equal(plan.safeToProceed, false);
  assert.equal(plan.conflicts[0].severity, "BLOCKING");
  assert.ok(plan.optimizedRisk <= plan.baselineRisk);
});

test("QUBO exact solver reports independently reproducible minimum energy", () => {
  const model = { variables: ["a", "b"], linear: [-0.8, -0.6], quadratic: [{ left: 0, right: 1, coefficient: 2 }], constant: 0 };
  const solution = solveQubo(model, 1, 10);
  assert.equal(solution.solver, "EXACT");
  assert.equal(solution.energy, quboEnergy(model, solution.bits));
  assert.deepEqual(solution.bits, [1, 0]);
  assert.equal(solution.evaluatedStates, 4);
});

test("QUBO remediation portfolio is deterministic and constraint safe", () => {
  const recommendation: RemediationRecommendation = {
    id: "rec-qubo", incidentId: "INC-1", workflowId: "wf-remediation-INC-1-rec-qubo", actionDigest: "quantum-fixture-rec-qubo", actionType: "BGP_PATH_PREPEND", summary: "Shift traffic", target: "peer-a",
    parameters: {}, rollback: { prependCount: 0 }, verification: ["BGP established"], evidenceIds: [], runbookIds: [], confidence: 0.9,
    blastRadius: "SINGLE_RESOURCE", reversibility: "AUTOMATIC", autonomyLevel: "DRY_RUN", shadowMode: true, createdAt: "2026-01-01T00:00:00.000Z"
  };
  const outcomes = [
    { action: "NO_ACTION" as const, recoveryProbability: 0.1, expectedMttrMinutes: 100, sloImpactMinutes: 100, secondaryFailureProbability: 0.3, rollbackProbability: 0, utilityScore: 0.01, verificationChecks: ["observe"], explanation: "baseline" },
    { action: "BGP_PATH_PREPEND" as const, recoveryProbability: 0.9, expectedMttrMinutes: 10, sloImpactMinutes: 11, secondaryFailureProbability: 0.05, rollbackProbability: 0.02, utilityScore: 0.82, rollbackPlan: { prependCount: 0 }, verificationChecks: ["BGP"], explanation: "primary" },
    { action: "RESTART_SINGLE_POD" as const, recoveryProbability: 0.5, expectedMttrMinutes: 8, sloImpactMinutes: 9, secondaryFailureProbability: 0.03, rollbackProbability: 0.02, utilityScore: 0.45, rollbackPlan: { restore: true }, verificationChecks: ["ready"], explanation: "alternative" }
  ];
  const args = { recommendation, outcomes, seed: 44, maxIterations: 100 };
  const first = planRemediationPortfolio(args);
  const second = planRemediationPortfolio(args);
  assert.deepEqual(first, second);
  assert.equal(validRemediationPortfolio(first), true);
  assert.deepEqual(first.selectedActions, ["BGP_PATH_PREPEND"]);
  assert.equal(first.constraintViolations.length, 0);
  assert.ok(first.energy <= first.baselineEnergy + 1e-9);
});
