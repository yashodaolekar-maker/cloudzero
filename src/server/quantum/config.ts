import type { FeatureRolloutState, QuantumFeatureConfig, QuantumInspiredFeature } from "./contracts.ts";

const rolloutStates = new Set<FeatureRolloutState>(["OFF", "REPLAY", "SHADOW", "ASSISTED", "ELIGIBLE"]);

function numberSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function rolloutSetting(name: string, fallback: FeatureRolloutState): FeatureRolloutState {
  const value = String(process.env[name] || fallback).toUpperCase() as FeatureRolloutState;
  if (!rolloutStates.has(value)) throw new Error(`${name} has unsupported rollout state '${value}'.`);
  return value;
}

export function quantumFeatureConfig(feature: QuantumInspiredFeature): QuantumFeatureConfig {
  const prefix = `QI_${feature}`;
  return {
    feature,
    rolloutState: rolloutSetting(`${prefix}_MODE`, ["EVIDENCE_INTERFERENCE", "HYPOTHESIS_SEARCH", "COUNTERFACTUAL_SIMULATION", "ANNEALING_ASSIGNMENT", "CHANGE_COLLISION", "QUBO_PLANNER", "TENSOR_COMPRESSION"].includes(feature) ? "SHADOW" : "OFF"),
    timeoutMs: numberSetting(`${prefix}_TIMEOUT_MS`, 100, 10, 10_000),
    maxCandidates: numberSetting(`${prefix}_MAX_CANDIDATES`, 1_000, 1, 100_000),
    maxIterations: numberSetting(`${prefix}_MAX_ITERATIONS`, 100, 1, 1_000_000),
    algorithmVersion: process.env[`${prefix}_VERSION`] || "1.0.0"
  };
}
