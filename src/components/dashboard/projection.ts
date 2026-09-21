import type { DigitalTwinAgent, IncidentEvidence, ServiceNowIncident } from '../../types';
import type { CollaborationStep, DashboardEvent, DashboardEvidence, DashboardExecution, DashboardInput, DashboardModel, DashboardOperation, TwinDomain } from './model';

export const DOMAINS: TwinDomain[] = ['Network', 'Windows', 'Linux', 'Database', 'Middleware', 'CloudOps', 'DevOps', 'Cyber'];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const unique = <T,>(items: T[]) => [...new Set(items)];
const states = new Set(['INSUFFICIENT_EVIDENCE', 'SUSPECTED', 'SUPPORTED', 'CONFIRMED', 'ELIMINATED']);
const domainAliases: Record<string, TwinDomain> = { NETWORK: 'Network', NETWORKING: 'Network', NRE: 'Network', WINDOWS: 'Windows', LINUX: 'Linux', DATABASE: 'Database', DBA: 'Database', MIDDLEWARE: 'Middleware', CLOUDOPS: 'CloudOps', DEVOPS: 'DevOps', SECURITY: 'Cyber', CYBER: 'Cyber' };

export function domainOf(value: unknown): TwinDomain | undefined {
  return domainAliases[str(value).toUpperCase().replace(/^(AGENT-|DIGITAL-TWIN-)/, '').replace(/ TWIN$/, '')];
}
const agentDomain = (agent?: DigitalTwinAgent) => domainOf(agent?.department) || domainOf(agent?.id);
const friendly = (value: unknown) => domainOf(value) || str(value) || 'Unreported Twin';
const plain = (value: unknown, fallback: string) => {
  const text = str(value).trim();
  // Serialized payloads belong in technical details, never the narrative surface.
  return !text || /[{}]|```/.test(text) ? fallback : text;
};
export function normalizeDashboardEvents(values: unknown, incidentId: string): DashboardEvent[] {
  if (!Array.isArray(values)) return [];
  return values.map(record).filter(event => typeof event.id === 'string' && typeof event.type === 'string' && event.incidentId === incidentId)
    .map(event => ({ id: str(event.id), type: str(event.type), timestamp: str(event.occurredAt) || str(event.timestamp), incidentId, correlationId: str(event.correlationId), payload: record(event.payload) }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function observation(evidence: IncidentEvidence): Record<string, unknown> & { observations: Record<string, unknown> } {
  try {
    const parsed = record(JSON.parse(str(evidence.payload?.output)));
    // This is the structured diagnostic output, not an agent's prose assessment.
    return { ...parsed, observations: record(parsed.observations) };
  } catch { return { observations: {} as Record<string, unknown> }; }
}

export function projectEvidence(item: IncidentEvidence): DashboardEvidence {
  const output = observation(item);
  const observations = output.observations;
  const effects = Object.entries(observations).filter(([key, value]) => /Hypothesis$/.test(key) && states.has(str(value))).map(([key, value]) => `${key.replace(/Hypothesis$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')} hypothesis ${value}`);
  const simulated = item.payload?.status === 'SIMULATED' || output.dataOrigin === 'SIMULATION' || item.provenance?.dataOrigin === 'SIMULATION';
  return {
    id: item.id, incidentId: item.incidentId, workflowId: item.workflowId, domain: domainOf(item.payload?.persona), source: item.source,
    summary: plain(observations.finding, plain(item.summary, plain(item.payload?.objective, 'Diagnostic output recorded; expand technical check.'))),
    observedAt: item.observedAt, status: str(item.payload?.status) || 'RECORDED', simulated,
    command: str(item.payload?.commandDisplay) || undefined, output: str(item.payload?.output) || undefined,
    effect: effects.length ? `${simulated ? 'Simulation observation: ' : 'Recorded observation: '}${effects.join('; ')}` : undefined, raw: item
  };
}

export function collectEvidence(input: DashboardInput, incidentId: string): DashboardEvidence[] {
  const records = new Map<string, IncidentEvidence>();
  const add = (value: unknown) => {
    const item = record(value);
    if (typeof item.id === 'string' && item.incidentId === incidentId && typeof item.source === 'string' && typeof item.summary === 'string') records.set(item.id, item as unknown as IncidentEvidence);
  };
  input.aggregates?.find(item => item.incidentId === incidentId)?.evidence.forEach(add);
  for (const event of input.eventsByIncident[incidentId]?.events || []) {
    if (['AgentDiagnosticEvidenceCollected', 'EngineeringDiagnosticCompleted', 'EvidenceCollected'].includes(event.type)) add(event.payload.evidence);
    if (event.type === 'AgentCollaborationCompleted' && Array.isArray(event.payload.evidence)) event.payload.evidence.forEach(add);
  }
  return [...records.values()].map(projectEvidence).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

/** Exact incident/workflow/message binding only. Similar text or nearby timestamps are not correlation. */
export function compileCollaboration(events: DashboardEvent[], evidence: DashboardEvidence[]): CollaborationStep[] {
  const requests = events.filter(event => event.type === 'AgentInvestigationRequested' && str(event.payload.messageId) && str(event.payload.sender) && str(event.payload.recipient));
  return requests.map(request => {
    const p = request.payload;
    const replies = events.filter(event => event.type === 'AgentValidationReplied' && event.incidentId === request.incidentId && event.payload.workflowId === p.workflowId && event.payload.inReplyTo === p.messageId && event.payload.sender === p.recipient && event.payload.recipient === p.sender);
    const reply = replies.at(-1);
    const ids = strings(reply?.payload.evidenceIds);
    const returned = evidence.filter(item => item.incidentId === request.incidentId && item.workflowId === p.workflowId && ids.includes(item.id));
    const checkDescriptions = unique(returned.map(item => plain(observation(item.raw).observations.check, plain(item.raw.payload?.objective, 'Recorded domain validation'))));
    const requestedCheck = checkDescriptions.join('; ') || plain(p.question, 'Domain validation; detailed request unavailable');
    const sourceTwin = friendly(p.sender);
    const targetTwin = friendly(p.recipient);
    const result = unique(returned.map(item => item.summary)).join(' ');
    return {
      id: str(p.messageId), incidentId: request.incidentId || str(p.incidentId), workflowId: str(p.workflowId), sourceTwin, targetTwin, requestedCheck,
      status: reply ? 'RETURNED' : 'REQUESTED', requestTime: request.timestamp, responseTime: reply?.timestamp,
      plainEnglishRequest: sourceTwin === targetTwin ? `${sourceTwin} is validating its own domain: ${requestedCheck}` : `${sourceTwin} requested ${targetTwin} validation: ${requestedCheck}`,
      plainEnglishResult: reply ? result ? `${returned.some(item => item.simulated) ? 'Simulation: ' : ''}${result}` : 'Reply recorded; no linked diagnostic observation available.' : undefined,
      evidenceIds: returned.map(item => item.id), validatedEffect: unique(returned.map(item => item.effect).filter(Boolean)).join('; ') || undefined,
      nextCheck: plain(reply?.payload.nextCheck, '') || undefined, raw: { request, ...(reply ? { response: reply } : {}) }
    } as CollaborationStep;
  });
}

function validatedState(events: DashboardEvent[], workflowId?: string): string {
  const decision = events.filter(event => event.type === 'EvidenceStateValidated' && (!workflowId || event.payload.workflowId === workflowId)).at(-1);
  const value = decision?.payload.validatedEvidenceState;
  return states.has(str(value)) ? str(value) : 'UNKNOWN';
}

export function selectFocusIncident(input: Pick<DashboardInput, 'incidents' | 'workflows'>): ServiceNowIncident | undefined {
  const active = input.incidents.filter(item => item.status !== 'Resolved');
  return active.find(item => input.workflows.some(workflow => workflow.incidentId === item.id && ['ACTIVE', 'PAUSED'].includes(workflow.status))) || active[0];
}

const denyOperation = /authenticat|\blog(?:in|out)\b|sign[ -]?(?:in|out)|(?:active|user|auth) session|session (?:identity|user|switch)|switched.*user|user.*switch|viewer.*chang|role.*chang|navigation|navigated|\bUI\b/i;
const allowOperation = /investigation|execution|diagnostic|evidence|hypothesis|a2a|guardrail|approval|remediation|verification|incident.*resolv|workflow/i;
export function isOperationalLog(log: { source: string; message: string }): boolean {
  const combined = `${log.source} ${log.message}`;
  return !denyOperation.test(combined) && allowOperation.test(combined);
}

function operationEvents(events: DashboardEvent[], evidence: DashboardEvidence[], collaboration: CollaborationStep[]): DashboardOperation[] {
  const output: DashboardOperation[] = [];
  for (const step of collaboration) {
    output.push({ id: `request-${step.id}`, timestamp: step.requestTime, title: step.sourceTwin, detail: step.plainEnglishRequest, kind: 'A2A', raw: step.raw });
    if (step.responseTime) output.push({ id: `reply-${step.id}`, timestamp: step.responseTime, title: step.targetTwin, detail: step.plainEnglishResult || 'Validation reply recorded.', kind: 'A2A', raw: step.raw });
  }
  const titles: Record<string, string> = { AgentDiagnosticRequested: 'Diagnostic requested', AgentDiagnosticFailed: 'Diagnostic failed', AgentDiagnosticAbstained: 'More evidence required', EvidenceStateValidated: 'Evidence state validated', AgentCollaborationCompleted: 'Collaboration round completed', EngineeringDiagnosticWorkflowPrepared: 'Investigation prepared', ApprovalRequested: 'Approval requested', VerificationCompleted: 'Verification completed', IncidentResolved: 'Incident resolved' };
  for (const event of events) {
    if (!titles[event.type]) continue;
    const p = event.payload;
    const detail = event.type === 'EvidenceStateValidated' ? `Recorded guardrail decision: ${str(p.validatedEvidenceState).replaceAll('_', ' ') || 'unavailable'}.`
      : event.type === 'AgentCollaborationCompleted' ? 'Domain replies collected. This does not imply resolution.'
        : plain(p.objective, plain(p.reason, plain(p.description, titles[event.type])));
    output.push({ id: event.id, timestamp: event.timestamp, title: domainOf(p.persona) || 'CloudZero', detail, kind: event.type, raw: event });
  }
  evidence.forEach(item => output.push({ id: `evidence-${item.id}`, timestamp: item.observedAt, title: item.domain || item.source, detail: `${item.simulated ? 'Simulation evidence: ' : 'Evidence: '}${item.summary}`, kind: 'EVIDENCE', raw: item.raw }));
  return output;
}

export function buildDashboardModel(input: DashboardInput): DashboardModel {
  const visibleIds = new Set(input.incidents.map(item => item.id));
  const evidenceByIncident = new Map(input.incidents.map(item => [item.id, collectEvidence(input, item.id)]));
  const eventsFor = (id?: string) => id ? input.eventsByIncident[id]?.events || [] : [];
  const collaborationByIncident = new Map(input.incidents.map(item => [item.id, compileCollaboration(eventsFor(item.id), evidenceByIncident.get(item.id) || [])]));
  const focus = selectFocusIncident(input);
  const pendingApprovals = input.approvals.filter(item => item.status === 'PENDING');
  const executions: DashboardExecution[] = input.workflows.filter(workflow => ['ACTIVE', 'PAUSED'].includes(workflow.status) && (!workflow.incidentId || visibleIds.has(workflow.incidentId) || !workflow.incidentId.startsWith('DEMO-'))).map(workflow => {
    const exactAgent = input.agents.find(agent => agent.id === workflow.agentId);
    const domain = agentDomain(exactAgent) || domainOf(workflow.agentId);
    const agent = exactAgent || (domain ? input.agents.find(agent => agentDomain(agent) === domain) : undefined);
    const incident = input.incidents.find(item => item.id === workflow.incidentId);
    const evidence = (evidenceByIncident.get(workflow.incidentId) || []).filter(item => item.workflowId === workflow.id);
    const events = eventsFor(workflow.incidentId).filter(event => event.payload.workflowId === workflow.id);
    const collaborations = (collaborationByIncident.get(workflow.incidentId) || []).filter(item => item.workflowId === workflow.id);
    const requestedChecks = events.filter(event => event.type === 'AgentDiagnosticRequested');
    const waiting = pendingApprovals.some(item => item.workflowId === workflow.id) || workflow.steps.some(step => step.status === 'WAITING_APPROVAL');
    const ended = events.some(event => event.type === 'AgentCollaborationCompleted' || event.type === 'DemoInvestigationCompleted');
    const lifecycle = input.aggregates?.find(item => item.incidentId === workflow.incidentId)?.lifecycleState;
    const status = waiting ? 'AWAITING_APPROVAL' : workflow.steps.some(step => step.status === 'FAILED') ? 'FAILED' : lifecycle === 'VERIFYING' ? 'VERIFYING' : lifecycle === 'EXECUTING' ? 'EXECUTING' : ended ? 'WAITING_FOR_EVIDENCE' : workflow.status === 'PAUSED' ? 'WAITING_FOR_EVIDENCE' : collaborations.some(item => item.status === 'REQUESTED') ? 'COLLABORATING' : incident ? 'INVESTIGATING' : 'EXECUTING';
    return { id: workflow.id, agent, domain: domain || 'Supporting automation', runtimeName: agent?.name || workflow.agentId, title: workflow.name, status, incident, workflow,
      checksCompleted: requestedChecks.length ? evidence.filter(item => item.raw.payload?.templateId && ['SUCCEEDED', 'SIMULATED'].includes(item.status)).length : workflow.steps.filter(step => step.status === 'COMPLETED').length,
      checksTotal: requestedChecks.length || workflow.steps.length, checksLabel: requestedChecks.length ? 'Diagnostic checks' : 'Workflow steps',
      evidence, evidenceAvailable: Boolean(input.aggregates?.some(item => item.incidentId === workflow.incidentId) || input.eventsByIncident[workflow.incidentId]?.status === 'ready'), validatedState: validatedState(events, workflow.id),
      latest: evidence.at(-1)?.summary || plain(workflow.steps.find(step => step.status === 'RUNNING')?.description, workflow.name || 'No diagnostic observation recorded.'), collaborations };
  });
  // Pending runtime tasks without a workflow remain visible without inventing checks.
  input.agents.filter(agent => ['RUNNING', 'WAITING_FOR_HITL', 'FAILED'].includes(agent.status) && !executions.some(item => item.agent?.id === agent.id)).forEach(agent => executions.push({ id: `agent-${agent.id}`, agent, domain: agentDomain(agent) || 'Supporting automation', runtimeName: agent.name, title: agent.currentTask || 'Runtime activity', status: agent.status === 'WAITING_FOR_HITL' ? 'AWAITING_APPROVAL' : agent.status === 'FAILED' ? 'FAILED' : 'EXECUTING', checksCompleted: 0, checksTotal: 0, evidence: [], evidenceAvailable: false, validatedState: 'UNKNOWN', latest: 'No workflow-bound observation available.', collaborations: [] }));
  executions.sort((a, b) => Number(b.incident?.id === focus?.id && Boolean(focus)) - Number(a.incident?.id === focus?.id && Boolean(focus)) || Number(Boolean(b.workflow?.incidentId)) - Number(Boolean(a.workflow?.incidentId)) || (b.workflow?.startedAt || '').localeCompare(a.workflow?.startedAt || ''));
  const evidence = [...evidenceByIncident.values()].flat();
  const collaborations = [...collaborationByIncident.values()].flat();
  const focusEvidence = focus ? evidenceByIncident.get(focus.id) || [] : [];
  const focusCollaboration = focus ? collaborationByIncident.get(focus.id) || [] : [];
  const focusEvents = eventsFor(focus?.id);
  const focusExecutions = executions.filter(item => focus && item.incident?.id === focus.id);
  const participants = unique([...focusCollaboration.flatMap(item => [item.sourceTwin, item.targetTwin]), ...focusEvidence.map(item => item.domain).filter(Boolean), ...focusExecutions.map(item => item.domain)]).map(domain => {
    const latest = focusEvidence.filter(item => item.domain === domain && item.effect).at(-1);
    const pending = focusCollaboration.some(item => item.targetTwin === domain && item.status === 'REQUESTED');
    return { domain, state: pending ? 'COLLABORATING' : latest?.effect || (focusExecutions.find(item => item.domain === domain)?.status || 'PARTICIPATED') };
  });
  const twins = DOMAINS.map(domain => {
    const agent = input.agents.find(item => agentDomain(item) === domain);
    const execution = executions.find(item => item.domain === domain);
    const status = execution?.status || (!agent ? 'UNAVAILABLE' : agent.status === 'FAILED' ? 'FAILED' : agent.status === 'COMPLETED' ? 'COMPLETED' : 'AVAILABLE');
    return { domain, agent, status, active: Boolean(execution), executionId: execution?.id, hypothesis: participants.find(item => item.domain === domain)?.state };
  });
  const operations = [...input.incidents.flatMap(item => operationEvents(eventsFor(item.id), evidenceByIncident.get(item.id) || [], collaborationByIncident.get(item.id) || [])), ...input.systemLogs.filter(isOperationalLog).map(log => ({ id: log.id, timestamp: log.timestamp, title: log.source, detail: plain(log.message, 'Operational record available in audit details.'), kind: log.level, raw: log }))]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const seen = new Set<string>();
  const meaningful = operations.filter(item => { const key = `${item.timestamp}|${item.detail}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const latestDecision = focusEvents.filter(item => item.type === 'EvidenceStateValidated').at(-1);
  return {
    twins, executions, operations: meaningful, collaborations, evidenceCount: input.aggregates ? new Set(evidence.map(item => `${item.incidentId}|${item.id}`)).size : undefined,
    registeredTwins: input.agents.length, activeTwins: new Set(executions.map(item => item.agent?.id || item.domain)).size,
    activeIncidents: input.incidents.filter(item => item.status !== 'Resolved').length, pendingApprovals,
    incident: focus ? { incident: focus, owner: friendly(focus.assignedTo), participants, state: validatedState(focusEvents),
      hypothesis: focusEvidence.filter(item => item.effect).map(item => item.effect).filter((item, index, all) => all.indexOf(item) === index).join('; ') || undefined,
      nextAction: plain(record(latestDecision?.payload.remediation).reason, focusCollaboration.at(-1)?.nextCheck || 'Review the investigation for the next recorded action.'),
      activity: focusExecutions[0]?.status || focus.status, evidence: focusEvidence,
      checksCompleted: focusExecutions.reduce((sum, item) => sum + item.checksCompleted, 0), checksTotal: focusExecutions.reduce((sum, item) => sum + item.checksTotal, 0), collaborations: focusCollaboration, dataStatus: input.eventsByIncident[focus.id]?.status || 'loading' } : undefined
  };
}
