import crypto from "node:crypto";
import { observationPolicy } from "./twin-observability.ts";
import { reasonAboutIncident, type AgentReasoner, type AgentValidationReply } from "./agent-reasoning.ts";
import { validateEvidenceState } from "./evidence-state-guardrail.ts";
import type { IncidentAggregate, IncidentEvidence, ServiceNowIncident } from "../types.ts";
import {
  collaborationPlan, correlateCmdbTarget, diagnosticPlanFor, EngineeringIncidentOrchestrator, redactOperationalText,
  type CommandProxy, type EngineerPersona
} from "./engineering-orchestrator.ts";

type Audit = (type: string, payload: Record<string, unknown>, correlationId: string) => Promise<unknown>;
class AgentExchangeError extends Error {}
/** One bounded collaboration round. Candidate actions are investigation-only, never execution authority. */
export async function collaborateOnIncident(input: {
  incident: IncidentAggregate;
  workflowId: string;
  actorId: string;
  proxy: CommandProxy;
  audit: Audit;
  generate?: AgentReasoner;
  relatedTargets?: Partial<Record<EngineerPersona, ServiceNowIncident>>;
}) {
  const { incident, workflowId, proxy, audit } = input;
  if (!incident.serviceNowIncident || !incident.workflows.some(w => w.id === workflowId && w.incidentId === incident.incidentId)) {
    throw new Error("Collaboration requires an incident-bound diagnostic workflow.");
  }
  if (![incident.incidentId, workflowId].every(id => /^[A-Za-z0-9_.:-]{1,160}$/.test(id) && redactOperationalText(id, 160) === id)) throw new Error("Invalid collaboration identifiers.");
  correlateCmdbTarget(incident.serviceNowIncident);
  if (!proxy.exchangeEvidence) throw new Error("Agent messaging is unavailable; escalate to a human engineer.");
  const plan = collaborationPlan(incident.serviceNowIncident);
  const collaborationId = crypto.randomUUID();
  const policy = observationPolicy();
  await audit("AgentCollaborationStarted", { collaborationId, workflowId, ...plan }, collaborationId);
  const orchestrator = new EngineeringIncidentOrchestrator(proxy);
  // Rebuild the shared view from persisted diagnostic evidence, never arbitrary ticket payloads.
  const evidence: IncidentEvidence[] = incident.evidence.filter(e => e.incidentId === incident.incidentId && e.workflowId === workflowId && e.source === "gRPC Command Proxy");
  const collected: IncidentEvidence[] = [];
  const commands: Array<{ persona: EngineerPersona; objective: string; command: string; status: string; evidenceId: string; output: string }> = [];
  const exchanges: string[] = [];
  const limitations: string[] = [];
  const replies: AgentValidationReply[] = [];
  const participated = new Set<EngineerPersona>([plan.responsiblePersona]);
  const candidateActions = plan.participants.map(persona => ({
    persona, kind: "READ_ONLY_INVESTIGATION", evidenceIds: evidence.map(e => redactOperationalText(e.id, 160)),
    recommendation: persona === "SECURITY" ? "Validate PKI and security findings using an approved read-only playbook."
      : `Corroborate ${persona} observations before proposing a change.`,
    responsiblePersona: plan.responsiblePersona, executable: false
  }));
  const share = async (sender: EngineerPersona, recipient: EngineerPersona, conversation?: Record<string, unknown>) => {
    // Project and redact each value before serialization; never truncate serialized JSON.
    const shared = evidence.slice(-20).map(e => ({
      id: redactOperationalText(e.id, 160), incidentId: incident.incidentId, workflowId,
      summary: redactOperationalText(e.summary, 600), observedAt: e.observedAt,
      persona: redactOperationalText(e.payload?.persona, 40), status: redactOperationalText(e.payload?.status, 40),
      templateId: redactOperationalText(e.payload?.templateId, 80),
      objective: redactOperationalText(e.payload?.objective, 300),
      command: redactOperationalText(e.payload?.commandDisplay, 500),
      output: redactOperationalText(e.payload?.output, 900),
      targetCiId: redactOperationalText(e.payload?.targetCiId, 160),
      integrityHash: e.integrityHash
    }));
    const message = {
      incidentId: incident.incidentId, workflowId, correlationId: crypto.randomUUID(), sender, recipient,
      evidenceJson: JSON.stringify(shared), candidateActionsJson: JSON.stringify(candidateActions.map(a => ({ ...a, evidenceIds: shared.map(e => e.id), ...(conversation && a.persona === sender ? { conversation } : {}) })))
    };
    await audit("AgentEvidenceExchangeRequested", { collaborationId, ...message }, message.correlationId);
    let receipt;
    try {
      receipt = await proxy.exchangeEvidence!(message);
      if (receipt.incidentId !== message.incidentId || receipt.workflowId !== workflowId || receipt.correlationId !== message.correlationId || receipt.recipient !== recipient || !["ACKNOWLEDGED", "SIMULATED"].includes(receipt.status) || (incident.operatingMode === "LIVE" && receipt.status !== "ACKNOWLEDGED")) {
        throw new Error("Agent receipt binding or execution mode mismatch.");
      }
    } catch {
      await audit("AgentEvidenceExchangeFailed", { collaborationId, workflowId, sender, recipient }, message.correlationId);
      throw new AgentExchangeError("Agent evidence exchange failed; abstain and escalate to a human engineer.");
    }
    await audit("AgentEvidenceExchanged", { collaborationId, ...message, receipt }, message.correlationId);
    participated.add(sender);
    participated.add(recipient);
    exchanges.push(`${sender} -> ${recipient}: ${shared.map(e => e.id).join(", ") || "initial investigation request"} (${receipt.status})`);
  };
  try {
  for (const persona of plan.participants) {
    const requestId = crypto.randomUUID();
    const question = `Validate the ${persona} side of incident ${incident.incidentId}: ${redactOperationalText(incident.serviceNowIncident.shortDescription, 600)}. Review related maintenance and report observations, missing evidence, and the next check to ${plan.responsiblePersona}.`;
    const request = { messageId: requestId, incidentId: incident.incidentId, workflowId, sender: plan.responsiblePersona, recipient: persona, kind: "INVESTIGATION_REQUEST", question };
    await audit("AgentInvestigationRequested", { collaborationId, ...request, operatingMode: incident.operatingMode,
      slaTargetSeconds: policy.taskSeconds.A2A, policyVersion: policy.version }, requestId);
    if (persona !== plan.responsiblePersona) await share(plan.responsiblePersona, persona, request);
    const replyToOwner = async () => {
      const reply = await reasonAboutIncident({ incident, workflowId, sender: persona, recipient: plan.responsiblePersona,
        requestId, question, evidence, priorReplies: replies, generate: input.generate });
      if (persona !== plan.responsiblePersona) await share(persona, plan.responsiblePersona, { ...reply });
      await audit("AgentValidationReplied", { collaborationId, ...reply }, reply.messageId);
      replies.push(reply);
    };
    const context = `${incident.serviceNowIncident.shortDescription} ${incident.serviceNowIncident.cmdbName} ${JSON.stringify(incident.serviceNowIncident.metadata || {})}`;
    // Kubernetes templates must never be dispatched to an Azure VM/ISE or an unspecified namespace.
    const namespace = String(incident.serviceNowIncident.metadata?.namespace || "");
    const demoOnlyUnavailable = ['CLOUDOPS','MIDDLEWARE'].includes(persona) && !(incident.incidentId.startsWith('DEMO-') && incident.serviceNowIncident.metadata?.source === 'A2A_DEMO_DATABASE');
    const diagnosticPlan = diagnosticPlanFor(persona, incident.serviceNowIncident);
    if (!diagnosticPlan.length || demoOnlyUnavailable || ((persona === "CLOUDOPS_DEVOPS" || persona === "DEVOPS") && (!/kubernetes|k8s/i.test(context) || !/^[A-Za-z0-9_.-]{1,80}$/.test(namespace)))) {
      limitations.push(`${persona}: no applicable read-only cloud template or verified namespace; human diagnostics required.`);
      await audit("AgentDiagnosticAbstained", { collaborationId, workflowId, persona, reason: "No applicable cloud template or namespace." }, collaborationId);
      await replyToOwner();
      continue;
    }
    for (const check of diagnosticPlan) {
      const templateId = check.templateId;
      await audit("AgentDiagnosticRequested", { collaborationId, workflowId, persona, templateId, objective: check.objective, parameters: check.parameters }, collaborationId);
      let result;
      try {
        result = await orchestrator.diagnose({ incident, workflowId, actorId: input.actorId, templateId,
          collaboratingPersona: persona, relatedTarget: input.relatedTargets?.[persona], parameters: check.parameters, objective: check.objective });
      } catch {
        limitations.push(`${persona}: ${templateId} diagnostic failed; human investigation required.`);
        await audit("AgentDiagnosticFailed", { collaborationId, workflowId, persona, templateId, objective: check.objective }, collaborationId);
        continue;
      }
      await audit("AgentDiagnosticEvidenceCollected", { collaborationId, workflowId, evidence: result.evidence }, collaborationId);
      evidence.push(result.evidence);
      collected.push(result.evidence);
      participated.add(persona);
      commands.push({ persona, objective: check.objective, command: result.commandDisplay,
        status: result.response.status, evidenceId: result.evidence.id, output: result.response.output.slice(0, 160) });
      if (result.response.status !== "SUCCEEDED") limitations.push(`${persona}: ${result.response.status} evidence from ${templateId} is not live verification.`);
    }
    await replyToOwner();
  }
  // Fan out the final common snapshot, so early participants receive later evidence too.
  for (const persona of plan.participants) {
    if (persona !== plan.responsiblePersona) await share(plan.responsiblePersona, persona);
  }
  } catch (error) {
    if (!(error instanceof AgentExchangeError)) throw error;
    limitations.push(error.message);
  }
  const ownerTaskId = crypto.randomUUID();
  await audit("AgentOwnerAssessmentStarted", { taskId: ownerTaskId, collaborationId, workflowId, sender: plan.responsiblePersona,
    operatingMode: incident.operatingMode, slaTargetSeconds: policy.taskSeconds.OWNER_ASSESSMENT, policyVersion: policy.version }, ownerTaskId);
  const ownerAssessment = await reasonAboutIncident({ incident, workflowId, sender: plan.responsiblePersona, recipient: plan.responsiblePersona,
    requestId: ownerTaskId, question: "Synthesize delivered agent replies. Identify cross-team dependencies and the next validation step; do not infer causation from maintenance timing.",
    evidence, priorReplies: replies, ownerAssessment: true, generate: input.generate });
  await audit("AgentOwnerAssessmentCompleted", { taskId: ownerTaskId, collaborationId, ...ownerAssessment }, ownerAssessment.messageId);
  const recommendation = "Abstain from remediation and escalate to a human engineer. Read-only observations do not establish causation or a verified safe change.";
  // The owner model's assessment is advisory. Deterministic evidence policy
  // remains authoritative for RCA state, remediation eligibility and A2A participation.
  const evidenceState = validateEvidenceState({
    evidence: evidence.map(item => ({ id: item.id, source: item.source, status: String(item.payload?.status || ""), summary: item.summary, payload: item.payload })),
    modelProposedState: ownerAssessment.causalStatus,
    modelRemediation: recommendation,
    requiredParticipants: plan.participants.filter(persona => persona !== plan.responsiblePersona)
  });
  await audit("EvidenceStateValidated", { collaborationId, workflowId, ...evidenceState }, ownerTaskId);
  const workNote = redactOperationalText([
    "CLOUDZERO A2A COLLABORATION WORK NOTE",
    `Incident: ${incident.incidentId}`,
    `Workflow: ${workflowId}`,
    "",
    "CHECKS COMPLETED",
    ...(commands.length ? commands.map(check =>
      `- ${check.persona} — ${check.objective}\n  Command: ${check.command}\n  Result: ${check.status}\n  Evidence: ${check.evidenceId}\n  Output summary: ${check.output}`
    ) : ["- No diagnostic command completed successfully."]),
    "",
    "TEAM COMMUNICATION",
    ...(replies.length ? replies.map(reply => `- ${reply.sender} reported to ${reply.recipient}: ${reply.assessment} Next check: ${reply.nextCheck}`) : ["- No team validation reply was recorded."]),
    ...(exchanges.length ? exchanges.map(exchange => `- Evidence was shared between participating teams. ${exchange.replace(/diagnostic-[A-Za-z0-9-]+/g, "recorded evidence")}`) : []),
    "",
    "CONCLUSION",
    `- Owner assessment: ${ownerAssessment.assessment}`,
    `- Final verdict: ${recommendation}`,
    `- Evidence status: ${replies.some(reply => reply.validationStatus === "NEEDS_EVIDENCE") ? "Additional evidence is required." : "Evidence was collected for review."}`,
    "",
    "OWNERSHIP AND NEXT ACTION",
    `- Responsible remediation team: ${plan.responsiblePersona}. Closure owner: ${plan.closurePersona}.`,
    "- Immediate action: A human engineer must review the evidence, approve any change, define rollback, and collect post-change verification.",
    `- Limitations: ${limitations.join(" ") || "No additional limitations recorded."}`
  ].join("\n"), 4_000);
  const result = { collaborationId, workflowId, ...plan, participatedPersonas: [...participated], disposition: "ABSTAIN" as const, recommendation, candidateActions, evidenceState,
    evidence: collected, replies, ownerAssessment, workNote, remediationExecuted: false as const };
  await audit("AgentCollaborationCompleted", { ...result }, collaborationId);
  return result;
}
