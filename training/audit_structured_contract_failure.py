import json,re
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'.data/training/evaluations/compact-8-twin-behavior-v1'
TWINS=['network','windows','linux','database','middleware','cloudops','devops','cyber']
REQ={'domain','technology','vendor','assessment','observedFacts','hypotheses','missingEvidence','nextDiagnosticAction','toolSelection','rootCause','remediation','risk','rollback','verification','abstain','abstentionReason','escalateTo'}
SER={'MARKDOWN_FENCE','TRAILING_COMMA','PREFIX_TEXT','SUFFIX_TEXT','INVALID_JSON','TRUNCATED_OUTPUT','DUPLICATE_KEY'}
SCH={'MISSING_REQUIRED_FIELD','EXTRA_UNSUPPORTED_FIELD','WRONG_FIELD_TYPE','INVALID_ENUM','NULLABILITY_MISMATCH','NESTED_SCHEMA_MISMATCH','ARRAY_OBJECT_MISMATCH'}
def norm(s):
 s=(s or '').strip(); fenced=s.startswith('```')
 if fenced:
  q=s.splitlines(); q=q[1:] if q and q[0].startswith('```') else q; q=q[:-1] if q and q[-1].strip()=='```' else q; s='\n'.join(q).strip()
 try:return json.loads(s),('OUTER_FENCE_REMOVED' if fenced else 'UNMODIFIED')
 except: pass
 a,b=s.find('{'),s.rfind('}')
 if a>=0 and b>a:
  try:return json.loads(s[a:b+1]),'ISOLATED_OBJECT'
  except: pass
 return None,'FAILED'
def audit():
 rows=[]
 for t in TWINS:
  for r in json.loads((OUT/f'{t}-results.json').read_text())['results']:
   raw=r.get('rawResponse',''); parsed=None
   try: parsed=json.loads(raw.strip())
   except: pass
   f=set(); s=raw.strip()
   if s.startswith('```'):f.add('MARKDOWN_FENCE')
   a,b=s.find('{'),s.rfind('}')
   if not s.startswith('```') and a>0 and s[:a].strip():f.add('PREFIX_TEXT')
   if not s.startswith('```') and b>=0 and s[b+1:].strip():f.add('SUFFIX_TEXT')
   if re.search(r',\s*[}\]]',raw):f.add('TRAILING_COMMA')
   if parsed is None and not s.startswith('```'):f.add('INVALID_JSON')
   if parsed is not None:
    f.update(('MISSING_REQUIRED_FIELD',) if REQ-set(parsed) else ())
    f.update(('EXTRA_UNSUPPORTED_FIELD',) if set(parsed)-REQ else ())
    if not isinstance(parsed.get('rootCause'),dict) or not isinstance(parsed.get('nextDiagnosticAction'),dict) or not isinstance(parsed.get('toolSelection'),dict):f.add('NESTED_SCHEMA_MISMATCH')
    if not isinstance(parsed.get('hypotheses'),list) or not isinstance(parsed.get('observedFacts'),list) or not isinstance(parsed.get('missingEvidence'),list) or not isinstance(parsed.get('escalateTo'),list):f.add('ARRAY_OBJECT_MISMATCH')
    if not isinstance(parsed.get('abstain'),bool):f.add('WRONG_FIELD_TYPE')
   n,mode=norm(raw); nv=isinstance(n,dict) and not (REQ-set(n)) and not (set(n)-REQ) and isinstance(n.get('rootCause'),dict) and isinstance(n.get('nextDiagnosticAction'),dict) and isinstance(n.get('toolSelection'),dict) and isinstance(n.get('hypotheses'),list) and isinstance(n.get('observedFacts'),list) and isinstance(n.get('missingEvidence'),list) and isinstance(n.get('escalateTo'),list) and isinstance(n.get('abstain'),bool)
   if isinstance(n,dict):
    if REQ-set(n): f.add('MISSING_REQUIRED_FIELD')
    if set(n)-REQ: f.add('EXTRA_UNSUPPORTED_FIELD')
    if not isinstance(n.get('rootCause'),dict) or not isinstance(n.get('nextDiagnosticAction'),dict) or not isinstance(n.get('toolSelection'),dict): f.add('NESTED_SCHEMA_MISMATCH')
    if not isinstance(n.get('hypotheses'),list) or not isinstance(n.get('observedFacts'),list) or not isinstance(n.get('missingEvidence'),list) or not isinstance(n.get('escalateTo'),list): f.add('ARRAY_OBJECT_MISMATCH')
   b=r.get('behavior',{}); sem=[]
   if b.get('initialSignalViolation'):sem.append('PREMATURE_OR_UNSUPPORTED_RCA')
   if b.get('unsafeRemediation'):sem.append('UNSAFE_REMEDIATION')
   if b.get('overAbstention'):sem.append('OVER_ABSTENTION')
   rows.append({'twin':t,'caseId':r['caseId'],'strictSchemaValid':bool(r.get('schemaValid')),'normalizedSchemaValid':nv,'normalization':mode,'failures':sorted(f),'semanticFailures':sem})
 return rows
def target_audit():
 dirs={t:ROOT/f'.data/training/prepared-domain-v3/{t}' for t in TWINS if t!='network'}; dirs['network']=ROOT/'.data/training/user-proposed-prepared-network-v7'; out={}
 for t,d in dirs.items():
  rows=[]
  for p in (d/'train.jsonl',d/'validation.jsonl'):
   if p.exists():rows += [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
  keys=Counter(); fenced=0; statuses=Counter()
  for x in rows:
   try:a=json.loads(x['messages'][-1]['content']); keys.update(a.keys()); statuses.update(str(h.get('status','')).upper() for h in a.get('hypotheses',[]) if isinstance(h,dict)); fenced += x['messages'][-1]['content'].strip().startswith('```')
   except:continue
  out[t]={'directory':str(d.relative_to(ROOT)),'examples':len(rows),'fields':sorted(keys),'missingFields':sorted(REQ-set(keys)),'extraFields':sorted(set(keys)-REQ),'fieldCounts':dict(keys),'hypothesisStatuses':dict(statuses),'fencedAssistantTargets':fenced,'contractKeyMatch':not (REQ-set(keys) or set(keys)-REQ)}
 return out
def main():
 rows=audit(); counts=Counter(x for r in rows for x in r['failures']); sem=Counter(x for r in rows for x in r['semanticFailures']); per=defaultdict(Counter)
 for r in rows:per[r['twin']].update(r['failures'])
 strict=sum(r['strictSchemaValid'] for r in rows); normal=sum(r['normalizedSchemaValid'] for r in rows); sf=sum(counts[x] for x in SER); sc=sum(counts[x] for x in SCH); cls='FORMAT_DOMINATED' if sf>sc*1.5 else ('SCHEMA_DOMINATED' if sc>sf*1.5 else 'MIXED')
 report={'strict':strict,'normalized':normal,'strictPerTwin':{t:sum(r['strictSchemaValid'] for r in rows if r['twin']==t) for t in TWINS},'normalizedPerTwin':{t:sum(r['normalizedSchemaValid'] for r in rows if r['twin']==t) for t in TWINS},'failureCounts':dict(counts),'perTwinFailureCounts':{t:dict(per[t]) for t in TWINS},'semanticFailures':dict(sem),'distribution':{'serialization':sf,'schema':sc,'classification':cls},'outputs':rows,'trainingTargets':target_audit(),'inferenceSerialization':{'prompt':'framework.py/run_compact_8_twin_behavior_v1.py','trainingPrefix':'finetune.py applies tokenizer chat template to messages[:-1] with generation prompt','trainingFull':'finetune.py applies tokenizer chat template to full messages','evaluation':'user-only prompt with generation prompt; raw decoded completion','assistantTargetFences':'not observed in audited target sets'}}
 (OUT/'structured-contract-failure-audit.json').write_text(json.dumps(report,indent=2)); (OUT/'structured-contract-failure-audit.md').write_text('# Structured Contract Failure Audit\n\nStrict: **%s/32**  \nNormalized diagnostic: **%s/32**  \nDistribution: **%s**\n\nFailure counts:\n\n%s\n\nSemantic failures:\n%s\n'%(strict,normal,cls,'\n'.join('- %s: %s'%(k,v) for k,v in sorted(counts.items())),'\n'.join('- %s: %s'%(k,v) for k,v in sem.items())))
 print(json.dumps({'strict':strict,'normalized':normal,'counts':dict(counts),'semantic':dict(sem),'classification':cls},indent=2))
if __name__=='__main__':main()
