"""Replace the duplicate DevOps selection with frozen CZ-CROSS_TWIN-10 only."""
import argparse, gc, json, sys
from pathlib import Path
import torch
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/'training'))
from benchmarks.framework import load_cases
from run_compact_8_twin_behavior_v1 import OUT, BASE, REVISION, ADAPTERS, aggregate, delta, infer, load_model
from transformers import AutoTokenizer

def main():
    args=argparse.ArgumentParser(); args.add_argument('--rebuild-only',action='store_true'); args=args.parse_args()
    cases={x['id']:x for x in load_cases(ROOT/'training/benchmarks/cases','ALL',version='v1')}; case=cases['CZ-CROSS_TWIN-10']
    if args.rebuild_only:
        base_doc=json.loads((OUT/'base-results.json').read_text(encoding='utf8')); devops=json.loads((OUT/'devops-results.json').read_text(encoding='utf8'))
        base_by_id={x['caseId']:x for x in base_doc['results']}; comparisons=json.loads((OUT/'adapter-vs-base.json').read_text(encoding='utf8'))
        comparisons=[x for x in comparisons if x['twin']!='devops']
        comparisons += [{'twin':'devops','caseId':row['caseId'],'delta':delta(base_by_id[row['caseId']],row),'base':base_by_id[row['caseId']],'adapter':row} for row in devops['results']]
        (OUT/'adapter-vs-base.json').write_text(json.dumps(comparisons,indent=2),encoding='utf8')
        print(json.dumps({'repair':'comparison-rebuilt','devopsRows':len(devops['results'])},indent=2)); return
    base_doc=json.loads((OUT/'base-results.json').read_text(encoding='utf8')); tok=AutoTokenizer.from_pretrained(BASE,revision=REVISION,trust_remote_code=False)
    torch.cuda.empty_cache(); base=load_model(); base_row=infer(base,tok,case); del base; gc.collect(); torch.cuda.empty_cache()
    base_doc['results'].append(base_row); base_doc['repairCase']='CZ-CROSS_TWIN-10'; (OUT/'base-results.json').write_text(json.dumps(base_doc,indent=2),encoding='utf8')
    doc=json.loads((OUT/'devops-results.json').read_text(encoding='utf8')); model=load_model(ADAPTERS['devops']); row=infer(model,tok,case); del model; gc.collect(); torch.cuda.empty_cache()
    doc['results'][-1]=row; doc['summary']=aggregate(doc['results']); doc['summary']['gate']='RAW_BEHAVIOR_ACCEPTABLE_FOR_EXPERIMENT' if doc['summary']['completed']==4 and doc['summary']['schemaValid']==4 and not any(r['behavior'][x] for r in doc['results'] for x in ('unsupportedRCA','prematureRCA','unsafeRemediation','catastrophicOutput')) else 'RAW_BEHAVIOR_NEEDS_IMPROVEMENT'; doc['repairCase']='CZ-CROSS_TWIN-10'; (OUT/'devops-results.json').write_text(json.dumps(doc,indent=2),encoding='utf8')
    selected=json.loads((OUT/'selected-cases.json').read_text(encoding='utf8')); selected['devops'][-1]['caseId']='CZ-CROSS_TWIN-10'; (OUT/'selected-cases.json').write_text(json.dumps(selected,indent=2),encoding='utf8')
    raw=json.loads((OUT/'raw-behavior-summary.json').read_text(encoding='utf8')); raw['devops']=doc['summary']; (OUT/'raw-behavior-summary.json').write_text(json.dumps(raw,indent=2),encoding='utf8')
    comparisons=json.loads((OUT/'adapter-vs-base.json').read_text(encoding='utf8')); comparisons=[x for x in comparisons if not (x['twin']=='devops' and x['caseId']=='CZ-CROSS_TWIN-06' and x['adapter'].get('caseId')=='CZ-CROSS_TWIN-06')]; comparisons.append({'twin':'devops','caseId':case['id'],'delta':delta(base_row,row),'base':base_row,'adapter':row}); (OUT/'adapter-vs-base.json').write_text(json.dumps(comparisons,indent=2),encoding='utf8')
    print(json.dumps({'repair':'complete','case':case['id'],'devops':doc['summary']},indent=2))
if __name__=='__main__': main()
