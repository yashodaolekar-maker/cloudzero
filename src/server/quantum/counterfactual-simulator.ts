import type { RemediationRecommendation } from "../agent-runtime.ts";
import type { CounterfactualAction, CounterfactualOutcome, CounterfactualSimulationResult, HypothesisSearchResult } from "./contracts.ts";
import { ACTION_TRANSITIONS, INCIDENT_TRANSITION_MODEL_VERSION } from "./models/incident-transition-v1.ts";
import { SeededRandom } from "./random.ts";

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function simulateCounterfactuals(args: {
  recommendation: RemediationRecommendation;
  hypotheses: HypothesisSearchResult;
  seed: number;
  maxCandidates: number;
}): CounterfactualSimulationResult {
  const random = new SeededRandom(args.seed);
  const hypothesisConfidence = args.hypotheses.selected?.score ?? args.recommendation.confidence;
  const candidates = Array.from(new Set<CounterfactualAction>([
    "NO_ACTION",
    args.recommendation.actionType,
    args.recommendation.actionType === "BGP_PATH_PREPEND" ? "RESTART_SINGLE_POD" : "BGP_PATH_PREPEND"
  ])).slice(0, Math.max(1, args.maxCandidates));
  if (!candidates.includes("NO_ACTION")) candidates.unshift("NO_ACTION");

  const outcomes: CounterfactualOutcome[] = candidates.map(action => {
    const model = ACTION_TRANSITIONS[action];
    const actionMatchesRecommendation = action === args.recommendation.actionType;
    const relevance = action === "NO_ACTION" ? 0 : actionMatchesRecommendation ? hypothesisConfidence : 1 - hypothesisConfidence;
    const jitter = (random.next() - 0.5) * 0.000001;
    const recoveryProbability = clamp(model.baseRecovery * (0.55 + relevance * 0.45) + jitter);
    const expectedMttrMinutes = Math.max(1, model.baseMttrMinutes * (1.25 - relevance * 0.35));
    const sloImpactMinutes = action === "NO_ACTION" ? expectedMttrMinutes : expectedMttrMinutes * (1 + model.secondaryFailureRisk);
    const utilityScore = clamp(recoveryProbability - model.secondaryFailureRisk * 0.35 - model.rollbackRisk * 0.2 - Math.min(1, sloImpactMinutes / 180) * 0.25);
    return {
      action,
      recoveryProbability,
      expectedMttrMinutes: Number(expectedMttrMinutes.toFixed(2)),
      sloImpactMinutes: Number(sloImpactMinutes.toFixed(2)),
      secondaryFailureProbability: model.secondaryFailureRisk,
      rollbackProbability: model.rollbackRisk,
      utilityScore,
      rollbackPlan: model.rollbackPlan,
      verificationChecks: model.verificationChecks,
      explanation: action === "NO_ACTION"
        ? "Baseline projects continued degradation without intervention."
        : `${actionMatchesRecommendation ? "Primary" : "Alternative"} action scored against hypothesis confidence ${(hypothesisConfidence * 100).toFixed(1)}% using ${INCIDENT_TRANSITION_MODEL_VERSION}.`
    };
  });
  const baseline = outcomes.find(item => item.action === "NO_ACTION")!;
  const recommendedAction = outcomes
    .filter(item => item.action !== "NO_ACTION")
    .sort((a, b) => b.utilityScore - a.utilityScore || a.action.localeCompare(b.action))[0]?.action || "NO_ACTION";
  return { modelVersion: INCIDENT_TRANSITION_MODEL_VERSION, recommendationId: args.recommendation.id, recommendedAction, baseline, outcomes, evaluatedCandidates: outcomes.length };
}

export function validCounterfactualSimulation(result: CounterfactualSimulationResult) {
  const baselineCount = result.outcomes.filter(item => item.action === "NO_ACTION").length;
  return baselineCount === 1 && result.baseline.action === "NO_ACTION" && result.evaluatedCandidates === result.outcomes.length &&
    result.outcomes.every(item =>
      [item.recoveryProbability, item.expectedMttrMinutes, item.sloImpactMinutes, item.secondaryFailureProbability, item.rollbackProbability, item.utilityScore].every(Number.isFinite) &&
      item.recoveryProbability >= 0 && item.recoveryProbability <= 1 && item.utilityScore >= 0 && item.utilityScore <= 1 &&
      (item.action === "NO_ACTION" || Boolean(item.rollbackPlan) && item.verificationChecks.length > 0)
    );
}
