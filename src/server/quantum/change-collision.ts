import type { ChangeRecord } from "../../types.ts";
import type { RemediationRecommendation } from "../agent-runtime.ts";
import type { ChangeCollisionPlan } from "./contracts.ts";

function words(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9-]{4,}/g) || []);
}

export function planChangeCollisions(incidentId: string, recommendation: RemediationRecommendation, changes: ChangeRecord[]): ChangeCollisionPlan {
  const actionWords = words(`${recommendation.target} ${recommendation.summary} ${JSON.stringify(recommendation.parameters)}`);
  const active = changes.filter(change => !["EXECUTED", "FAILED"].includes(change.status));
  const conflicts = active.flatMap(change => {
    const changeWords = words(`${change.title} ${change.context} ${change.steps.map(step => step.description).join(" ")}`);
    const overlap = [...actionWords].filter(word => changeWords.has(word));
    if (!overlap.length) return [];
    return [{
      changeId: change.id,
      reason: `Shared operational scope: ${overlap.slice(0, 5).join(", ")}`,
      severity: change.status === "APPROVED" ? "BLOCKING" as const : "WARNING" as const
    }];
  });
  const blocking = conflicts.filter(item => item.severity === "BLOCKING");
  const baselineRisk = Math.min(1, active.length * 0.08 + conflicts.length * 0.2 + blocking.length * 0.35);
  const sequence = conflicts.length
    ? [...conflicts.map(item => `Pause or complete ${item.changeId}`), `Revalidate ${recommendation.target}`, `Apply ${recommendation.actionType}`, "Run post-change verification", ...conflicts.map(item => `Resume ${item.changeId}`)]
    : [`Validate ${recommendation.target}`, `Apply ${recommendation.actionType}`, "Run post-change verification"];
  const optimizedRisk = Math.max(0, baselineRisk - conflicts.length * 0.18 - blocking.length * 0.3);
  return {
    incidentId,
    recommendationId: recommendation.id,
    conflicts,
    sequence,
    safeToProceed: blocking.length === 0,
    baselineRisk,
    optimizedRisk,
    improvedOverBaseline: optimizedRisk < baselineRisk
  };
}

export function validChangeCollisionPlan(result: ChangeCollisionPlan) {
  return [result.baselineRisk, result.optimizedRisk].every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
    result.optimizedRisk <= result.baselineRisk && result.sequence.length >= 3 &&
    (result.safeToProceed || result.conflicts.some(item => item.severity === "BLOCKING"));
}
