import type { IncidentEvidence } from "../../types.ts";

export type QuantumInspiredFeature = "EVIDENCE_INTERFERENCE" | "HYPOTHESIS_SEARCH" | "COUNTERFACTUAL_SIMULATION" | "ANNEALING_ASSIGNMENT" | "CHANGE_COLLISION" | "QUBO_PLANNER" | "TENSOR_COMPRESSION";
export type FeatureRolloutState = "OFF" | "REPLAY" | "SHADOW" | "ASSISTED" | "ELIGIBLE";

export interface WeightedEvidence {
  evidenceId: string;
  relation: "SUPPORTS" | "CONTRADICTS";
  rawWeight: number;
  reliability: number;
  freshness: number;
  independence: number;
  duplicatePenalty: number;
  signedContribution: number;
  amplitude: { real: number; imaginary: number; magnitude: number; phaseRadians: number };
  explanation: string;
}

export interface EvidenceInterferenceResult {
  score: number;
  baselineScore: number;
  support: number;
  contradiction: number;
  provenanceCoverage: number;
  contributions: WeightedEvidence[];
  evidence: IncidentEvidence[];
  coherentAmplitude: { real: number; imaginary: number; intensity: number };
}

export interface TensorCompressionResult {
  method: "TT_SVD_TWO_SITE_MPS";
  source: "INCIDENT_KNOWLEDGE_BASE";
  rows: number;
  columns: number;
  retainedRank: number;
  originalParameters: number;
  compressedParameters: number;
  compressionRatio: number;
  relativeFrobeniusError: number;
  maximumRelativeError: number;
  accuracyGatePassed: boolean;
  articleIds: string[];
}

export interface OptimizationRun<T = unknown> {
  id: string;
  feature: QuantumInspiredFeature;
  algorithm: string;
  algorithmVersion: string;
  rolloutState: FeatureRolloutState;
  incidentId: string;
  seed: number;
  parameters: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "DISABLED";
  usedFallback: boolean;
  fallbackReason?: string;
  output?: T;
}

export interface QuantumFeatureConfig {
  feature: QuantumInspiredFeature;
  rolloutState: FeatureRolloutState;
  timeoutMs: number;
  maxCandidates: number;
  maxIterations: number;
  algorithmVersion: string;
}

export interface IncidentHypothesis {
  id: string;
  incidentId: string;
  title: string;
  department: string;
  score: number;
  priorScore: number;
  evidenceIds: string[];
  runbookIds: string[];
  diagnosticPath: string[];
  status: "ACTIVE" | "PRUNED" | "SELECTED";
  explanation: string;
}

export interface HypothesisSearchResult {
  selected: IncidentHypothesis | null;
  ranked: IncidentHypothesis[];
  pruned: IncidentHypothesis[];
  beamWidth: number;
  exploredCandidates: number;
  completedDepth: number;
  diversityDepartments: number;
}

export type CounterfactualAction = "NO_ACTION" | "BGP_PATH_PREPEND" | "RESTART_SINGLE_POD";

export interface CounterfactualOutcome {
  action: CounterfactualAction;
  recoveryProbability: number;
  expectedMttrMinutes: number;
  sloImpactMinutes: number;
  secondaryFailureProbability: number;
  rollbackProbability: number;
  utilityScore: number;
  rollbackPlan?: Record<string, unknown>;
  verificationChecks: string[];
  explanation: string;
}

export interface CounterfactualSimulationResult {
  modelVersion: string;
  recommendationId: string;
  recommendedAction: CounterfactualAction;
  baseline: CounterfactualOutcome;
  outcomes: CounterfactualOutcome[];
  evaluatedCandidates: number;
}

export interface ResponderCandidate {
  id: string;
  name: string;
  skills: string[];
  available: boolean;
  workload: number;
  responseMinutes: number;
  eligibleRoles: string[];
}

export interface ResponderAssignment {
  incidentId: string;
  assignments: { role: string; responderId: string; responderName: string }[];
  objectiveScore: number;
  baselineScore: number;
  improvedOverBaseline: boolean;
  hardConstraintViolations: string[];
  iterations: number;
  tunnelingTransitions: number;
}

export interface ChangeCollisionPlan {
  incidentId: string;
  recommendationId: string;
  conflicts: { changeId: string; reason: string; severity: "BLOCKING" | "WARNING" }[];
  sequence: string[];
  safeToProceed: boolean;
  baselineRisk: number;
  optimizedRisk: number;
  improvedOverBaseline: boolean;
}

export interface QuboModel {
  variables: string[];
  linear: number[];
  quadratic: { left: number; right: number; coefficient: number }[];
  constant: number;
}

export interface QuboSolution {
  bits: number[];
  energy: number;
  solver: "EXACT" | "SIMULATED_ANNEALING";
  evaluatedStates: number;
}

export interface RemediationPortfolioResult {
  incidentId: string;
  recommendationId: string;
  selectedActions: CounterfactualAction[];
  energy: number;
  rescoredEnergy: number;
  solver: QuboSolution["solver"];
  baselineEnergy: number;
  improvedOverBaseline: boolean;
  constraintViolations: string[];
  evaluatedStates: number;
}
