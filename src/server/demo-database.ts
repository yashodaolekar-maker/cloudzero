import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { ServiceNowIncident } from '../types.ts';
import type { ProxyCommandRequest, ProxyCommandResponse } from './engineering-orchestrator.ts';
import { demoScenarios, scenarioResourceState } from './demo-catalog.ts';
export { demoScenarios } from './demo-catalog.ts';

export class DemoConflict extends Error {}
export function demoEnabled(env = process.env) { return env.ENABLE_A2A_DB_DEMO === 'true' && env.OPERATING_MODE === 'SIMULATION' && env.DEPLOYMENT_PROFILE === 'LOCAL_SIMULATION'; }
export function validateDemoConfiguration(url: string, env = process.env) {
  if (!demoEnabled(env)) throw new Error('Database demo requires ENABLE_A2A_DB_DEMO=true, LOCAL_SIMULATION and SIMULATION mode.');
  const parsed = new URL(url);
  if (!['postgres:','postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/cloudzero_demo' || !['demo_app','demo_proxy'].includes(decodeURIComponent(parsed.username))) throw new Error('Demo must use the dedicated cloudzero_demo database and a restricted demo role.');
}
const sessionView = (r: any) => ({id:r.id,scenarioId:r.scenario_id,title:r.title,revision:r.revision,state:r.state,status:r.status,incidentId:r.incident_id,seedKey:r.seed_key||null,
  workflowId:r.workflow_id,lastInvestigatedRevision:r.last_investigated_revision,lastError:r.last_error,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});
function resourceState(scenario: string, role: string, faulted: boolean) {
  return scenarioResourceState(demoScenarios.find(s=>s.id===scenario)!,role,faulted);
}
export class DemoDatabase {
  private pool: Pool;
  constructor(url: string, env = process.env) {
    validateDemoConfiguration(url, env);
    this.pool = new Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000,application_name:'cloudzero-a2a-demo'});
  }
  async close() { await this.pool.end(); }
  async initialize() {
    const guard = await this.pool.query("SELECT purpose,schema_version FROM demo_guard");
    if (guard.rows.length!==1 || guard.rows[0].purpose!=='CLOUDZERO_A2A_DEMO_ONLY' || guard.rows[0].schema_version!==1) throw new Error('Dedicated demo database marker or schema version is invalid.');
    const result=await this.pool.query('SELECT current_database() AS name, current_setting(\'server_version\') AS version');
    const grants=await this.pool.query("SELECT has_table_privilege('demo_proxy','demo_resources','UPDATE') OR has_table_privilege('demo_proxy','demo_resources','INSERT') OR has_table_privilege('demo_proxy','demo_resources','DELETE') AS writable");
    if(grants.rows[0].writable) throw new Error('Diagnostic proxy must not have resource mutation privileges.');
    return {...result.rows[0],readOnlyProxy:true};
  }
  private async tx<T>(fn:(c:PoolClient)=>Promise<T>) {
    const c=await this.pool.connect();
    try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
    catch(error) { await c.query('ROLLBACK').catch(()=>{}); throw error; } finally { c.release(); }
  }
  private async event(c:PoolClient,id:string,type:string,payload:Record<string,unknown>) {
    await c.query('INSERT INTO demo_events(id,session_id,type,payload) VALUES($1,$2,$3,$4::jsonb)',[crypto.randomUUID(),id,type,JSON.stringify(payload)]);
  }
  async list() { return (await this.pool.query('SELECT * FROM demo_sessions ORDER BY created_at DESC LIMIT 50')).rows.map(sessionView); }
  async create(scenarioId: string, actorId:string, seedKey?:string) {
    const scenario=demoScenarios.find(s=>s.id===scenarioId); if(!scenario) throw new Error('Unknown demo scenario.');
    return this.tx(async c=>{
      if(seedKey) {
        await c.query('SELECT pg_advisory_xact_lock($1)',[20488732]);
        const existing=await c.query('SELECT * FROM demo_sessions WHERE seed_key=$1',[seedKey]);
        if(existing.rows.length) return sessionView(existing.rows[0]);
      }
      const id=crypto.randomUUID(), prefix=`DEMO-${id}`, now=new Date().toISOString();
      const owner=scenario.owner, incidentId=`${prefix}-${owner}`, changeId=`DEMO-CHG-${id}`;
      const session=await c.query('INSERT INTO demo_sessions(id,scenario_id,title,state,incident_id,seed_key) VALUES($1,$2,$3,\'FAULTED\',$4,$5) RETURNING *',[id,scenarioId,scenario.name,incidentId,seedKey||null]);
      for (const role of scenario.roles) {
        const ci=`demo-ci-${id}-${role.toLowerCase()}`, ticketId=scenarioId === 'false-network-middleware' ? `${prefix}-MIDDLEWARE` : `${prefix}-${role}`;
        const record:ServiceNowIncident={id:ticketId,cmdbItem:ci,cmdbName:`demo-${role.toLowerCase()}-01`,category:scenarioId === 'false-network-middleware' ? 'Middleware' : 'Switch',
          shortDescription:scenarioId === 'false-network-middleware' ? 'Checkout API intermittent timeouts — initial network symptom under investigation' : scenario.name,
          status:'In Progress',assignedTo:`${role} twin`,severity:scenario.severity==='P1'?'P1 - Critical':'P2 - High',openedAt:now,elapsedMinutes:0,workNotes:[],
          metadata:{demoSessionId:id,demoScenarioId:scenarioId,dataOrigin:'SIMULATION',source:'A2A_DEMO_DATABASE',ciClass:role.toLowerCase(),cmdbSysId:ci,relatedChange:changeId,description:scenario.description,initialEvidenceState:scenarioId === 'false-network-middleware' ? 'INSUFFICIENT_EVIDENCE' : undefined,namespace:'demo',platform:scenario.roles.includes('DEVOPS')?'kubernetes':'demo',service_name:'demo-service',destinationRef:'demo-service',...(scenarioId==='network-vlan'?{interfaceRef:'Gi1/0/24'}:{})}};
        await c.query('INSERT INTO demo_resources(id,session_id,role,name,state) VALUES($1,$2,$3,$4,$5::jsonb)',[ci,id,role,record.cmdbName,JSON.stringify(resourceState(scenarioId,role,true))]);
        if (scenarioId !== 'false-network-middleware' || role === scenario.owner) {
          await c.query('INSERT INTO demo_incidents(id,session_id,role,record) VALUES($1,$2,$3,$4::jsonb)',[ticketId,id,role,JSON.stringify(record)]);
        }
      }
      await c.query('INSERT INTO demo_changes(id,session_id,record) VALUES($1,$2,$3::jsonb)',[changeId,id,JSON.stringify({id:changeId,title:`Demo maintenance: ${scenario.name}`,status:'Completed',reportedAt:now,dataOrigin:'SIMULATION'})]);
      for(let i=1;i<=5;i++) await c.query('INSERT INTO demo_orders(id,session_id,status,amount) VALUES($1,$2,$3,$4)',[`${id}-order-${i}`,id,'WAITING',25*i]);
      await this.event(c,id,'DemoSessionCreated',{scenarioId,revision:1,actorId,dataOrigin:'SIMULATION'});
      return sessionView(session.rows[0]);
    });
  }
  async detail(id:string) {
    const session=(await this.pool.query('SELECT * FROM demo_sessions WHERE id=$1',[id])).rows[0];
    if(!session) throw new Error('Demo session not found.');
    const outputs=await Promise.all([
      this.pool.query('SELECT id,role,name,state,updated_at AS "updatedAt" FROM demo_resources WHERE session_id=$1 ORDER BY role',[id]),
      this.pool.query('SELECT id,role,record FROM demo_incidents WHERE session_id=$1 ORDER BY role',[id]),
      this.pool.query('SELECT id,record FROM demo_changes WHERE session_id=$1',[id]),
      this.pool.query('SELECT id,status,amount FROM demo_orders WHERE session_id=$1 ORDER BY id',[id]),
      this.pool.query('SELECT id,template_id AS "templateId",persona,device_id AS "deviceId",observed_at AS "observedAt",revision,output FROM demo_queries WHERE session_id=$1 ORDER BY observed_at DESC LIMIT 100',[id]),
      this.pool.query('SELECT id,type,occurred_at AS "occurredAt",payload FROM demo_events WHERE session_id=$1 ORDER BY occurred_at,id',[id]),
      this.pool.query('SELECT id,text,created_at AS "createdAt" FROM demo_work_notes WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20',[id])]);
    return {session:sessionView(session),resources:outputs[0].rows,incidents:outputs[1].rows,changes:outputs[2].rows,orders:outputs[3].rows,queries:outputs[4].rows,events:outputs[5].rows,workNotes:outputs[6].rows};
  }
  async begin(id:string,expectedRevision:number,workflowId:string,actorId:string) {
    return this.tx(async c=>{
      const row=await c.query("UPDATE demo_sessions SET status='RUNNING',workflow_id=$3,last_error=NULL,updated_at=now() WHERE id=$1 AND revision=$2 AND status<>'RUNNING' AND last_investigated_revision IS DISTINCT FROM revision RETURNING *",[id,expectedRevision,workflowId]);
      if(!row.rows.length) throw new DemoConflict('Session changed, is already investigating, or this revision is already complete. Change the demo condition before investigating again.');
      await this.event(c,id,'DemoInvestigationStarted',{revision:expectedRevision,workflowId,actorId}); return sessionView(row.rows[0]);
    });
  }
  async finish(id:string,revision:number,note:string,error?:string) {
    await this.tx(async c=>{
      const result=await c.query("UPDATE demo_sessions SET status=$3,last_investigated_revision=CASE WHEN $3='COMPLETED' THEN revision ELSE NULL END,last_error=$4,updated_at=now() WHERE id=$1 AND revision=$2 AND status='RUNNING' RETURNING id",[id,revision,error?'FAILED':'COMPLETED',error||null]);
      if(!result.rows.length) throw new DemoConflict('Investigation no longer owns this session revision.');
      if(note) await c.query('INSERT INTO demo_work_notes(id,session_id,text) VALUES($1,$2,$3)',[crypto.randomUUID(),id,note]);
      await this.event(c,id,error?'DemoInvestigationFailed':'DemoInvestigationCompleted',{revision,error:error||null});
    });
  }
  async condition(id:string,revision:number,faulted:boolean,actorId:string) {
    return this.tx(async c=>{
      const row=(await c.query('SELECT * FROM demo_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row || row.revision!==revision || row.status==='RUNNING') throw new DemoConflict('Session changed or is investigating. Refresh before changing demo conditions.');
      if(!faulted && (row.state!=='FAULTED' || row.last_investigated_revision!==revision || row.status!=='COMPLETED')) throw new DemoConflict('Investigate this fault revision successfully before approving a demo repair.');
      if(!faulted) {
        const roles=demoScenarios.find(s=>s.id===row.scenario_id)!.roles;
        const queried=await c.query('SELECT DISTINCT persona FROM demo_queries WHERE session_id=$1 AND revision=$2',[id,revision]);
        if(roles.some(role=>!queried.rows.some(r=>r.persona===role))) throw new DemoConflict('Repair needs diagnostic queries from every assigned role for this revision.');
      }
      const resources=(await c.query('SELECT id,role FROM demo_resources WHERE session_id=$1',[id])).rows;
      for(const r of resources) await c.query('UPDATE demo_resources SET state=$2::jsonb,updated_at=now() WHERE id=$1',[r.id,JSON.stringify(resourceState(row.scenario_id,r.role,faulted))]);
      await c.query('UPDATE demo_orders SET status=$2 WHERE session_id=$1',[id,faulted?'WAITING':'PROCESSED']);
      const updated=await c.query("UPDATE demo_sessions SET revision=revision+1,state=$2,status='IDLE',last_investigated_revision=NULL,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[id,faulted?'FAULTED':'REPAIRED']);
      await this.event(c,id,faulted?'DemoFaultInjected':'DemoRepairApplied',{actorId,previousRevision:revision,revision:revision+1,scope:'SANDBOX_ROWS_ONLY',operatorApproved:!faulted});
      return sessionView(updated.rows[0]);
    });
  }
  async recover() {
    await this.tx(async c=>{
      const rows=(await c.query("UPDATE demo_sessions SET status='INTERRUPTED',last_error='Application restarted during investigation',updated_at=now() WHERE status='RUNNING' RETURNING id,revision")).rows;
      for(const row of rows) await this.event(c,row.id,'DemoInvestigationInterrupted',{revision:row.revision});
    });
  }
  async diagnose(request:ProxyCommandRequest):Promise<ProxyCommandResponse> {
    const allowed:Record<string,string[]>={
      NETWORK:['NETWORK_INTERFACE_SUMMARY','NETWORK_ACCESS_VLAN','NETWORK_PATH_MTU','NETWORK_BGP_SUMMARY','NETWORK_ROUTE_SUMMARY','NETWORK_NEIGHBOR_SUMMARY','NETWORK_FIREWALL_SESSION_SUMMARY','NETWORK_WIRELESS_CLIENT_SUMMARY','NETWORK_SDWAN_CONTROL_SUMMARY'],
      WINDOWS:['WINDOWS_RECENT_SYSTEM_ERRORS','WINDOWS_SERVICE_STATUS','WINDOWS_NETWORK_VALIDATION','WINDOWS_DNS_VALIDATION','WINDOWS_KERBEROS_VALIDATION','WINDOWS_IIS_VALIDATION'],
      LINUX:['LINUX_SERVICE_FAILURES','LINUX_RECENT_ERRORS','LINUX_NETWORK_VALIDATION'],DATABASE:['DATABASE_CONNECTION_HEALTH'],CLOUDOPS:['CLOUD_RESOURCE_HEALTH'],DEVOPS:['DEVOPS_RECENT_EVENTS'],MIDDLEWARE:['MIDDLEWARE_QUEUE_HEALTH'],SECURITY:['SECURITY_THREAT_INDICATORS']};
    if(!allowed[request.persona]?.includes(request.templateId)) throw new Error('Template/persona is not supported by the demo database.');
    return this.tx(async c=>{
      const row=(await c.query(`SELECT r.id,r.role,r.name,r.state,s.id AS session_id,s.revision,s.state AS condition,s.workflow_id
        FROM demo_resources r JOIN demo_sessions s ON s.id=r.session_id
        JOIN demo_incidents i ON i.session_id=s.id AND i.id=$2
        WHERE r.id=$1 AND r.role=$3 AND s.workflow_id=$4 AND s.status='RUNNING'`,[request.deviceId,request.incidentId,request.persona,request.workflowId])).rows[0];
      if(!row) throw new Error('Demo diagnostic is not bound to the active session, incident, workflow and role.');
      const id=crypto.randomUUID();
      const output={dataOrigin:'SIMULATION',source:'POSTGRESQL_DEMO',sessionId:row.session_id,revision:row.revision,resource:row.name,role:row.role,condition:row.condition,observations:row.state};
      const result=await c.query('INSERT INTO demo_queries(id,session_id,template_id,persona,device_id,revision,output) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING observed_at',[id,row.session_id,request.templateId,request.persona,request.deviceId,row.revision,JSON.stringify(output)]);
      return {executionId:id,status:'SIMULATED',output:JSON.stringify(output),observedAt:result.rows[0].observed_at.toISOString(),proxyAuditId:`demo-db-${id}`};
    });
  }
}
