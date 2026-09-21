import test from 'node:test';
import assert from 'node:assert/strict';
import {demoScenarios,scenarioResourceState} from '../../demo-catalog.ts';
import {demoSummary} from '../../demo-summary.ts';
test('distinct cases have an owner, real checks and one recoverable blocker',()=>{
  assert.equal(demoScenarios.length,22);assert.equal(new Set(demoScenarios.map(s=>s.id)).size,22);
  for(const s of demoScenarios) {
    assert.ok(s.roles.includes(s.owner));
    assert.equal(s.roles.filter(r=>scenarioResourceState(s,r,true).blocked).length,1);
    assert.ok(s.roles.every(r=>!scenarioResourceState(s,r,false).blocked));
  }
});
test('readable summaries require current evidence and identify Windows as DNS blocker owner',()=>{
  const s=demoScenarios.find(item=>item.id==='windows-dns')!, detail:any={session:{scenarioId:s.id,revision:2,state:'FAULTED',status:'IDLE'},queries:[]};
  detail.queries=s.roles.map(role=>({id:role,persona:role,revision:1,output:{observations:scenarioResourceState(s,role,true)}}));
  assert.ok(demoSummary(detail).teams.every(t=>t.status==='PENDING'));
  detail.queries.forEach((q:any)=>q.revision=2);detail.session.status='COMPLETED';
  assert.equal(demoSummary(detail).owner,'WINDOWS');assert.match(demoSummary(detail).blocker!,/DNS service is stopped/);
  assert.equal(demoSummary(detail).rca.status,'SUPPORTED');assert.match(demoSummary(detail).rca.hypothesis,/Windows/);
  detail.session.state='REPAIRED'; detail.session.revision=3;
  assert.equal(demoSummary(detail).verified,false);
  detail.queries=s.roles.map(role=>({id:role,persona:role,revision:3,output:{observations:scenarioResourceState(s,role,false)}}));
  assert.equal(demoSummary(detail).verified,true);
});
