import { demoScenarios } from './demo-catalog.ts';
const team=(role:string)=>({DATABASE:'DBA',CLOUDOPS:'CloudOps',DEVOPS:'DevOps',MIDDLEWARE:'Middleware',SECURITY:'Security',NETWORK:'Network',WINDOWS:'Windows',LINUX:'Linux'}[role]||role);
/** Deterministic statements are derived from the current SQL evidence revision, never model prose. */
export function demoSummary(detail:any) {
  const session=detail.session, scenario=demoScenarios.find(s=>s.id===session.scenarioId)!;
  const queries=detail.queries.filter((q:any)=>q.revision===session.revision);
  const teams=scenario.roles.map(role=>{
    const query=queries.find((q:any)=>q.persona===role), observation=query?.output?.observations;
    const configured=scenario.checks[role]!;
    return {role,status:!query?'PENDING':observation?.blocked?'BLOCKED':'CHECKED',
      checked:query?`${team(role)} team checked ${observation?.check||configured.check}.`:`${team(role)} team has not yet checked ${configured.check} for revision ${session.revision}.`,
      finding:query?(typeof observation?.finding==='string'?observation.finding:'Legacy evidence is available in the technical record; run a fresh investigation for a readable finding.'):'No current-revision evidence yet.',
      evidenceIds:query?[query.id]:[]};
  });
  const failed=['FAILED','INTERRUPTED'].includes(session.status), verified=session.state==='REPAIRED' && session.status==='COMPLETED' && teams.every((t:any)=>t.status==='CHECKED');
  const observedBlocker=teams.find((t:any)=>t.status==='BLOCKED');
  const rca=observedBlocker?{
    status:'SUPPORTED',
    hypothesis:`${team(observedBlocker.role)} dependency is the supported cause`,
    finding:observedBlocker.finding,
    owner:scenario.owner,
    evidenceIds:observedBlocker.evidenceIds,
    eliminated:teams.filter((t:any)=>t.status==='CHECKED').map((t:any)=>({role:t.role,finding:t.finding,evidenceIds:t.evidenceIds}))
  }:null;
  const blocker=failed?`Investigation ${session.status.toLowerCase()}: ${session.lastError||'an assigned check did not complete'}`
    : observedBlocker?`${team(observedBlocker.role)}: ${observedBlocker.finding}`
    : session.state==='REPAIRED'&&!verified?'The sandbox repair has not yet been verified by all assigned teams.'
    : session.status==='IDLE'?'The reported fault needs an investigation before ownership can be validated.' : null;
  const owner=failed?'Platform operator':scenario.owner;
  const nextAction=verified?'Review the evidence and record the decision outcome in Activity & reviews. Incident closure still requires explicit review.'
    : failed?'Check the database and command proxy, then retry this revision.'
    : session.status==='RUNNING'?'Wait for the remaining team checks and owner assessment; results update automatically.'
    : session.state==='FAULTED'&&session.status==='COMPLETED'?`${team(scenario.owner)} owns the next step: ${scenario.repair} Use Apply demo repair to approve this sandbox-only change.`
    :'Select Investigate to collect fresh evidence from every assigned team.';
  const steps:any[]=[{id:'intake',label:'Incident received',status:'COMPLETED',owner:scenario.roles[0],description:`The fictional incident and related maintenance records are saved. Priority ${scenario.severity}.`,evidenceIds:[]}];
  teams.forEach(t=>steps.push({id:`check-${t.role}`,label:`${team(t.role)} checks`,status:t.status==='PENDING'?(session.status==='RUNNING'?'ACTIVE':'PENDING'):t.status==='BLOCKED'?'BLOCKED':'COMPLETED',owner:t.role,description:`${t.checked} ${t.finding}`,evidenceIds:t.evidenceIds}));
  steps.push({id:'decision',label:'Owner reviews evidence',status:session.status==='COMPLETED'?'COMPLETED':failed?'BLOCKED':session.status==='RUNNING'?'ACTIVE':'PENDING',owner:scenario.owner,description:nextAction,evidenceIds:teams.flatMap(t=>t.evidenceIds)});
  steps.push({id:'repair',label:'Approve sandbox repair',status:session.state==='REPAIRED'?'COMPLETED':session.status==='COMPLETED'?'ACTIVE':'PENDING',owner:scenario.owner,description:scenario.repair,evidenceIds:[]});
  steps.push({id:'verify',label:'Verify recovery',status:verified?'COMPLETED':session.state==='REPAIRED'?'ACTIVE':'PENDING',owner:scenario.owner,description:verified?'Every assigned team has fresh non-blocking evidence from the repaired revision. This verifies the simulation only.':'After repair, investigate again. Changing rows alone does not verify recovery.',evidenceIds:verified?teams.flatMap(t=>t.evidenceIds):[]});
  return {headline:verified?'All assigned teams verified the repaired sandbox state.':failed?'The investigation needs operator attention.':observedBlocker?`The ${team(observedBlocker.role)} check identified the current sandbox blocker.`:session.status==='RUNNING'?'Teams are investigating the reported issue.':'Ready to investigate the reported incident.',owner,blocker,nextAction,teams,steps,rca,verified,source:'DETERMINISTIC_SQL_EVIDENCE'};
}
