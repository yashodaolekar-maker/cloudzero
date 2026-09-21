import type { IncidentDomainEvent } from "./incident-runtime.ts";
import type { ObservedTask } from "./twin-observability.ts";
import { safePayload, observationPolicy } from "./twin-observability.ts";

export function validateExperience(input: any, task?: ObservedTask) {
  if (!task || task.status !== "COMPLETED") throw new Error("Experience feedback requires a completed recorded task.");
  for (const field of ["helpfulness", "clarity", "trust", "ease"]) {
    if (!Number.isInteger(input[field]) || input[field] < 1 || input[field] > 5) throw new Error("Rate each experience dimension from 1 to 5.");
  }
  for (const field of ["helpedResolve", "firstContactResolved"]) if (input[field] !== null && input[field] !== undefined && typeof input[field] !== "boolean") throw new Error("Resolution feedback must be yes, no or not applicable.");
  if (input.firstContactResolved === true && input.helpedResolve !== true) throw new Error("First-contact resolution requires reporting that the twin helped resolve the issue.");
  if (input.comment !== undefined && (typeof input.comment !== "string" || input.comment.length > 4000)) throw new Error("Experience comment must be at most 4000 characters.");
  return safePayload({ taskId: task.id, decisionEventId: task.decisionEventId, helpfulness: input.helpfulness, clarity: input.clarity, trust: input.trust,
    ease: input.ease, helpedResolve: input.helpedResolve ?? null, firstContactResolved: input.firstContactResolved ?? null, comment: input.comment || "", workflowId: task.workflowId });
}
export function latestExperiences(events: IncidentDomainEvent[], tasks: ObservedTask[]) {
  const allowed = new Map(tasks.filter(t => t.status === "COMPLETED").map(t => [`${t.incidentId}\0${t.id}`, t]));
  const latest = new Map<string, IncidentDomainEvent>();
  for (const e of events) if (e.type === "TwinExperienceRated") {
    const task = allowed.get(`${e.incidentId}\0${e.payload.taskId}`);
    if (task && task.decisionEventId === e.payload.decisionEventId) {
      try { validateExperience(e.payload, task); latest.set(`${task.id}\0${e.actorId}`, e); } catch { /* Invalid legacy records do not become ratings. */ }
    }
  }
  return [...latest.values()];
}
export function summarizeExperience(events: IncidentDomainEvent[], tasks: ObservedTask[], policy = observationPolicy()) {
  const responses = latestExperiences(events, tasks);
  const mean = (key: string) => responses.length ? responses.reduce((sum, e) => sum + Number(e.payload[key]), 0) / responses.length : null;
  const average = (e: IncidentDomainEvent) => ["helpfulness", "clarity", "trust", "ease"].reduce((sum, field) => sum + Number(e.payload[field]), 0) / 4;
  const ratedTasks = new Set(responses.map(e => e.payload.taskId)).size;
  const completed = tasks.filter(t => t.status === "COMPLETED").length;
  const coverage = completed ? ratedTasks / completed : null;
  const favorableRate = responses.length ? responses.filter(e => average(e) >= 4).length / responses.length : null;
  const yesRate = (field: string) => { const eligible = responses.filter(e => typeof e.payload[field] === "boolean"); return eligible.length ? eligible.filter(e => e.payload[field] === true).length / eligible.length : null; };
  return { responses: responses.length, respondents: new Set(responses.map(e => e.actorId)).size, ratedTasks,
    coverage, score: responses.length ? responses.reduce((sum, e) => sum + (average(e) - 1) / 4 * 100, 0) / responses.length : null,
    favorableRate, helpfulness: mean("helpfulness"), clarity: mean("clarity"), trust: mean("trust"), ease: mean("ease"),
    helpedResolveRate: yesRate("helpedResolve"), firstContactResolutionRate: yesRate("firstContactResolved"),
    attainment: responses.length < policy.experience.minimumResponses ? "INSUFFICIENT_FEEDBACK"
      : favorableRate! < policy.experience.favorableTarget || (coverage || 0) < policy.experience.coverageTarget ? "BELOW_TARGET" : "MEETS_XLA_TARGET" };
}
export type IncidentSla = {
  incidentId: string; priority: string; mode: string; policyVersion: string; startedAt: string | null; responseAt: string | null; resolvedAt: string | null;
  responseTargetSeconds: number | null; resolutionTargetSeconds: number | null; responseSeconds: number | null; resolutionSeconds: number | null;
  responseStatus: string; resolutionStatus: string; clockBasis: string;
};
export function projectIncidentSlas(events: IncidentDomainEvent[], tasks: ObservedTask[], now = Date.now()): IncidentSla[] {
  const grouped = new Map<string, IncidentDomainEvent[]>();
  for (const e of events) { const group = grouped.get(e.incidentId) || []; group.push(e); grouped.set(e.incidentId, group); }
  const ids = new Set(tasks.filter(t => !t.incidentId.startsWith("conversation-") && t.incidentId !== "CYBER-FUSION").map(t => t.incidentId));
  for (const e of events) if (e.type === "TwinIncidentSlaStarted") ids.add(e.incidentId);
  return [...ids].map(incidentId => {
    const history = grouped.get(incidentId) || [];
    let startIndex = -1;
    history.forEach((e, index) => { if (e.type === "TwinIncidentSlaStarted") startIndex = index; });
    const start = startIndex >= 0 ? history[startIndex] : undefined;
    const p: any = start?.payload || {};
    const later = start ? history.slice(startIndex + 1) : [];
    const response = later.find(e => ["AgentValidationReplied", "AgentOwnerAssessmentCompleted", "EngineeringDiagnosticCompleted", "TwinTaskCompleted"].includes(e.type));
    const resolution = later.find(e => e.type === "LifecycleTransitioned" && e.payload.to === "RESOLVED"
      || e.type === "ServiceNowIncidentIngested" && (e.payload.incident as any)?.status === "Resolved");
    const clockStart = typeof p.clockStartedAt === "string" && Number.isFinite(Date.parse(p.clockStartedAt)) ? p.clockStartedAt : null;
    const resolvedCandidate = (resolution?.payload.incident as any)?.metadata?.resolvedAt;
    const resolvedAt = resolution && typeof resolvedCandidate === "string" && Number.isFinite(Date.parse(resolvedCandidate)) ? new Date(resolvedCandidate).toISOString() : resolution?.occurredAt || null;
    const duration = (end?: IncidentDomainEvent) => {
      const value = clockStart ? ((end === resolution && resolvedAt ? Date.parse(resolvedAt) : end ? Date.parse(end.occurredAt) : now) - Date.parse(clockStart)) / 1000 : NaN;
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const reopened = resolution && later.slice(later.indexOf(resolution) + 1).some(e => e.type === 'LifecycleTransitioned' && e.payload.from === 'RESOLVED' && e.payload.to !== 'RESOLVED'
      || e.type === 'ServiceNowIncidentIngested' && (e.payload.incident as any)?.status !== 'Resolved');
    const state = (end: IncidentDomainEvent | undefined, target: unknown) => reopened || !clockStart || duration(end) === null || !Number.isFinite(target) || Number(target) <= 0 ? "UNKNOWN"
      : duration(end)! > Number(target) ? "BREACHED" : end ? "MET" : "PENDING";
    return { incidentId, priority: p.priority || "UNKNOWN", mode: p.dataOrigin || p.operatingMode || "UNKNOWN", policyVersion: p.policyVersion || "LEGACY_UNMEASURED",
      startedAt: clockStart, responseAt: response?.occurredAt || null, resolvedAt,
      responseTargetSeconds: p.responseTargetSeconds || null, resolutionTargetSeconds: p.resolutionTargetSeconds || null,
      responseSeconds: duration(response), resolutionSeconds: duration(resolution), responseStatus: state(response, p.responseTargetSeconds), resolutionStatus: state(resolution, p.resolutionTargetSeconds),
      clockBasis: reopened ? "Incident reopened; re-opened-ticket SLA policy is not agreed. Prior resolution is retained but current compliance is UNKNOWN."
        : "Ticket openedAt to recorded resolution, 24x7 wall time; no pauses. Resolution uses ServiceNow resolved_at when present, otherwise the time resolution was recorded locally. First response is observed but has no agreed SLA target. Missing or assumed openedAt is UNKNOWN." };
  });
}
