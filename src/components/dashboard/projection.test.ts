import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DigitalTwinAgent, IncidentAggregate, IncidentEvidence, ServiceNowIncident, WorkflowInstance } from '../../types.ts';
import type { DashboardEvent, DashboardInput } from './model.ts';
import { buildDashboardModel, collectEvidence, compileCollaboration, isOperationalLog, normalizeDashboardEvents, projectEvidence } from './projection.ts';

const incident = { id: 'INC-1', shortDescription: 'Service timeout', status: 'In Progress', assignedTo: 'MIDDLEWARE twin', severity: 'P2 - High', openedAt: '2026-09-20T08:00:00Z', category: 'Middleware', cmdbItem: 'ci-1', cmdbName: 'Checkout', elapsedMinutes: 1, workNotes: [] } as ServiceNowIncident;
const agent = { id: 'agent-middleware', name: 'Nexus-Middleware-Twin', department: 'Middleware', role: 'Messaging', status: 'MONITORING', tasksCompleted: 40, performanceScore: 90, specialty: 'Queues', avatarColor: '', systemConnected: [] } as DigitalTwinAgent;
const workflow = { id: 'wf-1', incidentId: incident.id, agentId: 'digital-twin-middleware', name: 'Read-only diagnostics', status: 'ACTIVE', startedAt: incident.openedAt, steps: [{ name: 'Check', description: 'Description is not evidence', status: 'COMPLETED', requiresApproval: false }] } as WorkflowInstance;
const evidence = { id: 'e1', incidentId: incident.id, workflowId: workflow.id, source: 'gRPC Command Proxy', summary: 'DATABASE_CONNECTION_HEALTH: {"raw":true}', observedAt: incident.openedAt, payload: { persona: 'DATABASE', status: 'SIMULATED', commandDisplay: 'database health', output: JSON.stringify({ dataOrigin: 'SIMULATION', observations: { finding: '48 active connections of 400.', check: 'Active sessions and connection pressure', databaseHypothesis: 'ELIMINATED' } }) } } as IncidentEvidence;
const event = (type: string, payload: Record<string, unknown>, id = type): DashboardEvent => ({ id, type, incidentId: incident.id, timestamp: incident.openedAt, payload: { workflowId: workflow.id, ...payload } });
const request = event('AgentInvestigationRequested', { messageId: 'request-1', sender: 'MIDDLEWARE', recipient: 'DATABASE', question: 'Validate database.' });
const reply = event('AgentValidationReplied', { messageId: 'reply-1', inReplyTo: 'request-1', sender: 'DATABASE', recipient: 'MIDDLEWARE', evidenceIds: ['e1'], assessment: 'CONFIRMED: restart now' });
const base = (): DashboardInput => ({ agents: [agent], workflows: [workflow], incidents: [incident], approvals: [], systemLogs: [], aggregates: [{ incidentId: incident.id, evidence: [] } as IncidentAggregate], eventsByIncident: {} });

test('completed workflow steps never become evidence', () => {
  const model = buildDashboardModel(base());
  assert.equal(model.evidenceCount, 0);
  assert.equal(model.executions[0].checksCompleted, 1);
  assert.deepEqual(model.executions[0].evidence, []);
  assert.equal(model.executions[0].validatedState, 'UNKNOWN');
});
test('exact workflow IDs bind incident and runtime domain aliases', () => {
  const model = buildDashboardModel(base());
  assert.equal(model.executions[0].incident?.id, incident.id);
  assert.equal(model.executions[0].domain, 'Middleware');
  assert.equal(model.executions[0].agent?.id, agent.id);
});
test('absent Cyber registry never reports ready', () => {
  assert.equal(buildDashboardModel(base()).twins.find(item => item.domain === 'Cyber')?.status, 'UNAVAILABLE');
});
test('no incident means no incident focus; automation is not category-matched', () => {
  const input = base(); input.incidents = []; input.workflows = [{ ...workflow, incidentId: undefined }];
  const model = buildDashboardModel(input);
  assert.equal(model.incident, undefined);
  assert.equal(model.executions[0].incident, undefined);
  assert.equal(model.executions[0].status, 'EXECUTING');
});
test('all applicable deny filters win over operational keywords', () => {
  for (const message of ['Switched active session user to Network Twin', 'Login approval successful', 'Authentication guardrail accepted', 'Viewer role changed for incident', 'UI navigation to evidence', 'User switched to A2A operator', 'logout from investigation']) assert.equal(isOperationalLog({ source: 'Audit', message }), false, message);
  assert.equal(isOperationalLog({ source: 'Network Twin', message: 'Diagnostic evidence collected' }), true);
  assert.equal(isOperationalLog({ source: 'Database Twin', message: 'Diagnostic check of database sessions completed' }), true);
});
test('evidence records deduplicate across aggregate and events and reject foreign incidents', () => {
  const input = base(); input.aggregates[0].evidence = [evidence];
  input.eventsByIncident[incident.id] = { status: 'ready', events: [event('AgentDiagnosticEvidenceCollected', { evidence }), event('AgentDiagnosticEvidenceCollected', { evidence: { ...evidence, id: 'foreign', incidentId: 'OTHER' } }, 'other')] };
  assert.equal(collectEvidence(input, incident.id).length, 1);
});
test('real structured observation is summarized without JSON and remains simulated', () => {
  const result = projectEvidence(evidence);
  assert.equal(result.summary, '48 active connections of 400.');
  assert.equal(result.simulated, true);
  assert.match(result.effect, /Simulation observation: database hypothesis ELIMINATED/);
  assert.equal(result.command, 'database health');
});
test('A2A uses explicit request/reply and evidence IDs, not assessment claims', () => {
  const steps = compileCollaboration([request, reply], [projectEvidence(evidence)]);
  assert.equal(steps[0].sourceTwin, 'Middleware'); assert.equal(steps[0].targetTwin, 'Database');
  assert.equal(steps[0].status, 'RETURNED'); assert.deepEqual(steps[0].evidenceIds, ['e1']);
  assert.match(steps[0].plainEnglishResult, /48 active/);
  assert.doesNotMatch(steps[0].plainEnglishResult, /restart|CONFIRMED/);
});
test('mismatched message, workflow, incident or sender never produces correlated reply', () => {
  for (const candidate of [{ ...reply, payload: { ...reply.payload, inReplyTo: 'other' } }, { ...reply, payload: { ...reply.payload, workflowId: 'other' } }, { ...reply, incidentId: 'other' }, { ...reply, payload: { ...reply.payload, sender: 'NETWORK' } }]) {
    assert.equal(compileCollaboration([request, candidate], [projectEvidence(evidence)])[0].status, 'REQUESTED');
  }
});
test('reply without linked evidence does not manufacture findings', () => {
  const step = compileCollaboration([request, reply], [projectEvidence({ ...evidence, workflowId: 'foreign' })])[0];
  assert.deepEqual(step.evidenceIds, []); assert.match(step.plainEnglishResult, /no linked diagnostic/);
  assert.equal(step.validatedEffect, undefined);
});
test('only deterministic EvidenceStateValidated sets dashboard RCA', () => {
  const input = base();
  input.eventsByIncident[incident.id] = { status: 'ready', events: [request, reply, event('AgentOwnerAssessmentCompleted', { causalStatus: 'CONFIRMED' }), event('EvidenceStateValidated', { validatedEvidenceState: 'SUSPECTED', modelProposedState: 'CONFIRMED' })] };
  assert.equal(buildDashboardModel(input).incident.state, 'SUSPECTED');
  assert.equal(buildDashboardModel(input).executions[0].validatedState, 'SUSPECTED');
});
test('completed collaboration never resolves an incident or executes remediation', () => {
  const input = base(); input.eventsByIncident[incident.id] = { status: 'ready', events: [event('AgentCollaborationCompleted', {})] };
  const model = buildDashboardModel(input);
  assert.equal(model.executions[0].status, 'WAITING_FOR_EVIDENCE');
  assert.equal(model.activeIncidents, 1);
  assert.equal(model.incident.incident.status, 'In Progress');
});
test('native persisted occurredAt is used and foreign events filtered', () => {
  const result = normalizeDashboardEvents([{ id: '1', type: 'EvidenceStateValidated', incidentId: incident.id, occurredAt: incident.openedAt, payload: {} }, { id: '2', type: 'AgentValidationReplied', incidentId: 'OTHER' }], incident.id);
  assert.equal(result.length, 1); assert.equal(result[0].timestamp, incident.openedAt);
});
test('unknown evidence collection remains unknown, not zero', () => {
  const input = base(); input.aggregates = undefined;
  assert.equal(buildDashboardModel(input).evidenceCount, undefined);
});
test('several active workflows for one Twin remain independently inspectable', () => {
  const input = base(); input.workflows.push({ ...workflow, id: 'wf-2' });
  const model = buildDashboardModel(input);
  assert.equal(model.executions.length, 2); assert.equal(model.activeTwins, 1);
});
test('actual diagnostic attempts, not workflow steps, drive diagnostic check counts', () => {
  const input = base(); input.eventsByIncident[incident.id] = { status: 'ready', events: [event('AgentDiagnosticRequested', { persona: 'DATABASE', templateId: 'DATABASE_CONNECTION_HEALTH' }), event('AgentDiagnosticEvidenceCollected', { evidence: { ...evidence, payload: { ...evidence.payload, templateId: 'DATABASE_CONNECTION_HEALTH' } } })] };
  const execution = buildDashboardModel(input).executions[0];
  assert.equal(execution.checksLabel, 'Diagnostic checks'); assert.equal(execution.checksCompleted, 1); assert.equal(execution.checksTotal, 1);
});
test('hidden scenario incidents never enter dashboard execution projection', () => {
  const input = base(); input.workflows.push({ ...workflow, id: 'private', incidentId: 'DEMO-hidden' });
  assert.equal(buildDashboardModel(input).executions.some(item => item.id === 'private'), false);
});
test('unavailable event collection cannot reuse unvalidated model text as RCA', () => {
  const input = base(); input.eventsByIncident[incident.id] = { status: 'error', events: [] };
  const model = buildDashboardModel(input);
  assert.equal(model.incident.dataStatus, 'error'); assert.equal(model.incident.state, 'UNKNOWN');
});
test('unmapped workflow identity is never assigned to an unrelated supporting agent', () => {
  const input = base(); input.agents.push({ ...agent, id: 'agent-sre', department: undefined }); input.workflows[0] = { ...workflow, agentId: 'unknown-worker' };
  const execution = buildDashboardModel(input).executions[0];
  assert.equal(execution.agent, undefined); assert.equal(execution.runtimeName, 'unknown-worker');
});
