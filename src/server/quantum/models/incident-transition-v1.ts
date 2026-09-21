import type { CounterfactualAction } from "../contracts.ts";

export const INCIDENT_TRANSITION_MODEL_VERSION = "incident-transition-v1.0.0";

export interface ActionTransitionParameters {
  baseRecovery: number;
  baseMttrMinutes: number;
  secondaryFailureRisk: number;
  rollbackRisk: number;
  verificationChecks: string[];
  rollbackPlan?: Record<string, unknown>;
}

export const ACTION_TRANSITIONS: Record<CounterfactualAction, ActionTransitionParameters> = {
  NO_ACTION: {
    baseRecovery: 0.12,
    baseMttrMinutes: 120,
    secondaryFailureRisk: 0.35,
    rollbackRisk: 0,
    verificationChecks: ["Continue telemetry observation"]
  },
  BGP_PATH_PREPEND: {
    baseRecovery: 0.82,
    baseMttrMinutes: 12,
    secondaryFailureRisk: 0.08,
    rollbackRisk: 0.05,
    verificationChecks: ["BGP session established", "packet loss below 0.5%", "latency remains within SLO"],
    rollbackPlan: { prependCount: 0, restoreOriginalPeerPreference: true }
  },
  RESTART_SINGLE_POD: {
    baseRecovery: 0.68,
    baseMttrMinutes: 8,
    secondaryFailureRisk: 0.04,
    rollbackRisk: 0.03,
    verificationChecks: ["replacement pod ready", "error rate below 1%", "remaining replicas healthy"],
    rollbackPlan: { restorePreviousReplica: true }
  }
};
