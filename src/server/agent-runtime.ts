import crypto from "node:crypto";
import { KNOWLEDGE_BASE, type KBArticle } from "../data/kb.ts";
import type { DepartmentType, IncidentAggregate, IncidentEvidence, OperatingMode } from "../types.ts";
import type { IncidentDomainEvent } from "./incident-runtime.ts";
import { quantumFeatureConfig } from "./quantum/config.ts";
import type { EvidenceInterferenceResult, OptimizationRun } from "./quantum/contracts.ts";
import { scoreEvidenceInterference, validEvidenceInterference } from "./quantum/evidence-interference.ts";
import { seedFrom } from "./quantum/random.ts";
import { QuantumInspiredRuntime } from "./quantum/runtime.ts";
import { searchHypotheses, validHypothesisSearch } from "./quantum/hypothesis-search.ts";
import { simulateCounterfactuals, validCounterfactualSimulation } from "./quantum/counterfactual-simulator.ts";
import { computeRemediationActionDigest, remediationWorkflowId } from "./remediation-approval.ts";

export type AutonomyLevel = "OBSERVE" | "RECOMMEND" | "DRY_RUN" | "APPROVE" | "DUAL_APPROVE" | "AUTONOMOUS" | "FORBIDDEN";
export type SafeActionType = "BGP_PATH_PREPEND" | "RESTART_SINGLE_POD";

export interface RunbookGrounding {
  runbookId: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
}

export interface StructuredAgentFinding {
  id: string;
  incidentId: string;
  agentId: string;
  department: DepartmentType;
  claim: string;
  evidence: IncidentEvidence[];
  runbooks: RunbookGrounding[];
  confidence: number;
  freshness: "LIVE" | "RECENT" | "STALE";
  limitations: string[];
  producedAt: string;
  evidenceAnalysis?: EvidenceInterferenceResult;
  optimizationRun?: OptimizationRun<EvidenceInterferenceResult>;
}

export interface RemediationRecommendation {
  readonly id: string;
  readonly incidentId: string;
  readonly workflowId: string;
  readonly actionDigest: string;
  actionType: SafeActionType;
  summary: string;
  target: string;
  parameters: Record<string, unknown>;
  rollback: Record<string, unknown>;
  verification: string[];
  evidenceIds: string[];
  runbookIds: string[];
  confidence: number;
  blastRadius: "SINGLE_RESOURCE" | "LIMITED_SERVICE" | "MULTI_SERVICE";
  reversibility: "AUTOMATIC" | "MANUAL" | "IRREVERSIBLE";
  autonomyLevel: AutonomyLevel;
  shadowMode: boolean;
  createdAt: string;
}

export interface AgentEvaluation {
  id: string;
  incidentId: string;
  recommendationId: string;
  replayedAt: string;
  evidenceCoverage: number;
  groundingScore: number;
  policyCompliance: number;
  outcomeScore: number;
  passed: boolean;
}

export interface AgentAbstention {
  code:
    | "NO_DOMAIN_EVIDENCE"
    | "INSUFFICIENT_INDEPENDENT_EVIDENCE"
    | "CMDB_TARGET_NOT_EXACT"
    | "EVIDENCE_NOT_FRESH"
    | "NO_SIGNED_ACTION_CANDIDATE"
    | "RUNBOOK_BINDING_MISSING";
  reason: string;
  requiredNextEvidence: string[];
}

function tokens(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9-]{3,}/g) || []);
}

export class RunbookRetriever {
  search(query: string, limit = 3): RunbookGrounding[] {
    const queryTokens = tokens(query);
    return KNOWLEDGE_BASE.map((article: KBArticle) => {
      const searchable = tokens(`${article.title} ${article.keywords.join(" ")} ${article.procedure}`);
      const overlap = [...queryTokens].filter(token => searchable.has(token)).length;
      return {
        article,
        score: queryTokens.size ? overlap / queryTokens.size : 0
      };
    })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 5)))
      .map(({ article, score }) => ({
        runbookId: article.id,
        title: article.title,
        excerpt: article.procedure.slice(0, 360),
        relevanceScore: Number(score.toFixed(3))
      }));
  }
}

export class DomainAgentRuntime {
  private readonly quantumRuntime = new QuantumInspiredRuntime();
  constructor(
    readonly agentId: string,
    readonly department: DepartmentType,
    private readonly retriever: RunbookRetriever
  ) {}

  async investigate(incident: IncidentAggregate): Promise<StructuredAgentFinding> {
    const domainEvidence = incident.evidence.filter(item =>
      item.source.toLowerCase().includes(this.department.toLowerCase()) ||
      (Array.isArray(item.payload?.relevantDepartments) && item.payload.relevantDepartments.includes(this.department)) ||
      String(item.payload?.persona || "").replace("CLOUDOPS_DEVOPS", "CloudOps").toLowerCase() === this.department.toLowerCase()
    );
    const query = `${incident.title} ${domainEvidence.map(item => item.summary).join(" ")}`;
    const runbooks = this.retriever.search(query);
    const evidence = domainEvidence.slice(-8);
    // No evidence means no confidence. A previous non-zero baseline made an
    // evidence-free twin appear authoritative and could seed an invented
    // remediation downstream.
    const baselineConfidence = evidence.length
      ? Math.min(0.97, 0.35 + evidence.length * 0.08 + (runbooks[0]?.relevanceScore || 0) * 0.25)
      : 0;
    const config = quantumFeatureConfig("EVIDENCE_INTERFERENCE");
    const referenceNow = evidence.reduce((latest, item) => Math.max(latest, Date.parse(item.observedAt) || 0), 0) || Date.now();
    const optimized = await this.quantumRuntime.run({
      incidentId: incident.incidentId,
      seed: seedFrom(`${incident.incidentId}:${this.agentId}:${config.algorithmVersion}`),
      config,
      algorithm: "signed-evidence-interference",
      parameters: { evidenceCount: evidence.length, freshnessHalfLifeHours: 6 },
      operation: () => scoreEvidenceInterference(evidence, baselineConfidence, referenceNow),
      validate: validEvidenceInterference,
      fallback: () => ({
        score: baselineConfidence,
        baselineScore: baselineConfidence,
        support: 0,
        contradiction: 0,
        provenanceCoverage: evidence.length ? evidence.filter(item => item.source && item.observedAt).length / evidence.length : 0,
        contributions: [],
        evidence,
        coherentAmplitude: { real: 0, imaginary: 0, intensity: 0 }
      })
    });
    const confidence = ["ASSISTED", "ELIGIBLE"].includes(config.rolloutState) ? optimized.value.score : baselineConfidence;
    return {
      id: `finding-${seedFrom(`${incident.incidentId}:${this.agentId}:${evidence.map(item => item.id).join(",")}`).toString(16)}`,
      incidentId: incident.incidentId,
      agentId: this.agentId,
      department: this.department,
      claim: evidence.at(-1)?.summary || `${this.department} twin found no domain-specific evidence yet.`,
      evidence,
      runbooks,
      confidence: Number(confidence.toFixed(3)),
      freshness: evidence.some(item => Date.now() - Date.parse(item.observedAt) < 15 * 60_000)
        ? "LIVE"
        : evidence.length && evidence.some(item => item.provenance?.stale !== true)
          ? "RECENT"
          : "STALE",
      limitations: evidence.length ? [] : ["No persisted domain telemetry was available."],
      producedAt: new Date().toISOString(),
      evidenceAnalysis: optimized.value,
      optimizationRun: optimized.run
    };
  }
}

export interface PolicyContext {
  operatingMode: OperatingMode;
  approved: boolean;
  productionExecutionEnabled: boolean;
  qualityGatePassed: boolean;
}

interface EvidenceBoundActionCandidate {
  schemaVersion: 1;
  binding: "SIGNED_RUNBOOK_BINDING";
  actionType: SafeActionType;
  target: string;
  parameters: Record<string, unknown>;
  rollback: Record<string, unknown>;
  verification: string[];
  runbookId: string;
  summary: string;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function actionCandidate(value: unknown): EvidenceBoundActionCandidate | null {
  if (!plainRecord(value)) return null;
  if (value.schemaVersion !== 1 || value.binding !== "SIGNED_RUNBOOK_BINDING") return null;
  if (value.actionType !== "BGP_PATH_PREPEND" && value.actionType !== "RESTART_SINGLE_POD") return null;
  if (typeof value.target !== "string" || !value.target.trim() || value.target.length > 240) return null;
  if (!plainRecord(value.parameters) || !plainRecord(value.rollback)) return null;
  if (!Array.isArray(value.verification) || !value.verification.length || !value.verification.every(item => typeof item === "string" && item.trim())) return null;
  if (typeof value.runbookId !== "string" || !value.runbookId.trim()) return null;
  if (typeof value.summary !== "string" || !value.summary.trim()) return null;
  return value as unknown as EvidenceBoundActionCandidate;
}

function remediationAbstention(findings: StructuredAgentFinding[]): AgentAbstention {
  const evidence = findings.flatMap(item => item.evidence);
  if (!evidence.length) {
    return {
      code: "NO_DOMAIN_EVIDENCE",
      reason: "No persisted domain evidence supports a remediation recommendation.",
      requiredNextEvidence: ["Persist connector telemetry linked to the exact incident and domain twin."]
    };
  }
  const exact = evidence.filter(item => item.provenance?.cmdbResolution === "CMDB_EXACT" && item.provenance?.canonicalCiId);
  if (!exact.length) {
    return {
      code: "CMDB_TARGET_NOT_EXACT",
      reason: "The evidence is not resolved to one exact CMDB configuration item.",
      requiredNextEvidence: ["Resolve the signal to one canonical CMDB item without ambiguity."]
    };
  }
  const fresh = exact.filter(item => item.provenance?.stale !== true && item.provenance?.observedAtAssumed !== true);
  if (!fresh.length) {
    return {
      code: "EVIDENCE_NOT_FRESH",
      reason: "Only stale evidence or evidence with an assumed timestamp is available.",
      requiredNextEvidence: ["Collect a fresh connector observation with a source timestamp."]
    };
  }
  const independentSources = new Set(fresh.map(item => item.provenance?.sourceFamily || item.provenance?.connector || item.source));
  if (independentSources.size < 2) {
    return {
      code: "INSUFFICIENT_INDEPENDENT_EVIDENCE",
      reason: "A production-affecting recommendation requires corroboration from at least two independent source families.",
      requiredNextEvidence: ["Corroborate the condition through a second independent telemetry or security source family."]
    };
  }
  if (!fresh.some(item => actionCandidate(item.payload?.remediationCandidate))) {
    return {
      code: "NO_SIGNED_ACTION_CANDIDATE",
      reason: "No trusted connector supplied a schema-valid, signed runbook action binding; the orchestrator will not infer a target or command.",
      requiredNextEvidence: ["Supply a SIGNED_RUNBOOK_BINDING action candidate from a trusted connector or change-control service."]
    };
  }
  return {
    code: "RUNBOOK_BINDING_MISSING",
    reason: "The action candidate is not bound to a retrieved runbook for this incident.",
    requiredNextEvidence: ["Publish and retrieve the exact approved runbook version referenced by the action binding."]
  };
}

export class AutonomyPolicyEngine {
  decide(recommendation: Omit<RemediationRecommendation, "autonomyLevel">, context: PolicyContext): AutonomyLevel {
    if (recommendation.reversibility === "IRREVERSIBLE" || recommendation.blastRadius === "MULTI_SERVICE") return "FORBIDDEN";
    if (context.operatingMode === "SIMULATION" || recommendation.shadowMode) return "DRY_RUN";
    if (!context.productionExecutionEnabled || !context.qualityGatePassed) return "RECOMMEND";
    if (!context.approved) return recommendation.blastRadius === "LIMITED_SERVICE" ? "DUAL_APPROVE" : "APPROVE";
    return recommendation.reversibility === "AUTOMATIC" && recommendation.blastRadius === "SINGLE_RESOURCE"
      ? "AUTONOMOUS"
      : "APPROVE";
  }
}

export class OrchestratorRuntime {
  private readonly retriever = new RunbookRetriever();
  private readonly policy = new AutonomyPolicyEngine();
  private readonly quantumRuntime = new QuantumInspiredRuntime();
  private readonly agents = [
    new DomainAgentRuntime("agent-windows", "Windows", this.retriever),
    new DomainAgentRuntime("agent-linux", "Linux", this.retriever),
    new DomainAgentRuntime("agent-database", "Database", this.retriever),
    new DomainAgentRuntime("agent-nre", "Network", this.retriever),
    new DomainAgentRuntime("agent-middleware", "Middleware", this.retriever),
    new DomainAgentRuntime("agent-cloudops", "CloudOps", this.retriever)
  ];

  async investigate(incident: IncidentAggregate, context: PolicyContext) {
    const findings = await Promise.all(this.agents.map(agent => agent.investigate(incident)));
    const hypothesisConfig = quantumFeatureConfig("HYPOTHESIS_SEARCH");
    const hypothesisSeed = seedFrom(`${incident.incidentId}:hypothesis-search:${hypothesisConfig.algorithmVersion}`);
    const hypothesisOptions = {
      incidentId: incident.incidentId,
      beamWidth: Math.min(4, hypothesisConfig.maxCandidates),
      maxDepth: Math.min(3, hypothesisConfig.maxIterations),
      maxCandidates: hypothesisConfig.maxCandidates,
      pruneThreshold: 0.2,
      seed: hypothesisSeed
    };
    const hypothesisSearch = await this.quantumRuntime.run({
      incidentId: incident.incidentId,
      seed: hypothesisSeed,
      config: hypothesisConfig,
      algorithm: "diversity-preserving-hypothesis-beam-search",
      parameters: hypothesisOptions,
      operation: () => searchHypotheses(findings, hypothesisOptions),
      validate: validHypothesisSearch,
      fallback: () => searchHypotheses(findings, { ...hypothesisOptions, maxDepth: 0 })
    });
    const grounded = findings.filter(item => item.evidence.length && item.runbooks.length).sort((a, b) => b.confidence - a.confidence);
    const eligible = grounded.flatMap(finding => finding.evidence.map(evidence => ({
      finding,
      evidence,
      candidate: actionCandidate(evidence.payload?.remediationCandidate)
    }))).filter(item => {
      const target = item.evidence.provenance?.canonicalCiId;
      return Boolean(
        item.candidate &&
        item.evidence.integrityHash &&
        item.evidence.provenance?.sourceRecordHash &&
        item.evidence.provenance?.cmdbResolution === "CMDB_EXACT" &&
        item.evidence.provenance?.stale !== true &&
        item.evidence.provenance?.observedAtAssumed !== true &&
        target && item.candidate.target === target &&
        item.finding.runbooks.some(runbook => runbook.runbookId === item.candidate?.runbookId)
      );
    });
    const selected = eligible[0];
    const corroboratingEvidence = selected
      ? grounded.flatMap(item => item.evidence).filter(item =>
          item.provenance?.canonicalCiId === selected.evidence.provenance?.canonicalCiId &&
          item.provenance?.cmdbResolution === "CMDB_EXACT" &&
          item.provenance?.stale !== true &&
          item.provenance?.observedAtAssumed !== true &&
          Boolean(item.integrityHash && item.provenance?.sourceRecordHash)
        )
      : [];
    const independentSources = new Set(corroboratingEvidence.map(item => item.provenance?.sourceFamily || item.provenance?.connector || item.source));

    if (!selected || independentSources.size < 2) {
      return {
        findings,
        hypothesisSearch: hypothesisSearch.value,
        counterfactualSimulation: null,
        recommendation: null,
        abstention: remediationAbstention(findings),
        optimizationRuns: [
          ...findings.flatMap(item => item.optimizationRun ? [item.optimizationRun] : []),
          hypothesisSearch.run
        ]
      };
    }

    const primary = selected.finding;
    const candidate = selected.candidate!;
    const recommendationId = crypto.randomUUID();
    const workflowId = remediationWorkflowId(incident.incidentId, recommendationId);
    const actionDraft = {
      id: recommendationId,
      incidentId: incident.incidentId,
      workflowId,
      actionType: candidate.actionType,
      summary: candidate.summary.slice(0, 500),
      target: candidate.target,
      parameters: structuredClone(candidate.parameters),
      rollback: structuredClone(candidate.rollback),
      verification: candidate.verification.map(item => item.slice(0, 300)),
      evidenceIds: corroboratingEvidence.map(item => item.id),
      runbookIds: [candidate.runbookId],
      confidence: primary.confidence,
      blastRadius: "SINGLE_RESOURCE" as const,
      reversibility: "AUTOMATIC" as const,
      shadowMode: process.env.AGENT_SHADOW_MODE !== "false",
      createdAt: new Date().toISOString()
    };
    const draft = {
      ...actionDraft,
      actionDigest: computeRemediationActionDigest(actionDraft)
    };
    const recommendation: RemediationRecommendation = Object.freeze({
      ...draft,
      autonomyLevel: this.policy.decide(draft, context)
    });
    const counterfactualConfig = quantumFeatureConfig("COUNTERFACTUAL_SIMULATION");
    const counterfactualSeed = seedFrom(`${incident.incidentId}:counterfactual:${counterfactualConfig.algorithmVersion}`);
    const counterfactualSimulation = await this.quantumRuntime.run({
      incidentId: incident.incidentId,
      seed: counterfactualSeed,
      config: counterfactualConfig,
      algorithm: "versioned-counterfactual-transition-model",
      parameters: { maxCandidates: Math.min(3, counterfactualConfig.maxCandidates) },
      operation: () => simulateCounterfactuals({
        recommendation,
        hypotheses: hypothesisSearch.value,
        seed: counterfactualSeed,
        maxCandidates: Math.min(3, counterfactualConfig.maxCandidates)
      }),
      validate: validCounterfactualSimulation,
      fallback: () => simulateCounterfactuals({
        recommendation,
        hypotheses: hypothesisSearch.value,
        seed: counterfactualSeed,
        maxCandidates: 1
      })
    });
    return {
      findings,
      hypothesisSearch: hypothesisSearch.value,
      counterfactualSimulation: counterfactualSimulation.value,
      recommendation,
      abstention: null,
      optimizationRuns: [
        ...findings.flatMap(item => item.optimizationRun ? [item.optimizationRun] : []),
        hypothesisSearch.run,
        counterfactualSimulation.run
      ]
    };
  }
}

export function qualityMetrics(events: IncidentDomainEvent[]) {
  const recommendations = events.filter(event => event.type === "RecommendationCreated");
  const accepted = events.filter(event => event.type === "RecommendationAccepted").length;
  const executed = events.filter(event => event.type === "SafeActionExecuted").length;
  const rollbacks = events.filter(event => event.type === "SafeActionRolledBack").length;
  const falsePositives = events.filter(event => event.type === "RecommendationFalsePositive").length;
  const positiveFeedback = events.filter(event => event.type === "OperatorFeedback" && event.payload?.accepted === true).length;
  const total = Math.max(recommendations.length, 1);
  const metrics = {
    recommendations: recommendations.length,
    recommendationAccuracy: Number(((accepted - falsePositives) / total).toFixed(3)),
    rollbackRate: Number((rollbacks / Math.max(executed, 1)).toFixed(3)),
    falsePositiveRate: Number((falsePositives / total).toFixed(3)),
    operationalAcceptance: Number((positiveFeedback / total).toFixed(3))
  };
  const minimumSamples = Number(process.env.AUTONOMY_MINIMUM_SAMPLES || 20);
  return {
    ...metrics,
    minimumSamples,
    qualityGatePassed:
      recommendations.length >= minimumSamples &&
      metrics.recommendationAccuracy >= Number(process.env.AUTONOMY_MIN_ACCURACY || 0.9) &&
      metrics.rollbackRate <= Number(process.env.AUTONOMY_MAX_ROLLBACK_RATE || 0.05) &&
      metrics.falsePositiveRate <= Number(process.env.AUTONOMY_MAX_FALSE_POSITIVE_RATE || 0.03) &&
      metrics.operationalAcceptance >= Number(process.env.AUTONOMY_MIN_ACCEPTANCE || 0.8)
  };
}

export function evaluateRecommendation(
  recommendation: RemediationRecommendation,
  events: IncidentDomainEvent[]
): AgentEvaluation {
  const hasOutcome = events.some(event => ["SafeActionExecuted", "SafeActionRolledBack", "RecommendationFalsePositive"].includes(event.type));
  const evidenceCoverage = Math.min(1, recommendation.evidenceIds.length / 2);
  const groundingScore = Math.min(1, recommendation.runbookIds.length / 2);
  const policyCompliance = recommendation.autonomyLevel === "FORBIDDEN" && events.some(event => event.type === "SafeActionExecuted") ? 0 : 1;
  const outcomeScore = !hasOutcome ? 0.5 : events.some(event => event.type === "SafeActionRolledBack") ? 0.25 : 1;
  const score = (evidenceCoverage + groundingScore + policyCompliance + outcomeScore) / 4;
  return {
    id: crypto.randomUUID(),
    incidentId: recommendation.incidentId,
    recommendationId: recommendation.id,
    replayedAt: new Date().toISOString(),
    evidenceCoverage,
    groundingScore,
    policyCompliance,
    outcomeScore,
    passed: score >= 0.8
  };
}
