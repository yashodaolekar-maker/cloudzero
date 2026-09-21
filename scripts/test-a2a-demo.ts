import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { DemoDatabase, validateDemoConfiguration } from '../src/server/demo-database.ts';
import {demoScenarios} from '../src/server/demo-catalog.ts';
const base = process.env.DEMO_TEST_BASE_URL || 'http://127.0.0.1:3000';
const env = { ENABLE_A2A_DB_DEMO:'true', OPERATING_MODE:'SIMULATION', DEPLOYMENT_PROFILE:'LOCAL_SIMULATION' };
const url = process.env.DEMO_TEST_DATABASE_URL || 'postgresql://demo_proxy:demo-proxy-local-only@127.0.0.1:15433/cloudzero_demo';
assert.throws(() => validateDemoConfiguration(url, {...env, OPERATING_MODE:'LIVE'}));
assert.throws(() => validateDemoConfiguration('postgresql://cloudzero:wrong@localhost/cloudzero',env));
async function request(path:string, body?:unknown, code=200) {
  const response=await fetch(base+'/api/demo'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const result=await response.json(); assert.equal(response.status,code,JSON.stringify(result)); return result;
}
async function investigate(id:string, revision:number) {
  await request(`/sessions/${id}/investigate`,{expectedRevision:revision,useModel:false},202);
  for(let i=0;i<60;i++) {
    const detail=await request(`/sessions/${id}`);
    if(detail.session.status!=='RUNNING') { assert.equal(detail.session.status,'COMPLETED',JSON.stringify(detail)); return detail; }
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('Demo investigation did not finish within 30 seconds.');
}
assert.equal((await request('/status')).ready,true);
await request('/sessions',{scenarioId:'arbitrary-sql'},400);
const proxy=new DemoDatabase(url,env), pool=new Pool({connectionString:url});
try {
  await proxy.initialize();
  await assert.rejects(pool.query("UPDATE demo_resources SET state='{}'::jsonb WHERE false"),/permission denied/);
  for(const scenarioId of (process.env.DEMO_TEST_ALL === 'true'?demoScenarios.map(s=>s.id):['windows-dns','database-pool'])) {
    const seeded=process.env.DEMO_TEST_ALL==='true'?(await pool.query('SELECT id FROM demo_sessions WHERE seed_key=$1',[`thursday-demo-v1:${scenarioId}`])).rows[0]:null;
    let session=seeded?(await request(`/sessions/${seeded.id}`)).session:(await request('/sessions',{scenarioId},201)).session;
    const id=session.id;
    if(session.status!=='IDLE'||session.state!=='FAULTED') session=(await request(`/sessions/${id}/condition`,{expectedRevision:session.revision,condition:'FAULTED'})).session;
    const revision=session.revision;
    await request(`/sessions/${id}/repair`,{expectedRevision:revision},409);
    const before=await investigate(id,revision);
    assert.equal(before.resources.length,demoScenarios.find(s=>s.id===scenarioId)!.roles.length);
    assert.ok(before.queries.length>=before.resources.length);
    assert.ok(before.exchanges.some((e:any)=>e.type==='AgentValidationReplied'));
    assert.deepEqual([...new Set(before.exchanges.filter((e:any)=>e.type==='AgentValidationReplied').map((e:any)=>e.payload.sender))].sort(),before.resources.map((r:any)=>r.role).sort());
    assert.ok(before.queries.every((q:any)=>q.output.dataOrigin==='SIMULATION'));
    assert.ok(before.orders.every((o:any)=>o.status==='WAITING'));
    assert.equal(before.summary.owner,demoScenarios.find(s=>s.id===scenarioId)!.owner);
    assert.ok(before.summary.blocker);
    await assert.rejects(proxy.diagnose({deviceId:before.resources[0].id,incidentId:session.incidentId,workflowId:'forged',persona:before.resources[0].role,templateId:'NETWORK_INTERFACE_SUMMARY'} as any));
    await request(`/sessions/${id}/repair`,{expectedRevision:revision});
    await request(`/sessions/${id}/repair`,{expectedRevision:revision},409);
    const after=await investigate(id,revision+1);
    assert.ok(after.orders.every((o:any)=>o.status==='PROCESSED'));
    assert.ok(after.queries.some((q:any)=>q.revision===revision&&q.output.condition==='FAULTED'));
    assert.ok(after.queries.some((q:any)=>q.revision===revision+1&&q.output.condition==='REPAIRED'));
    if(scenarioId==='windows-dns') assert.equal(after.resources.find((r:any)=>r.role==='WINDOWS').state.dnsService,'RUNNING');
    else if(scenarioId==='database-pool') assert.equal(after.resources.find((r:any)=>r.role==='DATABASE').state.activeConnections,24);
    assert.equal(after.summary.verified,true);
    assert.ok(after.summary.teams.every((t:any)=>t.status==='CHECKED'));
    assert.ok(after.workNotes.length>=2);
    if(seeded) { await request(`/sessions/${id}/condition`,{expectedRevision:revision+1,condition:'FAULTED'}); await investigate(id,revision+2); }
    console.log(JSON.stringify({scenarioId,sessionId:id,queries:after.queries.length,exchanges:after.exchanges.length,status:'PASS'}));
  }
} finally { await proxy.close(); await pool.end(); }
