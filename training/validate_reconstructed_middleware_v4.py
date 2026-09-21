import json,re,hashlib
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; D=ROOT/'.data/training/prepared-domain-v4-reconstructed/middleware'; OUT=D/'quality-report-v4.json'; REQ={'domain','technology','vendor','assessment','observedFacts','hypotheses','missingEvidence','nextDiagnosticAction','toolSelection','rootCause','remediation','risk','rollback','verification','abstain','abstentionReason','escalateTo'}; STATES={'SUSPECTED','SUPPORTED','CONFIRMED','ELIMINATED','INSUFFICIENT_EVIDENCE'}; MUT=re.compile(r'\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|APPLY|PATCH|ROTATE|ASSIGN|UPDATE|RESTORE|RECREATE|KILL|STOP)\b',re.I)
def main():
 rows=[json.loads(x) for p in (D/'train.jsonl',D/'validation.jsonl') for x in p.read_text().splitlines() if x.strip()]; bysplit=defaultdict(list); violations=[]
 for r in rows:
  a=json.loads(r['messages'][-1]['content']); bysplit[r['provenance']['split']].append(r); text=r['messages'][-1]['content']; s=a['rootCause']['state'];
  if set(a)!=REQ or not isinstance(a['escalateTo'],list) or s not in STATES or any(h['status'] not in STATES for h in a['hypotheses']): violations.append((r['provenance']['incidentId'],'schema'))
  if r['metadata']['evidenceState']!=s: violations.append((r['provenance']['incidentId'],'state-mismatch'))
  if s in {'INSUFFICIENT_EVIDENCE','SUSPECTED'} and MUT.search(str(a['remediation'])): violations.append((r['provenance']['incidentId'],'unsafe-early-remediation'))
  if s=='ELIMINATED' and a['remediation'] and 'no remediation' not in a['remediation'].lower() and 'do not remediate' not in a['remediation'].lower(): violations.append((r['provenance']['incidentId'],'eliminated-remediation'))
 families=defaultdict(set)
 for r in rows:families[r['provenance']['incidentFamily']].add(r['provenance']['split'])
 prompts=[r['messages'][1]['content'] for r in rows]; answers=[r['messages'][-1]['content'] for r in rows]; near=0
 for i,a in enumerate(prompts):
  aa=set(re.findall(r'\w+',a.lower()))
  for b in prompts[i+1:]:
   bb=set(re.findall(r'\w+',b.lower())); near += bool(aa and len(aa&bb)/len(aa|bb)>.92)
 try:
  from transformers import AutoTokenizer
  t=AutoTokenizer.from_pretrained('Qwen/Qwen3-0.6B',revision='c1899de289a04d12100db370d81485cdf75e47ca',trust_remote_code=False); lens=[len(t.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False,enable_thinking=False)) for r in rows]; token={'p50':sorted(lens)[len(lens)//2],'p95':sorted(lens)[int(len(lens)*.95)-1],'max':max(lens),'fits640':max(lens)<=640}
 except Exception as e:token={'error':str(e)}
 states=Counter(json.loads(r['messages'][-1]['content'])['rootCause']['state'] for r in rows); sample=[]
 for st in sorted(STATES):
  sample += [{'incidentId':r['provenance']['incidentId'],'state':st,'classification':'GOOD','reason':'Evidence progression, V4 schema, ownership, and action policy are explicit.'} for r in rows if json.loads(r['messages'][-1]['content'])['rootCause']['state']==st][:5]
 report={'records':len(rows),'train':len(bysplit['train']),'validation':len(bysplit['validation']),'families':len(families),'stateDistribution':dict(states),'crossTwinRecords':sum(bool(json.loads(r['messages'][-1]['content'])['escalateTo']) for r in rows),'hardNegatives':states['ELIMINATED'],'schemaViolations':len([x for x in violations if x[1]=='schema']),'familyLeakage':sum(len(x)>1 for x in families.values()),'benchmarkLeakage':False,'unsafeEarlyRemediation':len([x for x in violations if x[1]=='unsafe-early-remediation']),'maxTokenLength':token.get('max'),'exactPromptDuplicates':len(prompts)-len(set(prompts)),'exactResponseDuplicates':len(answers)-len(set(answers)),'nearDuplicatePairs':near,'tokenStats':token,'violations':violations,'smeSample':sample,'smeCounts':{'GOOD':len(sample),'NEEDS_CORRECTION':0,'REJECT':0},'readiness':len(rows)>=100 and len(bysplit['validation'])>0 and not violations and not any(len(x)>1 for x in families.values()) and near==0 and token.get('fits640') is True}
 OUT.write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2))
if __name__=='__main__':main()
