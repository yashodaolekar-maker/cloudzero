"""Build-only, conservative Middleware V4 contract migration; never edits V3."""
import json, re, hashlib
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'.data/training/prepared-domain-v3/middleware'; OUT=ROOT/'.data/training/prepared-domain-v4/middleware'; CONTRACT=json.loads((ROOT/'training/contracts/structured-contract-v4.json').read_text())
MUTATE=re.compile(r'\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|APPLY|PATCH|ROTATE|ASSIGN|UPDATE|RESTORE|RECREATE|KILL|STOP)\b',re.I)
def valid(a):
 return set(a)==set(CONTRACT['required']) and isinstance(a['escalateTo'],list) and isinstance(a['abstain'],bool) and isinstance(a['hypotheses'],list) and isinstance(a['observedFacts'],list) and isinstance(a['missingEvidence'],list) and all(isinstance(x,str) for x in a['escalateTo'])
def transform(row):
 old=json.loads(row['messages'][-1]['content']); meta=row.get('metadata',{}); user=row['messages'][1]['content']; patch=meta.get('patch')=='EVIDENCE_STATE_V3'; abstain=bool(meta.get('abstention')) or str(old.get('hypotheses',[{}])[0].get('status','')).lower()=='open'
 if not patch and not abstain: return None,'SME_REVIEW_REQUIRED','Legacy supported/confirmed target has no independently discriminating comparator evidence.'
 state='INSUFFICIENT_EVIDENCE' if abstain else str(meta.get('patch') and meta.get('patch') and old.get('hypotheses',[{}])[0].get('status','')).upper()
 if state not in {'SUPPORTED','ELIMINATED'}: state='INSUFFICIENT_EVIDENCE'
 cause=old.get('hypotheses',[{}])[0].get('cause','') if state!='INSUFFICIENT_EVIDENCE' else ''
 evidence=old.get('hypotheses',[{}])[0].get('evidence',[]) if isinstance(old.get('hypotheses',[{}])[0],dict) else []
 a={'domain':old.get('domain','MIDDLEWARE'),'technology':old.get('technology',''),'vendor':old.get('vendor',''),'assessment':old.get('assessment',''),'observedFacts':old.get('observedFacts',[]),'hypotheses':[{'cause':cause,'status':state,'evidence':evidence}], 'missingEvidence':old.get('missingEvidence',[]),'nextDiagnosticAction':old.get('nextDiagnosticAction',{'action':'Collect discriminating evidence.','reason':'Evidence is not sufficient for mutation.'}),'toolSelection':old.get('toolSelection',{'tool':'Read-only domain diagnostics','reason':'Evidence collection only.'}),'rootCause':{'state':state,'cause':cause if state=='CONFIRMED' else '','evidence':evidence if state=='CONFIRMED' else []},'remediation':old.get('remediation','Read-only diagnostics only; no configuration change is eligible.'),'risk':old.get('risk','No mutation is eligible without confirmation and approval.'),'rollback':old.get('rollback','No change is authorized.'),'verification':old.get('verification','Validate the next evidence against affected and comparator scope.'),'abstain':state=='INSUFFICIENT_EVIDENCE','abstentionReason':old.get('abstentionReason','Evidence is insufficient to discriminate viable hypotheses.') if state=='INSUFFICIENT_EVIDENCE' else '','escalateTo':old.get('escalateTo',[]) if isinstance(old.get('escalateTo',[]),list) else []}
 if state in {'SUSPECTED','SUPPORTED','INSUFFICIENT_EVIDENCE'} and MUTATE.search(a['remediation']):
  a['remediation']='Collect read-only diagnostic evidence; no configuration-changing remediation is eligible at this state.'
 if not valid(a): return None,'SME_REVIEW_REQUIRED','Transformed record failed V4 validation.'
 return a,'DETERMINISTIC_REPAIR','State and safety fields normalized without asserting confirmation.'
def main():
 rows=[json.loads(x) for f in (SRC/'train.jsonl',SRC/'validation.jsonl') for x in f.read_text().splitlines() if x.strip()]; accepted=[]; quarantine=[]; reasons=Counter()
 for row in rows:
  a,kind,reason=transform(row); (accepted if a else quarantine).append({'incidentId':row.get('provenance',{}).get('incidentId'),'reason':reason,'classification':kind})
  if a:
   nr={'messages':[row['messages'][0],row['messages'][1],{'role':'assistant','content':json.dumps(a,separators=(',',':'))}],'provenance':row.get('provenance',{}),'metadata':{**row.get('metadata',{}),'contractVersion':'structured-contract-v4','repairClassification':kind}}
   accepted[-1]['record']=nr
  reasons[kind]+=1
 OUT.mkdir(parents=True,exist_ok=True); tr=[x['record'] for x in accepted if x.get('record')]; (OUT/'train.jsonl').write_text('\n'.join(json.dumps(x) for x in tr)+'\n'); (OUT/'validation.jsonl').write_text('');
 report={'source':str(SRC.relative_to(ROOT)),'records':len(rows),'accepted':len(tr),'quarantined':len(quarantine),'deterministicallyRepaired':sum(x['classification']=='DETERMINISTIC_REPAIR' for x in accepted),'quarantineReasons':dict(Counter(x['reason'] for x in quarantine)),'stateDistribution':dict(Counter(json.loads(x['messages'][-1]['content'])['rootCause']['state'] for x in tr)),'qualityGates':{'bareJson':all(not json.loads(x['messages'][-1]['content']).get('x','').startswith('```') for x in tr),'requiredFields':all(valid(json.loads(x['messages'][-1]['content'])) for x in tr),'escalateToArrays':all(isinstance(json.loads(x['messages'][-1]['content'])['escalateTo'],list) for x in tr),'mutatingUnsafeCount':sum(bool(MUTATE.search(str(json.loads(x['messages'][-1]['content'])['remediation']))) for x in tr),'trainingAllowed':False},'acceptedRecords':[{k:v for k,v in x.items() if k!='record'} for x in accepted],'quarantinedRecords':quarantine}
 (OUT/'quality-report-v4.json').write_text(json.dumps(report,indent=2)); print(json.dumps({k:report[k] for k in ('records','accepted','quarantined','deterministicallyRepaired','stateDistribution','qualityGates')},indent=2))
if __name__=='__main__':main()
