import crypto from "node:crypto";
import type { IncidentDomainEvent } from "./incident-runtime.ts";
import { redactOperationalText } from "./engineering-orchestrator.ts";

export const ROLES = ["NETWORK", "WINDOWS", "LINUX", "CLOUDOPS", "DEVOPS", "SECURITY", "DATABASE", "MIDDLEWARE", "OTHER"] as const;
export const KINDS = ["CONVERSATION", "DIAGNOSTIC", "A2A", "OWNER_ASSESSMENT", "INVESTIGATION"] as const;
type Kind = typeof KINDS[number];
export const roleName = (value: unknown): string => {
  const name = String(value || "").toUpperCase();
  const aliases: Record<string, string> = { CLOUDOPS_DEVOPS: "CLOUDOPS", "AGENT-NRE": "NETWORK", "AGENT-SRE": "SECURITY", "AGENT-WINDOWS": "WINDOWS", "AGENT-LINUX": "LINUX", "AGENT-CLOUDOPS": "CLOUDOPS", "AGENT-DEVOPS": "DEVOPS", "AGENT-DATABASE": "DATABASE", "AGENT-MIDDLEWARE": "MIDDLEWARE" };
  return ROLES.includes(name as any) ? name : aliases[name] || "OTHER";
};
const bounded = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
export function observationPolicy(env = process.env) {
  const config = {
    windowDays: 30, minimumReviewed: bounded(env.TWIN_MINIMUM_REVIEWED, 20, 1, 10000),
    accuracyTarget: bounded(env.TWIN_ACCURACY_TARGET, 0.9, 0.01, 1), reviewCoverageTarget: 0.8,
    experience: { minimumResponses: bounded(env.TWIN_XLA_MINIMUM_RESPONSES, 10, 1, 10000),
      favorableTarget: bounded(env.TWIN_XLA_FAVORABLE_TARGET, 0.8, 0.01, 1), coverageTarget: bounded(env.TWIN_XLA_COVERAGE_TARGET, 0.6, 0.01, 1) },
    incidentSeconds: {
      P1: { response: null, resolution: bounded(env.TWIN_SLA_P1_RESOLUTION_SECONDS, 3600, 1, 2592000) },
      P2: { response: null, resolution: bounded(env.TWIN_SLA_P2_RESOLUTION_SECONDS, 28800, 1, 2592000) },
      P3: { response: null, resolution: env.TWIN_SLA_P3_RESOLUTION_SECONDS ? bounded(env.TWIN_SLA_P3_RESOLUTION_SECONDS, 0, 1, 2592000) || null : null }
    },
    taskSeconds: {
      CONVERSATION: bounded(env.TWIN_SLA_CONVERSATION_SECONDS, 120, 1, 86400),
      DIAGNOSTIC: bounded(env.TWIN_SLA_DIAGNOSTIC_SECONDS, 120, 1, 86400),
      A2A: bounded(env.TWIN_SLA_A2A_SECONDS, 180, 1, 86400),
      OWNER_ASSESSMENT: bounded(env.TWIN_SLA_OWNER_SECONDS, 180, 1, 86400),
      INVESTIGATION: bounded(env.TWIN_SLA_INVESTIGATION_SECONDS, 300, 1, 86400)
    }
  };
  return { ...config, version: `local-v1-${crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 10)}`,
    description: "Incident resolution SLA: P1 1 hour, P2 8 hours; P3 unconfigured unless explicitly set. Ticket-open-to-recorded-resolution, 24x7 elapsed time. Task response limits are separate proposed SLOs, not SLA commitments. Unknown legacy timing is excluded. Simulation is not production performance." };
}
export type Review = {
  verdict: "CORRECT" | "WRONG" | "INCONCLUSIVE"; reason: string; correction: string;
  reviewerId: string; reviewedAt: string; trainingEligible: boolean; eventId: string;
};
export type ObservedTask = {
  id: string; incidentId: string; workflowId: string | null; role: string; kind: Kind; mode: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "INTERRUPTED";
  startedAt: string | null; completedAt: string | null; durationSeconds: number | null;
  slaTargetSeconds: number; slaStatus: "MET" | "BREACHED" | "PENDING" | "UNKNOWN"; policyVersion: string;
  summary: string; decisionEventId: string | null; review: Review | null; modelStatus: string | null;
  eventIds: string[];
};
export function safePayload(value: unknown, depth = 0): any {
  if (depth > 12) return "[depth limit]";
  if (typeof value === "string") return redactOperationalText(value, 16000, true);
  if (Array.isArray(value)) return value.slice(0, 500).map(v => safePayload(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 200).map(([k, v]) => [k,
    /password|secret|authorization|access.?token|api.?key/i.test(k) ? "[REDACTED]" : safePayload(v, depth + 1)]));
  return value;
}
const str = (v: unknown) => typeof v === "string" ? v : "";
const modeOf = (p: any) => ["LIVE", "SIMULATION"].includes(p.operatingMode) ? p.operatingMode
  : ["SIMULATED"].includes(p.validationStatus || p.executionStatus || p.evidence?.payload?.status) ? "SIMULATION" : "UNKNOWN";

/** Reconstruct activity from immutable events. Never infer work from seeded counters. */
export function projectTasks(events: IncidentDomainEvent[], now = Date.now(), policy = observationPolicy()): ObservedTask[] {
  const tasks = new Map<string, ObservedTask>();
  const eventIndex = new Map(events.map(event => [event.id, event]));
  const seen = new Set<string>();
  const key = (e: IncidentDomainEvent, id: string) => `${e.incidentId}\0${id}`;
  const create = (e: IncidentDomainEvent, id: string, kind: Kind, started: boolean, role: unknown) => {
    const p: any = e.payload;
    const task: ObservedTask = { id, incidentId: e.incidentId, workflowId: str(p.workflowId) || null,
      role: roleName(role), kind, mode: modeOf(p), status: started ? "RUNNING" : "COMPLETED",
      startedAt: started ? e.occurredAt : null, completedAt: started ? null : e.occurredAt,
      durationSeconds: null, slaTargetSeconds: bounded(p.slaTargetSeconds, policy.taskSeconds[kind], 1, 86400),
      slaStatus: "UNKNOWN", policyVersion: str(p.policyVersion) || "LEGACY_UNMEASURED",
      summary: str(p.question || p.summary || p.assessment || p.reason || p.templateId || p.recommendation?.rationale || e.type),
      decisionEventId: started ? null : e.id, review: null, modelStatus: str(p.modelStatus) || null, eventIds: [e.id] };
    tasks.set(key(e, id), task);
    return task;
  };
  const complete = (task: ObservedTask, e: IncidentDomainEvent) => {
    const p: any = e.payload;
    if (task.completedAt) return; // duplicate terminal events never increment counts
    task.completedAt = e.occurredAt;
    task.status = /Interrupted$/.test(e.type) ? "INTERRUPTED" : /Failed$/.test(e.type) ? "FAILED" : /Blocked$/.test(e.type) ? "BLOCKED" : "COMPLETED";
    task.summary = str(p.answer || p.assessment || p.summary || p.reason) || task.summary;
    task.decisionEventId = task.status === "COMPLETED" ? e.id : null;
    task.modelStatus = str(p.modelStatus) || task.modelStatus;
    task.workflowId = str(p.workflowId || p.recommendation?.workflowId) || task.workflowId;
    if (task.mode === "UNKNOWN") task.mode = modeOf(p);
    task.eventIds.push(e.id);
  };
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const p: any = e.payload;
    if (e.type === "TwinTaskStarted") {
      if (!tasks.has(key(e, str(p.taskId)))) create(e, str(p.taskId), KINDS.includes(p.kind) ? p.kind : "INVESTIGATION", true, p.role);
    } else if (/^TwinTask(Completed|Failed|Blocked|Interrupted)$/.test(e.type)) {
      const task = tasks.get(key(e, str(p.taskId)));
      if (task) complete(task, e);
    } else if (e.type === "AgentInvestigationRequested") {
      create(e, str(p.messageId) || e.id, "A2A", true, p.recipient);
    } else if (e.type === "AgentValidationReplied") {
      const task = tasks.get(key(e, str(p.inReplyTo)));
      if (task) complete(task, e);
      else create(e, e.id, "A2A", false, p.sender);
    } else if (e.type === "AgentOwnerAssessmentStarted") {
      create(e, str(p.taskId) || e.id, "OWNER_ASSESSMENT", true, p.sender);
    } else if (e.type === "AgentOwnerAssessmentCompleted") {
      const task = tasks.get(key(e, str(p.taskId)));
      if (task) complete(task, e); else create(e, e.id, "OWNER_ASSESSMENT", false, p.sender);
    } else if (e.type === "EngineeringDiagnosticCompleted" && !p.taskId) {
      create(e, e.id, "DIAGNOSTIC", false, p.persona);
    } else if (e.type === "RecommendationCreated" && !p.taskId) {
      const task = create(e, e.id, "INVESTIGATION", false, p.recommendation?.agentId || p.agentId || p.persona || e.actorId);
      task.workflowId = str(p.recommendation?.workflowId) || task.workflowId;
    } else if (e.type === "AgentRecommendationAbstained" && !p.taskId) {
      create(e, e.id, "INVESTIGATION", false, e.actorId);
    } else if (e.type === "CyberFusionAnalysisCompleted") {
      const task = create(e, e.id, "INVESTIGATION", false, "SECURITY");
      task.summary = `Cyber fusion analysis ${str(p.analysis?.analysisId)}: ${p.analysis?.cases?.length || 0} correlated cases. See workflow evidence.`;
    } else if (e.type === "TwinModelInvocationCompleted") {
      const task = tasks.get(key(e, str(p.taskId)));
      if (task) task.eventIds.push(e.id);
    } else if (e.type === "AgentCollaborationCompleted") {
      for (const task of tasks.values()) {
        const start = eventIndex.get(task.eventIds[0]);
        if (task.status === "RUNNING" && task.incidentId === e.incidentId && start?.payload.collaborationId === p.collaborationId) {
          complete(task, { ...e, type: "TwinTaskBlocked", payload: { reason: "Collaboration ended before this agent delivered a validation reply." } });
        }
      }
    } else if (e.type === "TwinTaskReviewed") {
      const task = tasks.get(key(e, str(p.taskId)));
      if (task && task.decisionEventId === p.decisionEventId && ["CORRECT", "WRONG", "INCONCLUSIVE"].includes(p.verdict)) {
        task.review = { verdict: p.verdict, reason: str(p.reason), correction: str(p.correction), reviewerId: e.actorId,
          reviewedAt: e.occurredAt, trainingEligible: p.trainingEligible === true && p.verdict !== "INCONCLUSIVE", eventId: e.id };
      }
    }
  }
  for (const task of tasks.values()) {
    if (task.modelStatus === "GENERATED") {
      const invocation = task.eventIds.map(id => eventIndex.get(id)).find(e => e?.type === "TwinModelInvocationCompleted");
      const runs: any = invocation?.payload.modelRuns;
      if (Array.isArray(runs) && runs.at(-1)?.usedFallback === true && runs.at(-1)?.status === "SUCCEEDED") task.modelStatus = "FALLBACK";
    }
    if (task.startedAt) {
      const elapsed = ((task.completedAt ? Date.parse(task.completedAt) : now) - Date.parse(task.startedAt)) / 1000;
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        task.durationSeconds = elapsed;
        task.slaStatus = task.policyVersion === "LEGACY_UNMEASURED" || task.status === "INTERRUPTED" ? "UNKNOWN"
          : elapsed > task.slaTargetSeconds ? "BREACHED" : task.completedAt ? "MET" : "PENDING";
        if (task.status === "INTERRUPTED") task.durationSeconds = null;
      }
    }
    task.summary = redactOperationalText(task.summary, 2000, true);
  }
  return [...tasks.values()].sort((a, b) => (b.startedAt || b.completedAt || "").localeCompare(a.startedAt || a.completedAt || ""));
}

export type TaskFilters = { role?: string; incidentId?: string; mode?: string; kind?: string; review?: string };
export function filterTasks(tasks: ObservedTask[], filters: TaskFilters = {}, now = Date.now(), windowDays = 30) {
  const cutoff = now - windowDays * 86400000;
  return tasks.filter(t => (!t.completedAt || Date.parse(t.startedAt || t.completedAt) >= cutoff)
    && (!filters.role || t.role === filters.role) && (!filters.incidentId || t.incidentId === filters.incidentId)
    && (!filters.mode || t.mode === filters.mode) && (!filters.kind || t.kind === filters.kind)
    && (!filters.review || (t.review?.verdict || "UNREVIEWED") === filters.review));
}
export function summarizeTasks(tasks: ObservedTask[], policy = observationPolicy()) {
  const count = (fn: (t: ObservedTask) => boolean) => tasks.filter(fn).length;
  const correct = count(t => t.review?.verdict === "CORRECT"), wrong = count(t => t.review?.verdict === "WRONG");
  const inconclusive = count(t => t.review?.verdict === "INCONCLUSIVE");
  const decisions = count(t => !!t.decisionEventId);
  const accuracy = correct + wrong ? correct / (correct + wrong) : null;
  const reviewCoverage = decisions ? (correct + wrong + inconclusive) / decisions : null;
  const slaMet = count(t => t.slaStatus === "MET"), slaBreached = count(t => t.slaStatus === "BREACHED");
  return { total: tasks.length, completed: count(t => t.status === "COMPLETED"), failed: count(t => ["FAILED", "BLOCKED", "INTERRUPTED"].includes(t.status)),
    running: count(t => t.status === "RUNNING"), correct, wrong, inconclusive, unreviewed: decisions - correct - wrong - inconclusive,
    accuracy, reviewCoverage, slaMet, slaBreached, slaUnknown: count(t => t.slaStatus === "UNKNOWN"),
    slaCompliance: slaMet + slaBreached ? slaMet / (slaMet + slaBreached) : null,
    qualityGate: correct + wrong < policy.minimumReviewed ? "INSUFFICIENT_REVIEWS"
      : accuracy! < policy.accuracyTarget || (reviewCoverage || 0) < policy.reviewCoverageTarget ? "BELOW_TARGET" : "MEETS_REVIEW_TARGET" };
}

export function validateReview(input: any, task?: ObservedTask) {
  if (!task || !task.decisionEventId || input.decisionEventId !== task.decisionEventId) throw new Error("A completed task and its exact decision event are required.");
  if (!["CORRECT", "WRONG", "INCONCLUSIVE"].includes(input.verdict)) throw new Error("Select CORRECT, WRONG or INCONCLUSIVE.");
  if (typeof input.reason !== "string" || input.reason.trim().length < 5 || input.reason.length > 4000) throw new Error("Review reason must contain 5 to 4000 characters and identify the validation evidence.");
  if (input.correction !== undefined && (typeof input.correction !== "string" || input.correction.length > 4000)) throw new Error("Correction must be at most 4000 characters.");
  if (input.verdict === "WRONG" && (input.correction || "").trim().length < 5) throw new Error("Wrong decisions require the expected answer or corrective action.");
  if (input.trainingEligible !== undefined && typeof input.trainingEligible !== "boolean") throw new Error("Training eligibility must be a boolean.");
  if (input.trainingEligible && input.verdict === "INCONCLUSIVE") throw new Error("Inconclusive reviews cannot be training examples.");
  return { taskId: task.id, decisionEventId: task.decisionEventId, verdict: input.verdict,
    reason: redactOperationalText(input.reason.trim(), 4000, true), correction: redactOperationalText((input.correction || "").trim(), 4000, true),
    trainingEligible: input.trainingEligible === true, policyVersion: task.policyVersion };
}

/** Gauges are rolling ledger snapshots, not process-lifetime counters. No incident/text labels. */
export function prometheusSnapshot(tasks: ObservedTask[], policy = observationPolicy()) {
  const lines = ["# HELP cloudzero_twin_tasks Recorded work units in the rolling 30 day window, including open work.", "# TYPE cloudzero_twin_tasks gauge",
    "# HELP cloudzero_twin_decisions Latest human verdict per decision; completion is not correctness.", "# TYPE cloudzero_twin_decisions gauge",
    "# HELP cloudzero_twin_sla_tasks Task latency targets; not incident resolution SLA.", "# TYPE cloudzero_twin_sla_tasks gauge",
    "# HELP cloudzero_twin_task_duration_seconds_sum Sum of measured completed task durations in the rolling window.", "# TYPE cloudzero_twin_task_duration_seconds_sum gauge",
    "# TYPE cloudzero_twin_task_duration_seconds_count gauge", "# TYPE cloudzero_twin_model_results gauge"];
  for (const role of ROLES) for (const mode of ["LIVE", "SIMULATION", "UNKNOWN"]) {
    const group = tasks.filter(t => t.role === role && t.mode === mode);
    const labels = `role="${role}",mode="${mode}"`;
    for (const status of ["RUNNING", "COMPLETED", "FAILED", "BLOCKED", "INTERRUPTED"]) lines.push(`cloudzero_twin_tasks{${labels},status="${status}"} ${group.filter(t => t.status === status).length}`);
    for (const verdict of ["CORRECT", "WRONG", "INCONCLUSIVE", "UNREVIEWED"]) lines.push(`cloudzero_twin_decisions{${labels},verdict="${verdict}"} ${group.filter(t => t.decisionEventId && (t.review?.verdict || "UNREVIEWED") === verdict).length}`);
    for (const status of ["MET", "BREACHED", "UNKNOWN", "PENDING"]) lines.push(`cloudzero_twin_sla_tasks{${labels},status="${status}"} ${group.filter(t => t.slaStatus === status).length}`);
    const measured = group.filter(t => t.completedAt && t.durationSeconds !== null);
    lines.push(`cloudzero_twin_task_duration_seconds_sum{${labels}} ${measured.reduce((sum, t) => sum + t.durationSeconds!, 0)}`);
    lines.push(`cloudzero_twin_task_duration_seconds_count{${labels}} ${measured.length}`);
    lines.push(`cloudzero_twin_incidents{${labels}} ${new Set(group.filter(t => !t.incidentId.startsWith("conversation-") && t.incidentId !== "CYBER-FUSION").map(t => t.incidentId)).size}`);
    for (const result of ["GENERATED", "FALLBACK", "UNAVAILABLE", "INVALID_RESPONSE", "NOT_USED"]) lines.push(`cloudzero_twin_model_results{${labels},result="${result}"} ${group.filter(t => t.modelStatus === result).length}`);
    for (const kind of KINDS) lines.push(`cloudzero_twin_task_kind{${labels},kind="${kind}"} ${group.filter(t => t.kind === kind).length}`);
  }
  lines.push(`# TYPE cloudzero_twin_policy_target_seconds gauge`);
  for (const kind of KINDS) lines.push(`cloudzero_twin_policy_target_seconds{kind="${kind}",version="${policy.version}"} ${policy.taskSeconds[kind]}`);
  lines.push(`cloudzero_twin_policy_minimum_reviewed ${policy.minimumReviewed}`, `cloudzero_twin_policy_accuracy_target ${policy.accuracyTarget}`, `cloudzero_twin_policy_coverage_target ${policy.reviewCoverageTarget}`);
  return lines.join("\n") + "\n";
}
