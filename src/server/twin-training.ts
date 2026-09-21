import crypto from "node:crypto";
import type { IncidentDomainEvent } from "./incident-runtime.ts";
import type { ObservedTask } from "./twin-observability.ts";
import { safePayload } from "./twin-observability.ts";

/** Human-reviewed final responses only. Never train on hidden reasoning, unreviewed output or incident outcomes inferred by a model. */
export function trainingCandidates(events: IncidentDomainEvent[], tasks: ObservedTask[]) {
  const byId = new Map(events.map(e => [e.id, e]));
  return tasks.filter(t => t.review?.trainingEligible && ['CORRECT', 'WRONG'].includes(t.review.verdict)).map(task => {
    const decision = byId.get(task.decisionEventId!);
    const taskEvents = events.filter(e => e.incidentId === task.incidentId && (task.eventIds.includes(e.id) || e.payload.taskId === task.id));
    const first: any = taskEvents.find(e => ['TwinTaskStarted','AgentInvestigationRequested'].includes(e.type))?.payload;
    const input: any = taskEvents.find(e => Array.isArray(e.payload.trainingMessages))?.payload.trainingMessages;
    const p: any = decision?.payload || {};
    let target: string | null = null;
    let exclusion: string | null = null;
    if (task.kind === 'CONVERSATION') {
      const text = task.review!.verdict === 'WRONG' ? task.review!.correction : p.answer || p.text;
      if (typeof text === 'string' && text.trim()) target = JSON.stringify({ answer: text });
    } else if (['A2A','OWNER_ASSESSMENT'].includes(task.kind)) {
      try {
        const reply = task.review!.verdict === 'WRONG' ? JSON.parse(task.review!.correction) : { assessment:p.assessment,nextCheck:p.nextCheck,evidenceIds:p.evidenceIds };
        if (typeof reply.assessment !== 'string' || typeof reply.nextCheck !== 'string' || !Array.isArray(reply.evidenceIds) || reply.evidenceIds.some((id:unknown)=>typeof id !== 'string' || !p.evidenceIds?.includes(id))) throw new Error('shape');
        target=JSON.stringify(reply);
      } catch { exclusion = 'A2A correction must be JSON with assessment, nextCheck and evidenceIds drawn from the reviewed decision.'; }
    } else exclusion = 'This work unit is not a model conversation; retain it for evaluation, not supervised answer training.';
    const messages = Array.isArray(input) && input.length ? input.filter(m => m && ['system','user','assistant'].includes(m.role) && typeof m.content === 'string').map(m=>({role:m.role,content:m.content})) : first?.question ? [
      { role:'system',content:`You are the ${task.role} engineering twin. Distinguish reported symptoms from evidence. Do not claim actions occurred without execution evidence. Return only JSON ${task.kind==='CONVERSATION'?'with an answer string':'with assessment, nextCheck and evidenceIds'}.` },
      { role:'user',content:first.question }
    ] : [];
    if (!messages.length) exclusion='No captured prompt is available for this historical work unit.';
    if (!target && !exclusion) exclusion='No complete reviewed final response is available.';
    const trainingReady=Boolean(target && messages.length && !exclusion);
    const review=task.review!;
    return safePayload({schemaVersion:2,purpose:'HUMAN_REVIEWED_TRAINING_CANDIDATE',task,
      messages:trainingReady?[...messages,{role:'assistant',content:target}]:[],trainingReady,exclusion,
      expectedResponse:task.review!.verdict==='WRONG'?review.correction:p.answer || p.assessment || task.summary,
      provenance:{decisionEventId:task.decisionEventId,reviewEventId:review.eventId,reviewerId:review.reviewerId,incidentId:task.incidentId,mode:task.mode,
        source:'INCIDENT_EVENT_LEDGER',contentHash:crypto.createHash('sha256').update(JSON.stringify({messages,target})).digest('hex')},automaticTraining:false});
  });
}
