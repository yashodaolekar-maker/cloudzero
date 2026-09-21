import crypto from "node:crypto";
import type { RemediationRecommendation, SafeActionType } from "./agent-runtime.ts";
import { computeRemediationActionDigest } from "./remediation-approval.ts";
import type { SecretProvider } from "./secrets.ts";

const allowlist: Record<SafeActionType, { maxBlastRadius: string; reversible: boolean }> = {
  BGP_PATH_PREPEND: { maxBlastRadius: "SINGLE_RESOURCE", reversible: true },
  RESTART_SINGLE_POD: { maxBlastRadius: "SINGLE_RESOURCE", reversible: true }
};

export interface ExecutionResult {
  executionId: string;
  status: "VERIFIED" | "ROLLED_BACK";
  logs: string[];
  rollbackPerformed: boolean;
}

export class NarrowProductionExecutor {
  constructor(private readonly secrets: SecretProvider) {}

  async execute(recommendation: RemediationRecommendation): Promise<ExecutionResult> {
    if (computeRemediationActionDigest(recommendation) !== recommendation.actionDigest) {
      throw new Error("Recommendation action digest is invalid; execution was blocked.");
    }
    const rule = allowlist[recommendation.actionType];
    if (!rule || !rule.reversible || recommendation.reversibility !== "AUTOMATIC") throw new Error("Action is not reversibly allowlisted.");
    if (recommendation.blastRadius !== rule.maxBlastRadius) throw new Error("Action exceeds the allowlisted blast radius.");
    if (recommendation.autonomyLevel !== "AUTONOMOUS" && recommendation.autonomyLevel !== "APPROVE") throw new Error(`Policy level ${recommendation.autonomyLevel} cannot execute.`);

    const executorUrl = (await this.secrets.get("PRODUCTION_EXECUTOR_URL"))?.replace(/\/$/, "");
    const token = await this.secrets.get("PRODUCTION_EXECUTOR_TOKEN");
    if (!executorUrl || !token) throw new Error("Production executor is not configured.");
    const executionId = crypto.randomUUID();
    const invoke = async (operation: "validate" | "apply" | "verify" | "rollback", payload: Record<string, unknown>) => {
      const response = await fetch(`${executorUrl}/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": `${executionId}:${operation}` },
        body: JSON.stringify({ executionId, recommendationId: recommendation.id, actionType: recommendation.actionType, target: recommendation.target, ...payload })
      });
      if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return response.json() as Promise<Record<string, unknown>>;
    };

    const logs = [`Validated allowlist for ${recommendation.actionType} on ${recommendation.target}.`];
    await invoke("validate", { parameters: recommendation.parameters, verification: recommendation.verification });
    await invoke("apply", { parameters: recommendation.parameters });
    logs.push("Apply acknowledged by production executor.");
    try {
      await invoke("verify", { checks: recommendation.verification });
      logs.push("All post-execution checks passed.");
      return { executionId, status: "VERIFIED", logs, rollbackPerformed: false };
    } catch (verificationError: any) {
      logs.push(`Verification failed: ${verificationError.message}`);
      await invoke("rollback", { rollback: recommendation.rollback });
      logs.push("Automatic rollback acknowledged.");
      return { executionId, status: "ROLLED_BACK", logs, rollbackPerformed: true };
    }
  }
}
