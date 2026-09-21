import { useMemo } from "react";
import type { CrossSiloWorkflow, DigitalTwinAgent, HITLApproval, IncidentEvidence, ServiceNowIncident, SystemLog, WorkflowInstance } from "../types";
import { compileCollaboration, domainOf, normalizeDashboardEvents, projectEvidence } from "../components/dashboard/projection";

export type InvestigationTwinState = "AVAILABLE" | "STARTING" | "WAITING_FOR_TOOL" | "WAITING_FOR_TWIN" | "EVIDENCE_RECEIVED" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "NOT_REQUIRED";
export type HypothesisState = "INSUFFICIENT_EVIDENCE" | "SUSPECTED" | "SUPPORTED" | "CONFIRMED" | "ELIMINATED" | "UNKNOWN";
export interface InvestigationTimelineEvent { id: string; at?: string; title: string; detail: string; kind: "INCIDENT" | "EVIDENCE" | "GUARDRAIL" | "APPROVAL" | "VERIFICATION" | "A2A" | "SYSTEM"; raw?: unknown }
export interface InvestigationViewModel {
  incident?: ServiceNowIncident;
  lifecycle: { backendState: string; displayState: string; startedAt?: string; elapsedMinutes?: number };
  twins: Array<{ id: string; name: string; state: InvestigationTwinState; specialty?: string; currentTask?: string; participating: boolean }>;
  timeline: InvestigationTimelineEvent[]; evidence: IncidentEvidence[];
  hypotheses: Array<{ id: string; title: string; state: HypothesisState; detail: string; source: "DERIVED" | "UNAVAILABLE" }>;
  guardrailDecisions: Array<{ id: string; title: string; detail: string; disposition: string; raw?: unknown }>;
  collaboration: Array<{ id: string; from: string; to: string; detail: string; raw?: unknown }>;
  rca: { title?: string; state: HypothesisState; owner?: string; evidenceCount: number; validatedState: HypothesisState };
  remediation: { proposed?: string; validatedDisposition: string; rollback?: string; verification?: string };
  approval?: HITLApproval; execution: { state: string; detail: string }; verification: { state: string; detail: string };
}

const roster = ["Network", "Windows", "Linux", "Database", "Middleware", "CloudOps", "DevOps", "Cyber"] as const;
const text = (value: unknown) => typeof value === "string" ? value : "";
const display = (value: string) => value === "UNKNOWN" ? "WAITING FOR INVESTIGATION" : value.replaceAll("_", " ");
const titleFor = (type: string, payload: Record<string, unknown>) => {
  const twin = text(payload.persona || payload.sender) || "Digital Twin";
  const titles: Record<string, string> = { EngineeringDiagnosticWorkflowPrepared: "Investigation plan prepared", AgentCollaborationStarted: "CloudZero collaboration started", AgentInvestigationRequested: `${twin} requested a validation`, AgentDiagnosticRequested: `${twin} diagnostic started`, AgentDiagnosticEvidenceCollected: "Diagnostic evidence received", AgentEvidenceExchangeRequested: "Evidence exchange requested", AgentEvidenceExchanged: "Evidence returned through A2A", AgentDiagnosticAbstained: `${twin} needs more evidence`, AgentDiagnosticFailed: `${twin} diagnostic failed`, AgentValidationReplied: `${twin} validation returned`, AgentOwnerAssessmentStarted: "CloudZero correlation started", AgentOwnerAssessmentCompleted: "CloudZero correlation completed", EvidenceStateValidated: "Evidence state validated", AgentCollaborationCompleted: "Cross-domain investigation completed", DemoInvestigationCompleted: "Demo investigation completed", DemoInvestigationFailed: "Demo investigation failed", TwinModelInvocationCompleted: "Twin reasoning completed" };
  return titles[type] || type.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
};
const detailFor = (type: string, payload: Record<string, unknown>) => {
  const evidence = payload.evidence && typeof payload.evidence === "object" ? payload.evidence as IncidentEvidence : undefined;
  const value = [evidence?.payload?.objective, payload.objective, payload.finding, payload.findingSummary, payload.reason, payload.question, payload.message].find(item => typeof item === "string" && item.trim());
  if (typeof value === "string") return value;
  if (type === "AgentDiagnosticEvidenceCollected" && evidence) return projectEvidence(evidence).summary;
  if (type === "AgentEvidenceExchangeRequested") return "CloudZero requested incident-bound evidence from the target Twin.";
  if (type === "AgentEvidenceExchanged") return "The target Twin returned evidence with matching incident, workflow and correlation identifiers.";
  if (type === "EvidenceStateValidated") return `The deterministic guardrail recorded ${text(payload.validatedEvidenceState) || "an evidence decision"}.`;
  return "CloudZero recorded this incident-bound operation.";
};

export function useInvestigationViewModel(input: { incident?: ServiceNowIncident; agents: DigitalTwinAgent[]; workflows: WorkflowInstance[]; approvals: HITLApproval[]; incidents: ServiceNowIncident[]; systemLogs: SystemLog[]; crossSiloWorkflows: CrossSiloWorkflow[]; evidence?: IncidentEvidence[]; rawEvents?: Array<Record<string, unknown>> }): InvestigationViewModel {
  return useMemo(() => {
    const incident = input.incident, incidentId = incident?.id;
    const workflows = input.workflows.filter(item => Boolean(incidentId) && item.incidentId === incidentId);
    const crossSilo = input.crossSiloWorkflows.filter(item => Boolean(incidentId) && item.incidentId === incidentId);
    const events = incidentId ? normalizeDashboardEvents(input.rawEvents || [], incidentId) : [];
    const evidenceMap = new Map<string, IncidentEvidence>();
    const addEvidence = (candidate: unknown) => { if (!candidate || typeof candidate !== "object") return; const item = candidate as IncidentEvidence; if (item.incidentId === incidentId && typeof item.id === "string" && typeof item.source === "string") evidenceMap.set(item.id, item); };
    (input.evidence || []).forEach(addEvidence);
    events.forEach(event => { if (["AgentDiagnosticEvidenceCollected", "ExternalAgentEvidenceCollected", "EvidenceCollected"].includes(event.type)) addEvidence(event.payload.evidence); if (event.type === "AgentCollaborationCompleted" && Array.isArray(event.payload.evidence)) event.payload.evidence.forEach(addEvidence); });
    const evidence = [...evidenceMap.values()].map(item => ({ ...item })).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const projected = evidence.map(projectEvidence), collaborations = compileCollaboration(events, projected);
    evidence.forEach((item, index) => { item.summary = projected[index]?.summary || "Recorded diagnostic evidence."; });
    const participants = new Set<string>();
    workflows.forEach(workflow => { const domain = domainOf(workflow.agentId) || domainOf(input.agents.find(agent => agent.id === workflow.agentId)?.department); if (domain) participants.add(domain); });
    events.forEach(event => [event.payload.persona, event.payload.sender, event.payload.recipient].forEach(value => { const domain = domainOf(value); if (domain) participants.add(domain); }));
    evidence.forEach(item => { const domain = domainOf(item.payload?.persona); if (domain) participants.add(domain); });
    const owner = domainOf(incident?.assignedTo); if (owner) participants.add(owner);
    const roundComplete = events.some(event => ["AgentCollaborationCompleted", "DemoInvestigationCompleted"].includes(event.type));
    const twins = roster.map(name => {
      const agent = input.agents.find(candidate => domainOf(candidate.department) === name || domainOf(candidate.id) === name), participating = participants.has(name);
      const own = events.filter(event => [event.payload.persona, event.payload.sender, event.payload.recipient].some(value => domainOf(value) === name));
      const failure = [...own].reverse().find(event => /Failed|Blocked|TimedOut/.test(event.type)), reply = [...own].reverse().find(event => event.type === "AgentValidationReplied"), diagnostic = [...own].reverse().find(event => event.type.startsWith("AgentDiagnostic")), request = [...own].reverse().find(event => event.type === "AgentInvestigationRequested");
      const state: InvestigationTwinState = !participating ? (agent ? "AVAILABLE" : "NOT_REQUIRED") : failure ? (/TimedOut/.test(failure.type) ? "TIMED_OUT" : "FAILED") : reply || roundComplete ? "COMPLETED" : diagnostic?.type === "AgentDiagnosticEvidenceCollected" ? "EVIDENCE_RECEIVED" : diagnostic?.type === "AgentDiagnosticRequested" ? "WAITING_FOR_TOOL" : request ? "WAITING_FOR_TWIN" : "STARTING";
      const domainEvidence = projected.filter(item => item.domain === name).at(-1);
      const currentTask = failure ? text(failure.payload.reason) || "The recorded operation failed." : reply ? domainEvidence?.summary || "Validation response recorded." : diagnostic ? text(diagnostic.payload.objective) || domainEvidence?.summary || "Running an incident-bound diagnostic check." : request ? text(request.payload.question) || "Validation requested." : undefined;
      return { id: name.toLowerCase(), name, state, specialty: agent?.specialty, currentTask, participating };
    });
    const timeline: InvestigationTimelineEvent[] = [];
    if (incident) timeline.push({ id: `incident-${incident.id}`, at: incident.openedAt, title: "Incident detected", detail: incident.shortDescription, kind: "INCIDENT", raw: incident });
    events.forEach(event => { const kind: InvestigationTimelineEvent["kind"] = /Evidence|Diagnostic/.test(event.type) ? "EVIDENCE" : /Collaboration|Investigation|ValidationReplied/.test(event.type) ? "A2A" : /Recommendation|Guard|EvidenceStateValidated/.test(event.type) ? "GUARDRAIL" : /Approval/.test(event.type) ? "APPROVAL" : /Verification/.test(event.type) ? "VERIFICATION" : "SYSTEM"; timeline.push({ id: event.id, at: event.timestamp, title: titleFor(event.type, event.payload), detail: detailFor(event.type, event.payload), kind, raw: event }); });
    input.systemLogs.filter(log => Boolean(incidentId) && log.message.includes(incidentId!)).slice(-8).forEach(log => timeline.push({ id: log.id, at: log.timestamp, title: log.source, detail: log.message, kind: log.level === "SECURITY" ? "GUARDRAIL" : "SYSTEM", raw: log }));
    timeline.sort((a, b) => (a.at || "").localeCompare(b.at || "")); const seen = new Set<string>(); const readable = timeline.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(-40);
    const validStates = new Set<HypothesisState>(["INSUFFICIENT_EVIDENCE", "SUSPECTED", "SUPPORTED", "CONFIRMED", "ELIMINATED"]);
    const hypotheses = projected.flatMap(item => { const match = item.effect?.match(/(?:Simulation|Recorded) observation:\s*(.+?) hypothesis (INSUFFICIENT_EVIDENCE|SUSPECTED|SUPPORTED|CONFIRMED|ELIMINATED)$/i); if (!match) return []; const state = match[2].toUpperCase() as HypothesisState; return validStates.has(state) ? [{ id: `hypothesis-${item.id}`, title: `${match[1]} hypothesis`, state, detail: `${item.domain || item.source} · ${item.simulated ? "persisted simulation evidence" : "persisted diagnostic evidence"}`, source: "DERIVED" as const }] : []; });
    const leading = hypotheses.find(item => item.state === "CONFIRMED") || hypotheses.find(item => item.state === "SUPPORTED") || hypotheses.find(item => item.state === "SUSPECTED");
    const decision = [...events].reverse().find(event => event.type === "EvidenceStateValidated"), decisionState = text(decision?.payload.validatedEvidenceState) as HypothesisState, validatedState: HypothesisState = validStates.has(decisionState) ? decisionState : "UNKNOWN";
    const guardrails = events.filter(event => event.type === "EvidenceStateValidated" || /Guard|Recommendation/.test(event.type)).map(event => ({ id: event.id, title: titleFor(event.type, event.payload), detail: detailFor(event.type, event.payload), disposition: text((event.payload.remediation as Record<string, unknown> | undefined)?.disposition) || "RECORDED", raw: event }));
    const approval = input.approvals.find(item => item.incidentId === incidentId || workflows.some(workflow => workflow.id === item.workflowId)), remediation = crossSilo[0];
    const failed = events.some(event => /Failed|Blocked|TimedOut/.test(event.type)), backendState = incident?.status === "Resolved" ? "RESOLVED" : failed ? "FAILED" : roundComplete ? "INVESTIGATION_COMPLETED" : workflows.some(item => item.status === "ACTIVE") ? "INVESTIGATING" : events.length ? "STARTING" : "UNKNOWN";
    return { incident, lifecycle: { backendState, displayState: display(backendState), startedAt: incident?.openedAt, elapsedMinutes: incident?.elapsedMinutes }, twins, timeline: readable, evidence, hypotheses, guardrailDecisions: guardrails, collaboration: collaborations.map(step => ({ id: step.id, from: step.sourceTwin, to: step.targetTwin, detail: step.plainEnglishResult || step.plainEnglishRequest, raw: step.raw })), rca: { title: leading?.title, state: leading?.state || "UNKNOWN", owner: incident?.assignedTo, evidenceCount: evidence.length, validatedState }, remediation: { proposed: remediation?.recommendedAction, validatedDisposition: text((decision?.payload.remediation as Record<string, unknown> | undefined)?.disposition) || (remediation?.recommendedAction ? "REVIEW REQUIRED" : "NOT AVAILABLE"), rollback: remediation?.rollbackPayload, verification: remediation?.executionLogs?.join(" ") }, approval, execution: { state: remediation?.status === "EXECUTING" ? "EXECUTING" : "NOT STARTED", detail: remediation?.executionLogs?.at(-1) || "No execution has been simulated." }, verification: { state: incident?.status === "Resolved" ? "RECORDED_RESOLVED" : "PENDING", detail: incident?.status === "Resolved" ? "The ticket is resolved; technical verification must be reviewed separately." : "Verification pending." } };
  }, [input]);
}
