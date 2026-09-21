import type { RemediationRecommendation } from "../agent-runtime.ts";
import type { CounterfactualOutcome, QuboModel, RemediationPortfolioResult } from "./contracts.ts";
import { quboEnergy, solveQubo } from "./qubo.ts";

export function planRemediationPortfolio(args: {
  recommendation: RemediationRecommendation;
  outcomes: CounterfactualOutcome[];
  seed: number;
  maxIterations: number;
}): RemediationPortfolioResult {
  const actionable = args.outcomes.filter(item => item.action !== "NO_ACTION" && item.rollbackPlan && item.verificationChecks.length);
  const model: QuboModel = {
    variables: actionable.map(item => item.action),
    linear: actionable.map(item => -item.utilityScore),
    quadratic: [],
    constant: 0
  };
  // Exactly zero or one bounded mitigation may be selected in Q5. Pair penalties
  // make simultaneous changes energetically unfavorable and independently auditable.
  for (let left = 0; left < actionable.length; left += 1) {
    for (let right = left + 1; right < actionable.length; right += 1) {
      model.quadratic.push({ left, right, coefficient: 2 });
    }
  }
  const solution = solveQubo(model, args.seed, args.maxIterations);
  const selectedActions = actionable.filter((_, index) => solution.bits[index] === 1).map(item => item.action);
  const violations = selectedActions.length > 1 ? ["Q5 permits at most one remediation action per portfolio."] : [];
  const baselineIndex = actionable.reduce((best, item, index) => item.utilityScore > (actionable[best]?.utilityScore ?? -Infinity) ? index : best, 0);
  const baselineBits = actionable.map((_, index) => index === baselineIndex ? 1 : 0);
  const baselineEnergy = actionable.length ? quboEnergy(model, baselineBits) : 0;
  const rescoredEnergy = quboEnergy(model, solution.bits);
  return {
    incidentId: args.recommendation.incidentId,
    recommendationId: args.recommendation.id,
    selectedActions,
    energy: solution.energy,
    rescoredEnergy,
    solver: solution.solver,
    baselineEnergy,
    improvedOverBaseline: solution.energy < baselineEnergy,
    constraintViolations: violations,
    evaluatedStates: solution.evaluatedStates
  };
}

export function validRemediationPortfolio(result: RemediationPortfolioResult) {
  return result.constraintViolations.length === 0 && result.selectedActions.length <= 1 &&
    [result.energy, result.rescoredEnergy, result.baselineEnergy].every(Number.isFinite) &&
    Math.abs(result.energy - result.rescoredEnergy) < 1e-9 && result.energy <= result.baselineEnergy + 1e-9;
}
