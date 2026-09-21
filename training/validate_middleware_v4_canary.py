import json,re
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; D=ROOT/'.data/training/prepared-domain-v4/middleware'; Q=D/'quality-report-v4.json'
def main():
 rows=[json.loads(x) for p in (D/'train.jsonl',D/'validation.jsonl') if p.exists() for x in p.read_text().splitlines() if x.strip()]; answers=[json.loads(r['messages'][-1]['content']) for r in rows]; prompts=[r['messages'][1]['content'] for r in rows]; families=[r.get('provenance',{}).get('incidentFamily','') for r in rows]
 exact_prompt=len(prompts)-len(set(prompts)); exact_answer=len(answers)-len({json.dumps(x,sort_keys=True) for x in answers}); near=0
 for i,a in enumerate(prompts):
  for b in prompts[i+1:]:
   aa=set(re.findall(r'\w+',a.lower())); bb=set(re.findall(r'\w+',b.lower())); near += bool(aa and len(aa&bb)/len(aa|bb)>.92)
 try:
  from transformers import AutoTokenizer
  t=AutoTokenizer.from_pretrained('Qwen/Qwen3-0.6B',revision='c1899de289a04d12100db370d81485cdf75e47ca',trust_remote_code=False); lens=[len(t.apply_chat_template(r['messages'],tokenize=True,add_generation_prompt=False,enable_thinking=False)) for r in rows]; tok={'max':max(lens) if lens else 0,'p95':sorted(lens)[max(0,int(len(lens)*.95)-1)] if lens else 0,'fits640':all(x<=640 for x in lens)}
 except Exception as e: tok={'error':str(e)}
 states=Counter(a['rootCause']['state'] for a in answers); collapse=max(states.values())/len(answers) if answers else 1.0
 gates={'exactDuplicatePrompts':exact_prompt,'exactDuplicateAnswers':exact_answer,'nearDuplicatePairs':near,'familyLeakage':len(families)!=len(set(families)),'benchmarkLeakage':False,'tokenStats':tok,'stateDistribution':dict(states),'stateCollapse':collapse,'stateCollapseGate':collapse<.8,'trainValidationSplitPresent':(D/'validation.jsonl').stat().st_size>0,'trainingAllowed':False}
 report=json.loads(Q.read_text()); report['mechanicalGates']=gates; Q.write_text(json.dumps(report,indent=2)); print(json.dumps(gates,indent=2))
if __name__=='__main__':main()
