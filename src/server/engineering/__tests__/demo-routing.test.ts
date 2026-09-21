import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationPlan, diagnosticPlanFor } from '../../engineering-orchestrator.ts';
import { validateDemoConfiguration } from '../../demo-database.ts';
test('database storage provenance does not recruit an unrelated database twin', () => {
  const plan=collaborationPlan({category:'Switch',shortDescription:'Network access fails after Windows DNS maintenance',cmdbName:'demo-network-01',metadata:{ciClass:'network',source:'A2A_DEMO_DATABASE',dataOrigin:'SIMULATION'}} as any);
  assert.deepEqual(plan.participants,['NETWORK','WINDOWS']);
});
test('demo diagnostics are selected from the issue instead of fixed role defaults', () => {
  const base={id:'DEMO-session-NETWORK',category:'Switch',cmdbName:'demo-network-01',metadata:{source:'A2A_DEMO_DATABASE',dataOrigin:'SIMULATION',destinationRef:'checkout-app'}} as any;
  const vlan={...base,shortDescription:'Users cannot reach an application after a VLAN change',metadata:{...base.metadata,demoScenarioId:'network-vlan',interfaceRef:'Gi1/0/24'}};
  assert.deepEqual(diagnosticPlanFor('NETWORK',vlan).map(item=>item.templateId),['NETWORK_ACCESS_VLAN']);
  assert.equal(diagnosticPlanFor('NETWORK',vlan)[0].parameters.interface_ref,'Gi1/0/24');
  assert.deepEqual(diagnosticPlanFor('WINDOWS',vlan).map(item=>item.templateId),['WINDOWS_NETWORK_VALIDATION']);
  const kerberos={...base,cmdbName:'demo-windows-01',shortDescription:'Kerberos sign-in fails because of host clock drift',metadata:{...base.metadata,ciClass:'windows',demoScenarioId:'windows-kerberos'}};
  assert.deepEqual(diagnosticPlanFor('WINDOWS',kerberos).map(item=>item.templateId),['WINDOWS_KERBEROS_VALIDATION']);
  const iis={...base,cmdbName:'demo-windows-01',shortDescription:'IIS application pool remains stopped after deployment',metadata:{...base.metadata,ciClass:'windows',demoScenarioId:'windows-iis',serviceName:'CheckoutPool'}};
  assert.deepEqual(diagnosticPlanFor('WINDOWS',iis).map(item=>item.templateId),['WINDOWS_IIS_VALIDATION']);
  const dns={...base,cmdbName:'demo-windows-01',shortDescription:'Windows DNS did not restart after patching',metadata:{...base.metadata,ciClass:'windows',demoScenarioId:'windows-dns',destinationRef:'orders.internal'}};
  assert.deepEqual(diagnosticPlanFor('WINDOWS',dns).map(item=>item.templateId),['WINDOWS_SERVICE_STATUS','WINDOWS_DNS_VALIDATION']);
});
test('demo configuration rejects live profiles and primary database credentials', () => {
  const env={ENABLE_A2A_DB_DEMO:'true',OPERATING_MODE:'SIMULATION',DEPLOYMENT_PROFILE:'LOCAL_SIMULATION'};
  const url='postgresql://demo_app:local@demo-postgres/cloudzero_demo';
  validateDemoConfiguration(url,env);
  assert.throws(()=>validateDemoConfiguration(url,{...env,OPERATING_MODE:'LIVE'}));
  assert.throws(()=>validateDemoConfiguration('postgresql://cloudzero:local@postgres/cloudzero',env));
});
