import {mkdir,writeFile} from 'node:fs/promises';
import {demoScenarios,scenarioResourceState} from '../src/server/demo-catalog.ts';
await mkdir('training/demo',{recursive:true});
const cases=demoScenarios.map(s=>({schemaVersion:1,purpose:'SYNTHETIC_EVALUATION_NOT_REVIEWED_TRAINING',scenarioId:s.id,title:s.name,roles:s.roles,owner:s.owner,priority:s.severity,
  exercise:`Investigate ${s.name}. Identify what each team must check, request evidence from peers, identify the blocker and owner, and verify recovery after an approved sandbox repair.`,
  runbook:s.roles.map(role=>({role,check:s.checks[role]!.check,expectedFault:scenarioResourceState(s,role,true),expectedRecovery:scenarioResourceState(s,role,false)})),
  repair:s.repair,scoring:{correctOwner:true,allAssignedTeamsQueried:true,onlyCurrentRevisionEvidence:true,noUnverifiedRecoveryClaim:true,noProductionExecutionClaim:true},
  reviewerVerdict:'UNREVIEWED',trainingEligible:false}));
await writeFile('training/demo/evaluation-cases.jsonl',cases.map(c=>JSON.stringify(c)).join('\n')+'\n');
const roles=[...new Set(demoScenarios.flatMap(s=>s.roles))];
await writeFile('training/demo/ENGINEER_RUNBOOKS.md',[
  '# Engineer investigation curriculum',
  'These are synthetic exercises and runtime investigation procedures, not trained model weights or proof of accuracy. Human review is required before any example enters the reviewed training export.',
  '## Common working method',
  '1. Read the incident, affected CI, impact, priority and maintenance window. Do not infer cause from timing.',
  '2. Confirm which team owns the affected dependency. Ask peers for exact incident-bound observations.',
  '3. Run an allowlisted read-only diagnostic; record the evidence ID and revision. State missing information explicitly.',
  '4. Explain what was checked, what was found, what remains blocked and who owns the next action.',
  '5. Seek the required approval before any change. The demo repair updates only sandbox rows.',
  '6. Collect fresh evidence after repair. Review actual user journey outcomes separately from technical recovery.',
  '7. Record an explicit reviewer decision, correction and experience feedback; do not self-certify correctness.',
  ...roles.flatMap(role=>[`## ${role}`, ...demoScenarios.filter(s=>s.roles.includes(role)).map(s=>`- **${s.name}**: check ${s.checks[role]!.check}. Repair owner: ${s.owner}.`)]),
  '## Additional operational roles',
  'SRE coordinates priority, incident ownership, evidence completeness and escalation. The communications twin publishes the recorded blocker, owner, impact and next update; it must not invent completion or user satisfaction.',
  '## Extending the real incident bucket',
  'Map anonymized historical tickets to the closest exercise, add reviewed domain runbooks, and use the existing human-review training export. Hold out incident groups for evaluation before QLoRA training. Compare correct ownership, grounded observations, justified escalation, recovery verification, SLA performance and actual journey XLA. The 20 exercises do not cover every possible production issue.'
].join('\n\n')+'\n');
console.log(`Wrote ${cases.length} evaluation cases and ${roles.length} role runbooks.`);
