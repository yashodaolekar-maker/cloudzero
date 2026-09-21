import crypto from "node:crypto";
import type { HITLApproval } from "../types.ts";
import type { RemediationRecommendation } from "./agent-runtime.ts";

export const REMEDIATION_APPROVAL_KIND = "REMEDIATION_EXECUTION" as const;
export const REMEDIATION_APPROVAL_SCHEMA_VERSION = 1 as const;

export interface RemediationApprovalPayload {
  approvalKind: typeof REMEDIATION_APPROVAL_KIND;
  schemaVersion: typeof REMEDIATION_APPROVAL_SCHEMA_VERSION;
  incidentId: string;
  workflowId: string;
  recommendationId: string;
  actionDigest: string;
  parametersDigest: string;
  target: string;
  actionType: RemediationRecommendation["actionType"];
  expiresAt: string;
}

export type RemediationApprovalValidationCode =
  | "APPROVAL_ID_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_ID_MISMATCH"
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_UNRELATED"
  | "APPROVAL_INCIDENT_MISMATCH"
  | "APPROVAL_WORKFLOW_MISMATCH"
  | "APPROVAL_RECOMMENDATION_MISMATCH"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_TARGET_MISMATCH"
  | "APPROVAL_PARAMETERS_MISMATCH"
  | "APPROVAL_DIGEST_MISMATCH"
  | "RECOMMENDATION_DIGEST_MISMATCH"
  | "APPROVAL_EXPIRY_INVALID"
  | "APPROVAL_EXPIRED";

export interface RemediationApprovalValidation {
  valid: boolean;
  code?: RemediationApprovalValidationCode;
  message?: string;
  recomputedActionDigest: string;
}

/**
 * Strict canonical JSON used only for approval hashing. Unlike JSON.stringify,
 * object key order cannot change the resulting representation and values that
 * JSON would silently discard are rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Approval-bound values must contain only finite numbers.");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Approval-bound values must contain only plain objects and arrays.");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => {
        if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
          throw new TypeError(`Approval-bound field ${key} contains an unsupported value.`);
        }
        return `${JSON.stringify(key)}:${canonicalJson(item)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Unsupported approval-bound value type: ${typeof value}.`);
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function computeParametersDigest(parameters: Record<string, unknown>): string {
  return sha256(parameters);
}

export function computeRemediationActionDigest(
  recommendation: Pick<
    RemediationRecommendation,
    | "id"
    | "incidentId"
    | "workflowId"
    | "actionType"
    | "target"
    | "parameters"
    | "rollback"
    | "verification"
    | "blastRadius"
    | "reversibility"
  >
): string {
  return sha256({
    incidentId: recommendation.incidentId,
    workflowId: recommendation.workflowId,
    recommendationId: recommendation.id,
    actionType: recommendation.actionType,
    target: recommendation.target,
    parameters: recommendation.parameters,
    rollback: recommendation.rollback,
    verification: recommendation.verification,
    blastRadius: recommendation.blastRadius,
    reversibility: recommendation.reversibility
  });
}

export function remediationWorkflowId(incidentId: string, recommendationId: string): string {
  const normalizedIncident = incidentId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const normalizedRecommendation = recommendationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `wf-remediation-${normalizedIncident}-${normalizedRecommendation}`;
}

export function remediationApprovalAction(recommendation: RemediationRecommendation): string {
  return `Execute ${recommendation.actionType} on ${recommendation.target}`;
}

export function buildRemediationApprovalPayload(
  recommendation: RemediationRecommendation,
  expiresAt: string
): RemediationApprovalPayload {
  return {
    approvalKind: REMEDIATION_APPROVAL_KIND,
    schemaVersion: REMEDIATION_APPROVAL_SCHEMA_VERSION,
    incidentId: recommendation.incidentId,
    workflowId: recommendation.workflowId,
    recommendationId: recommendation.id,
    actionDigest: recommendation.actionDigest,
    parametersDigest: computeParametersDigest(recommendation.parameters),
    target: recommendation.target,
    actionType: recommendation.actionType,
    expiresAt
  };
}

function sameDigest(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function invalid(
  code: RemediationApprovalValidationCode,
  message: string,
  recomputedActionDigest: string
): RemediationApprovalValidation {
  return { valid: false, code, message, recomputedActionDigest };
}

/**
 * Validates a single explicit approval against every execution-relevant field.
 * The recommendation digest is recalculated on every call, so changing the
 * stored recommendation after approval fails closed.
 */
export function validateRemediationApproval(input: {
  approvalId: string;
  approval?: HITLApproval;
  recommendation: RemediationRecommendation;
  now?: Date;
}): RemediationApprovalValidation {
  const { approvalId, approval, recommendation } = input;
  const recomputedActionDigest = computeRemediationActionDigest(recommendation);
  if (!approvalId) return invalid("APPROVAL_ID_REQUIRED", "An explicit remediation approvalId is required.", recomputedActionDigest);
  if (!approval) return invalid("APPROVAL_NOT_FOUND", "The specified remediation approval was not found.", recomputedActionDigest);
  if (approval.id !== approvalId) return invalid("APPROVAL_ID_MISMATCH", "The supplied approval ID does not match the approval record.", recomputedActionDigest);
  if (approval.status !== "APPROVED") return invalid("APPROVAL_NOT_APPROVED", "The remediation approval is not approved.", recomputedActionDigest);

  const payload = approval.payload as Partial<RemediationApprovalPayload> | undefined;
  if (payload?.approvalKind !== REMEDIATION_APPROVAL_KIND || payload.schemaVersion !== REMEDIATION_APPROVAL_SCHEMA_VERSION) {
    return invalid("APPROVAL_UNRELATED", "The approval is not a remediation-execution approval.", recomputedActionDigest);
  }
  if (approval.incidentId !== recommendation.incidentId || payload.incidentId !== recommendation.incidentId) {
    return invalid("APPROVAL_INCIDENT_MISMATCH", "Approval incidentId does not match the recommendation.", recomputedActionDigest);
  }
  if (approval.workflowId !== recommendation.workflowId || payload.workflowId !== recommendation.workflowId) {
    return invalid("APPROVAL_WORKFLOW_MISMATCH", "Approval workflowId does not match the recommendation.", recomputedActionDigest);
  }
  if (payload.recommendationId !== recommendation.id) {
    return invalid("APPROVAL_RECOMMENDATION_MISMATCH", "Approval recommendationId does not match the recommendation.", recomputedActionDigest);
  }
  if (payload.actionType !== recommendation.actionType || approval.action !== remediationApprovalAction(recommendation)) {
    return invalid("APPROVAL_ACTION_MISMATCH", "Approval action does not match the recommendation.", recomputedActionDigest);
  }
  if (payload.target !== recommendation.target) {
    return invalid("APPROVAL_TARGET_MISMATCH", "Approval target does not match the recommendation.", recomputedActionDigest);
  }
  if (!sameDigest(payload.parametersDigest, computeParametersDigest(recommendation.parameters))) {
    return invalid("APPROVAL_PARAMETERS_MISMATCH", "Approval parameters do not match the recommendation.", recomputedActionDigest);
  }
  if (!sameDigest(recommendation.actionDigest, recomputedActionDigest)) {
    return invalid("RECOMMENDATION_DIGEST_MISMATCH", "Recommendation action data changed after the approval binding was created.", recomputedActionDigest);
  }
  if (!sameDigest(payload.actionDigest, recomputedActionDigest)) {
    return invalid("APPROVAL_DIGEST_MISMATCH", "Approval action digest does not match the recommendation.", recomputedActionDigest);
  }

  const expiresAt = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt)) return invalid("APPROVAL_EXPIRY_INVALID", "Approval expiry is missing or invalid.", recomputedActionDigest);
  if (expiresAt <= (input.now || new Date()).getTime()) return invalid("APPROVAL_EXPIRED", "The remediation approval has expired.", recomputedActionDigest);
  return { valid: true, recomputedActionDigest };
}
