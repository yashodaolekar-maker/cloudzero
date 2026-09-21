import test from 'node:test';
import assert from 'node:assert/strict';
import { observationPolicy, projectTasks, filterTasks, summarizeTasks, validateReview, prometheusSnapshot } from '../../twin-observability.ts';
import { projectIncidentSlas, summarizeExperience, validateExperience } from '../../twin-experience.ts';
import { validateRoam, classifyRoam, journeyProfile, projectJourneys } from '../../journey-observability.ts';
import type { IncidentDomainEvent } from '../../incident-runtime.ts';
import { trainingCandidates } from '../../twin-training.ts';
const start = Date.parse('2026-09-07T00:00:00Z');
const event = (id: string, type: string, sec: number, payload: any, incidentId = 'INC-1'): IncidentDomainEvent => ({ id, type, occurredAt: new Date(start + sec * 1000).toISOString(), payload, incidentId, actorId: 'reviewer', correlationId: 'correlation' });
const policy = observationPolicy({});
const taskStart = event('start', 'TwinTaskStarted', 0, { taskId: 'task', kind: 'CONVERSATION', role: 'NETWORK', operatingMode: 'SIMULATION', policyVersion: policy.version, slaTargetSeconds: 120, question: 'What is a firewall?' });
const taskEnd = event('end', 'TwinTaskCompleted', 120, { taskId: 'task', answer: 'A firewall controls traffic.', modelStatus: 'GENERATED' });

test('task counts are reconstructed once, with exact inclusive SLO boundary and no inferred correctness', () => {
  const tasks = projectTasks([taskStart, taskEnd, taskEnd], start + 130000, policy);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].slaStatus, 'MET');
  const summary = summarizeTasks(tasks); assert.equal(summary.accuracy, null); assert.equal(summary.unreviewed, 1);
  assert.equal(summary.qualityGate, 'INSUFFICIENT_REVIEWS');
});
test('overdue active work breaches; legacy and interrupted timing remain unknown', () => {
  assert.equal(projectTasks([taskStart], start + 120001)[0].slaStatus, 'BREACHED');
  const interrupted = projectTasks([taskStart, event('stop','TwinTaskInterrupted',125,{taskId:'task'})])[0];
  assert.equal(interrupted.status,'INTERRUPTED'); assert.equal(interrupted.durationSeconds,null); assert.equal(interrupted.slaStatus,'UNKNOWN');
  const legacy = projectTasks([event('old','EngineeringDiagnosticCompleted',5,{persona:'NETWORK'})])[0];
  assert.equal(legacy.durationSeconds,null); assert.equal(legacy.slaStatus,'UNKNOWN');
});
test('review revisions count the latest decision binding once and never bind across incidents', () => {
  const wrong = event('r1','TwinTaskReviewed',130,{taskId:'task',decisionEventId:'end',verdict:'WRONG',reason:'Evidence mismatch',correction:'Corrected answer',trainingEligible:true});
  const correct = event('r2','TwinTaskReviewed',140,{...wrong.payload,verdict:'CORRECT'});
  const mismatch = event('r3','TwinTaskReviewed',150,{...wrong.payload,decisionEventId:'other'});
  const cross = event('r4','TwinTaskReviewed',160,wrong.payload,'INC-OTHER');
  const tasks = projectTasks([taskStart,taskEnd,wrong,correct,mismatch,cross]);
  assert.equal(tasks[0].review?.eventId,'r2'); assert.equal(summarizeTasks(tasks).accuracy,1);
  assert.throws(()=>validateReview({...wrong.payload,correction:''},tasks[0]),/correction|corrective|expected/i);
  assert.throws(()=>validateReview({...wrong.payload,decisionEventId:'other'},tasks[0]),/exact decision/);
});
test('A2A failure cannot remain running after collaboration finishes', () => {
  const request = event('request','AgentInvestigationRequested',0,{messageId:'msg',recipient:'WINDOWS',collaborationId:'col',workflowId:'wf',policyVersion:policy.version,slaTargetSeconds:180});
  const tasks = projectTasks([request,event('col-end','AgentCollaborationCompleted',8,{collaborationId:'col'})]);
  assert.equal(tasks[0].status,'BLOCKED'); assert.equal(tasks[0].decisionEventId,null);
});
test('filters separate live/simulated cohorts and retain overdue old open work', () => {
  const tasks = projectTasks([taskStart,taskEnd]);
  assert.equal(filterTasks(tasks,{mode:'LIVE'},start+130000).length,0);
  assert.equal(filterTasks(tasks,{},start+31*86400000).length,0);
  assert.equal(filterTasks(projectTasks([taskStart]),{},start+31*86400000).length,1);
  const metrics = prometheusSnapshot(tasks); assert.ok(!metrics.includes('INC-1')); assert.ok(!metrics.includes('firewall'));
});
test('P1 one-hour and P2 eight-hour SLA, missing/assumed clocks are unknown', () => {
  assert.equal(policy.incidentSeconds.P1.resolution,3600); assert.equal(policy.incidentSeconds.P2.resolution,28800); assert.equal(policy.incidentSeconds.P3.resolution,null);
  const slaStart = event('sla','TwinIncidentSlaStarted',10,{priority:'P1',operatingMode:'LIVE',clockStartedAt:new Date(start).toISOString(),resolutionTargetSeconds:3600,policyVersion:policy.version});
  let result = projectIncidentSlas([slaStart],[],start+3600000)[0]; assert.equal(result.resolutionStatus,'PENDING');
  result = projectIncidentSlas([slaStart],[],start+3600001)[0]; assert.equal(result.resolutionStatus,'BREACHED');
  const end = event('resolution','LifecycleTransitioned',3600,{to:'RESOLVED'});
  assert.equal(projectIncidentSlas([slaStart,end],[],start+7200000)[0].resolutionStatus,'MET');
  assert.equal(projectIncidentSlas([{...slaStart,payload:{...slaStart.payload,clockStartedAt:null}}],[],start+7200000)[0].resolutionStatus,'UNKNOWN');
});
test('experience is explicit, revision-deduplicated and does not become decision correctness', () => {
  const tasks = projectTasks([taskStart,taskEnd]);
  assert.equal(summarizeExperience([],tasks).score,null);
  assert.throws(()=>validateExperience({helpfulness:0},tasks[0]),/1 to 5/);
  const payload=validateExperience({helpfulness:5,clarity:5,trust:5,ease:5,helpedResolve:true,firstContactResolved:true},tasks[0]);
  const first=event('f1','TwinExperienceRated',130,payload);
  const second=event('f2','TwinExperienceRated',140,{...payload,helpfulness:1,clarity:1,trust:1,ease:1});
  const summary=summarizeExperience([first,second],tasks); assert.equal(summary.responses,1); assert.equal(summary.score,0); assert.equal(summary.coverage,1);
  assert.equal(summarizeTasks(tasks).accuracy,null);
});
test('wireless XLA cannot infer a good journey without thresholds and complete client evidence', () => {
  const input={sampleId:'roam-1',clientId:'client-private',fromAp:'AP1',toAp:'AP2',occurredAt:new Date(start).toISOString(),interruptionMs:20,packetLossPercent:0,latencyMs:10,authenticationSucceeded:true,sessionPreserved:true};
  const sample=validateRoam(input,'LIVE','TEST',start);
  assert.notEqual(sample.clientId,input.clientId);
  assert.equal(classifyRoam(sample,journeyProfile({})).experience,'UNKNOWN');
  assert.equal(classifyRoam({...sample,sessionPreserved:false},journeyProfile({})).experience,'POOR');
  const profile=journeyProfile({XLA_ROAM_INTERRUPTION_MS:'50',XLA_ROAM_PACKET_LOSS_PERCENT:'1',XLA_ROAM_LATENCY_MS:'100'});
  assert.equal(classifyRoam(sample,profile).experience,'GOOD');
  assert.equal(classifyRoam({...sample,latencyMs:null},profile).experience,'UNKNOWN');
  assert.throws(()=>validateRoam({...input,packetLossPercent:101},'LIVE','TEST',start));
  assert.throws(()=>validateRoam({...input,fromAp:'AP2'},'LIVE','TEST',start));
  const e=event('wireless','WirelessRoamObserved',0,sample);
  const result=projectJourneys([e,e],{mode:'LIVE'},start); assert.equal(result.summary.sessions,1); assert.equal(result.summary.goodRate,null);
});
test('training export uses reviewed complete final output and excludes unknown A2A correction shape', () => {
  const review=event('review','TwinTaskReviewed',130,{taskId:'task',decisionEventId:'end',verdict:'WRONG',reason:'Wrong definition',correction:'A corrected and reviewed definition.',trainingEligible:true});
  const events=[taskStart,taskEnd,review];
  const rows=trainingCandidates(events,projectTasks(events));
  assert.equal(rows.length,1); assert.equal(rows[0].trainingReady,true);
  assert.equal(JSON.parse(rows[0].messages.at(-1).content).answer,'A corrected and reviewed definition.');
  assert.equal(rows[0].provenance.reviewEventId,'review');
  assert.equal(trainingCandidates([taskStart,taskEnd],projectTasks([taskStart,taskEnd])).length,0);
  const retired=event('review2','TwinTaskReviewed',140,{...review.payload,trainingEligible:false});
  assert.equal(trainingCandidates([...events,retired],projectTasks([...events,retired])).length,0);
});
