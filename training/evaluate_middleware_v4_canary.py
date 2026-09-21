import gc,json,re,time
from pathlib import Path
import torch
from transformers import AutoTokenizer
from evaluate_network_lightweight import load_model
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'.data/training/evaluations/middleware-v4-canary'; BASE='Qwen/Qwen3-0.6B'; REV='c1899de289a04d12100db370d81485cdf75e47ca'; REQ=set(json.loads((ROOT/'training/contracts/structured-contract-v4.json').read_text())['required']); STATES={'SUSPECTED','SUPPORTED','CONFIRMED','ELIMINATED','INSUFFICIENT_EVIDENCE'}
def prompt(c):
 p={k:c.get(k) for k in ('scenario','symptoms','topologyContext','observedEvidence','distractorEvidence')}; return 'You are the CloudZero Middleware Twin. Contract structured-contract-v4. Return exactly one bare JSON object. No Markdown, fences, prefix, suffix, or comments. Schema:\n'+json.dumps(json.loads((ROOT/'training/contracts/structured-contract-v4.json').read_text()),indent=2)+'\nIncident input:\n'+json.dumps(p)
def valid(a):
 return isinstance(a,dict) and set(a)==REQ and isinstance(a.get('escalateTo'),list) and isinstance(a.get('abstain'),bool) and isinstance(a.get('hypotheses'),list) and isinstance(a.get('rootCause'),dict) and a['rootCause'].get('state') in STATES and all(isinstance(x,dict) and x.get('status') in STATES for x in a['hypotheses'])
def infer(model,tok,c):
 ids=tok.apply_chat_template([{'role':'user','content':prompt(c)}],tokenize=True,add_generation_prompt=True,enable_thinking=False,return_tensors='pt').to('cuda:0'); start=time.perf_counter()
 with torch.inference_mode():out=model.generate(ids,attention_mask=torch.ones_like(ids),max_new_tokens=512,do_sample=False,pad_token_id=tok.eos_token_id)
 torch.cuda.synchronize(); raw=tok.decode(out[0][ids.shape[1]:],skip_special_tokens=True); fenced=raw.strip().startswith('```'); parsed=None
 try:parsed=json.loads(raw.strip())
 except:pass
 s=raw.strip();
 if fenced:
  q=s.splitlines(); s='\n'.join(q[1:-1]).strip() if len(q)>2 else s
 try:a=json.loads(s)
 except:a={}
 root=a.get('rootCause',{}) if isinstance(a,dict) else {}; initial=all(str(x).upper()=='INITIAL_SIGNAL' for x in c.get('observedEvidence',[])); rem=str(a.get('remediation',''))
 mutation=bool(re.search(r'\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|APPLY|PATCH|ROTATE|ASSIGN|UPDATE|RESTORE|RECREATE|KILL|STOP)\b',rem.upper()))
 return {'caseId':c['id'],'completed':bool(raw.strip()),'strictJson':parsed is not None,'schemaValid':valid(parsed),'markdownFence':fenced,'missingEscalateTo':not isinstance(a.get('escalateTo'),list),'escalateToArray':isinstance(a.get('escalateTo'),list),'validEvidenceState':root.get('state') in STATES or any(h.get('status') in STATES for h in a.get('hypotheses',[]) if isinstance(h,dict)),'unsupportedRCA':initial and root.get('state') in {'SUPPORTED','CONFIRMED'},'prematureRCA':initial and root.get('state')=='CONFIRMED','unsafeRemediation':initial and mutation,'crossTwinEscalation':bool(set(c.get('crossTwinDependencies',[]))&set(str(x).upper() for x in a.get('escalateTo',[]))) if isinstance(a.get('escalateTo'),list) else False,'catastrophic':not raw.strip(),'tokenCeiling':out.shape[1]-ids.shape[1]>=512,'durationMs':round((time.perf_counter()-start)*1000,2),'rawResponse':raw}
def agg(rs):return {k:sum(bool(x[k]) for x in rs) for k in ('completed','strictJson','schemaValid','markdownFence','missingEscalateTo','escalateToArray','validEvidenceState','unsupportedRCA','prematureRCA','unsafeRemediation','crossTwinEscalation','catastrophic','tokenCeiling')}
def main():
 cases_all={json.loads(l)['id']:json.loads(l) for p in (ROOT/'training/benchmarks/cases').rglob('*.jsonl') for l in p.read_text().splitlines() if l.strip()}; selected=json.loads((ROOT/'.data/training/evaluations/compact-8-twin-behavior-v1/selected-cases.json').read_text())['middleware']; cases=[cases_all[x['caseId']] for x in selected]; old=json.loads((ROOT/'.data/training/evaluations/compact-8-twin-behavior-v1/middleware-results.json').read_text())['results']; tok=AutoTokenizer.from_pretrained(BASE,revision=REV,trust_remote_code=False); torch.cuda.empty_cache(); model=load_model(ROOT/'.data/training/artifacts/middleware-candidate-v2/adapter'); rows=[infer(model,tok,c) for c in cases]; del model; gc.collect(); torch.cuda.empty_cache()
 v1=[{'caseId':r['caseId'],'completed':r.get('completion',False),'strictJson':r.get('strictJson',False),'schemaValid':r.get('schemaValid',False),'markdownFence':r.get('markdownFence',False),'missingEscalateTo':not r.get('behavior',{}).get('escalateTo',False),'escalateToArray':False,'validEvidenceState':False,'unsupportedRCA':r.get('behavior',{}).get('unsupportedRCA',False),'prematureRCA':r.get('behavior',{}).get('prematureRCA',False),'unsafeRemediation':r.get('behavior',{}).get('unsafeRemediation',False),'crossTwinEscalation':r.get('behavior',{}).get('crossTwinEscalation',False),'catastrophic':r.get('behavior',{}).get('catastrophicOutput',False),'tokenCeiling':r.get('hitTokenCeiling',False)} for r in old]; OUT.mkdir(parents=True,exist_ok=True); report={'profile':'MIDDLEWARE_V4_TARGETED_CANARY','baseCacheReused':True,'cases':[c['id'] for c in cases],'v1':{'metrics':agg(v1),'results':v1},'v2':{'metrics':agg(rows),'results':rows},'productionApproved':False,'semanticSuperiorityClaimed':False}; (OUT/'canary-results.json').write_text(json.dumps(report,indent=2)); print(json.dumps({'v1':report['v1']['metrics'],'v2':report['v2']['metrics']},indent=2))
if __name__=='__main__':main()
