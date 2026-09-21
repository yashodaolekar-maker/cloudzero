import { mkdir, writeFile } from 'node:fs/promises';
const datasource = { type: 'prometheus', uid: 'cloudzero-prometheus' };
const filter = 'role=~"$role",mode=~"$mode"';
const sum = (metric, extra = '') => `sum(${metric}{${filter}${extra ? ',' + extra : ''}})`;
const decisions = extra => sum('cloudzero_twin_decisions', extra);
const correct = decisions('verdict="CORRECT"'), wrong = decisions('verdict="WRONG"');
const reviewed = decisions('verdict=~"CORRECT|WRONG|INCONCLUSIVE"');
const accuracy = `${correct} / (${correct} + ${wrong})`;
const coverage = `${reviewed} / ${decisions('')}`;
const sla = `${sum('cloudzero_twin_sla_tasks','status="MET"')} / ${sum('cloudzero_twin_sla_tasks','status=~"MET|BREACHED"')}`;
const panels = [];
function panel(title, expr, x, y, w = 6, h = 4, unit = 'short', type = 'stat', description = '', legendFormat) {
  panels.push({ id: panels.length + 1, title, description, type, datasource, gridPos: { x, y, w, h },
    fieldConfig: { defaults: { unit, noValue: 'N/A', color: { mode: type === 'timeseries' ? 'palette-classic' : 'thresholds' },
      thresholds: { mode: 'absolute', steps: [{ color: 'blue', value: null }] } }, overrides: [] },
    options: type === 'timeseries' ? { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } }
      : { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, orientation: 'auto', colorMode: 'value', graphMode: 'none', textMode: 'auto', displayMode: 'gradient' },
    targets: [{ refId: 'A', expr, instant: type !== 'timeseries', range: type === 'timeseries', legendFormat: legendFormat || title }] });
}
panels.push({ id: 1, title: 'Measured work. Reviewed decisions.', type: 'text', gridPos: {x: 0,y: 0,w:24,h:4}, options: { mode: 'markdown', content:
  '**Every value comes from the durable task ledger.** Current cards are rolling 30-day cohorts plus open tasks; the time picker controls the trend history, not the cohort length. Choose LIVE for production observations. SIMULATION and UNKNOWN are separate populations. Completion does not prove a correct decision.\n\n[Inspect tasks, incidents, evidence and reviews in CloudZero](http://localhost:3000/?twinActivity=1) · Scrape interval: 15 seconds · Historical snapshots retained: 90 days. No incident descriptions or IDs are sent to Prometheus.' } });
panel('Recorded tasks · 30d + open', sum('cloudzero_twin_tasks'),0,4);
panel('Completed work',sum('cloudzero_twin_tasks','status="COMPLETED"'),6,4);
panel('Failed / blocked / interrupted',sum('cloudzero_twin_tasks','status=~"FAILED|BLOCKED|INTERRUPTED"'),12,4);
panel('Open work',sum('cloudzero_twin_tasks','status="RUNNING"'),18,4);
panel('Correct · human reviewed',correct,0,8);
panel('Wrong · human reviewed',wrong,6,8);
panel('Inconclusive reviews',decisions('verdict="INCONCLUSIVE"'),12,8);
panel('Awaiting review',decisions('verdict="UNREVIEWED"'),18,8);
panel('Decision accuracy',accuracy,0,12,6,4,'percentunit','stat','Correct / (correct + wrong). Inconclusive and unreviewed excluded. N/A means no decisive reviews.');
panel('Review coverage',coverage,6,12,6,4,'percentunit','stat','(Correct + wrong + inconclusive) / all decision-bearing tasks.');
panel('Task response SLA compliance',sla,12,12,6,4,'percentunit','stat','MET / (MET + BREACHED). Overdue open tasks count as breaches. Missing legacy policy/timing excluded. Terminal failures may meet the response-time target; see failure panel for execution success.');
panel('Timing / policy unknown',sum('cloudzero_twin_sla_tasks','status="UNKNOWN"'),18,12);
panel('Task volume by role',`sum by (role) (cloudzero_twin_tasks{${filter}})`,0,16,12,7,'short','bargauge','Recorded agent work units. A2A participant replies and owner assessments are separate work units.','{{role}}');
panel('Decision accuracy by role',`sum by (role) (cloudzero_twin_decisions{${filter},verdict="CORRECT"}) / sum by (role) (cloudzero_twin_decisions{${filter},verdict=~"CORRECT|WRONG"})`,12,16,12,7,'percentunit','bargauge','Human-reviewed accuracy, not model confidence.','{{role}}');
panel('Review accuracy trend · rolling cohorts',accuracy,0,23,12,7,'percentunit','timeseries');
panel('SLA compliance trend · rolling cohorts',sla,12,23,12,7,'percentunit','timeseries');
panel('Work type',`sum by (kind) (cloudzero_twin_task_kind{${filter}})`,0,30,8,6,'short','bargauge','','{{kind}}');
panel('Model result',`sum by (result) (cloudzero_twin_model_results{${filter}})`,8,30,8,6,'short','bargauge','Model output validity is not decision correctness. Detailed provider attempts are in each task timeline.','{{result}}');
panel('Mean measured terminal task time',`${sum('cloudzero_twin_task_duration_seconds_sum')} / ${sum('cloudzero_twin_task_duration_seconds_count')}`,16,30,8,6,'s','stat','Mean of completed tasks with measured start/end; excludes interrupted and legacy records without timing.');
panel('Configured response targets', 'cloudzero_twin_policy_target_seconds',0,36,12,6,'s','bargauge','New runs snapshot these values and policy version. Past runs retain their original target.','{{kind}}');
panel('Quality review gate (1 = meets targets)',`((${correct} + ${wrong}) >= bool scalar(cloudzero_twin_policy_minimum_reviewed)) * ((${accuracy}) >= bool scalar(cloudzero_twin_policy_accuracy_target)) * ((${coverage}) >= bool scalar(cloudzero_twin_policy_coverage_target))`,12,36,12,6,'short','stat','At least 20 decisive reviews, 90% accuracy and 80% coverage by default. Reporting only; never grants execution authority.');
panel('Exporter reachable', 'up{job="cloudzero-twins"}',0,42,6,4,'short','stat','1 = scrape successful. 0 or missing means dashboard data cannot be considered current.');
panel('SLA breaches',sum('cloudzero_twin_sla_tasks','status="BREACHED"'),6,42,6,4);
panel('Distinct incident IDs worked',sum('cloudzero_twin_incidents'),12,42,12,4,'short','stat','Sum of distinct incidents per role; cross-role incidents count once for each participating role. General conversations and system scans excluded.');
panels.push({ id: panels.length + 1, title: 'SLA and review methodology', type: 'text', gridPos:{x:0,y:46,w:24,h:6}, options: {mode:'markdown',content:
  '**Proposed local task policy, not a contractual ServiceNow incident-resolution SLA.** 24×7 elapsed wall time from durable start to terminal event includes queue, model and tool time; there are no business-hour pauses. Defaults: conversation 120s, diagnostic 120s, A2A participant 180s, owner assessment 180s, investigation 300s. A task exceeds its target only when elapsed time is greater than the target. An unfinished overdue task is a breach. Legacy records without timing or a captured policy are UNKNOWN.\n\nReviews are append-only and bound to the exact decision event. The latest review counts once; superseded verdicts remain in the audit trail. A wrong decision requires a correction. Only explicitly selected, decisive human reviews enter the training-candidate export. No automatic fine-tuning or execution-policy changes occur. Unreviewed and inconclusive decisions are never assumed correct.'} });
// Task latency is an operational objective, not the agreed incident SLA.
for (const item of panels) {
  item.title = item.title.replaceAll('SLA', 'SLO');
  if (item.gridPos.y >= 4) item.gridPos.y += 12;
}
const incidentMetric = status => `sum(cloudzero_incident_resolution_sla{mode=~"$mode",status=~"${status}"})`;
panel('Incident resolution SLA compliance',`${incidentMetric('MET')} / ${incidentMetric('MET|BREACHED')}`,0,4,6,4,'percentunit','stat','P1 1 hour; P2 8 hours. Includes overdue unresolved incidents. UNKNOWN clocks and unconfigured priorities excluded.');
panel('Incident SLA breaches',incidentMetric('BREACHED'),6,4,6,4,'short','stat','Ticket opening-to-recorded-resolution, 24x7 elapsed time. Not the agent task-response clock.');
panel('P1 resolution SLA','cloudzero_incident_resolution_target_seconds{priority="P1"}',12,4,6,4,'s');
panel('P2 resolution SLA','cloudzero_incident_resolution_target_seconds{priority="P2"}',18,4,6,4,'s');
panel('XLA · observed wireless journeys','cloudzero_journey_sessions{mode=~"$mode"}',0,8,6,4,'short','stat','Per-client AP-to-AP journeys, not AP uptime. Requires authenticated collector telemetry.');
panel('XLA · roaming interruption p95','cloudzero_journey_interruptionP95Ms{mode=~"$mode"}',6,8,6,4,'ms');
panel('XLA · session drops','cloudzero_journey_sessionDrops{mode=~"$mode"}',12,8,6,4);
panel('XLA · good journey fraction','cloudzero_journey_goodRate{mode=~"$mode"}',18,8,6,4,'percentunit','stat','GOOD/(GOOD+POOR); requires configured journey thresholds. Missing evidence remains UNKNOWN and is excluded. Always inspect unknown counts.');
panels.push({id:panels.length+1,title:'SLA vs XLA',type:'text',gridPos:{x:0,y:12,w:24,h:4},options:{mode:'markdown',content:'**SLA:** P1 incident resolution within **1 hour**; P2 within **8 hours**. P3 has no configured target. Uses ticket opening to recorded resolution with a 24×7 clock and no pauses. **XLA:** actual service journey quality. Wireless roaming observes interruption, packet loss, latency, authentication and session continuity. No positive experience is inferred from healthy APs or fast agents. Journey thresholds are unconfigured until agreed. Interaction surveys are supplemental feedback, not a substitute for service journey evidence.'}});
panel('XLA · unknown journeys','cloudzero_journey_unknown{mode=~"$mode"}',0,64,6,4);
panel('XLA · authentication failures','cloudzero_journey_authenticationFailures{mode=~"$mode"}',6,64,6,4);
panel('XLA · packet loss p95','cloudzero_journey_packetLossP95Percent{mode=~"$mode"}',12,64,6,4,'percent');
panel('Journey thresholds configured','cloudzero_journey_targets_configured{mode=~"$mode"}',18,64,6,4,'short','stat','0 = targets are not configured. No invented target values are used.');
panel('Interaction feedback · responses','cloudzero_interaction_responses{mode=~"$mode"}',0,68,8,4);
panel('Interaction feedback · reported ease','cloudzero_interaction_ease{mode=~"$mode"}',8,68,8,4,'short','stat','Explicit feedback, 1=very hard; 5=very easy. Separate from XLA journey evidence.');
panel('Interaction feedback · coverage','cloudzero_interaction_coverage{mode=~"$mode"}',16,68,8,4,'percentunit');
const dashboard = { uid: 'cloudzero-twins', title: 'CloudZero · SLA, journey XLA and twin decisions', tags: ['cloudzero','twins','audit'], schemaVersion: 39, version: 1, editable: false,
  timezone: 'browser', refresh: '15s', timepicker: {refresh_intervals:['15s','30s','1m','5m','15m','1h']}, time: {from:'now-6h',to:'now'}, panels,
  templating: {list: [
    {name:'mode',label:'Evidence mode',type:'custom',query:'LIVE,SIMULATION,UNKNOWN',multi:false,includeAll:false,current:{text:'SIMULATION',value:'SIMULATION'},options:['LIVE','SIMULATION','UNKNOWN'].map(value=>({text:value,value,selected:value==='SIMULATION'}))},
    {name:'role',label:'Engineering role',type:'custom',query:'NETWORK,WINDOWS,LINUX,CLOUDOPS,DEVOPS,SECURITY,DATABASE,MIDDLEWARE,OTHER',multi:true,includeAll:true,allValue:'.*',current:{text:'All',value:'$__all'}}
  ]}};
await mkdir('observability/grafana/dashboards', {recursive:true});
await writeFile('observability/grafana/dashboards/twins.json',JSON.stringify(dashboard,null,2)+'\n');
console.log(`Generated ${panels.length} provisioned Grafana panels.`);
