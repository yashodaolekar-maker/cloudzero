"""Re-score stored raw baseline responses without contacting Ollama."""
import argparse, json
from collections import defaultdict
from pathlib import Path
from .framework import load_cases, score_case, report
from .runner import benchmark_manifest
def main():
 p=argparse.ArgumentParser(); p.add_argument('--raw',type=Path,required=True); p.add_argument('--model',required=True); p.add_argument('--output',type=Path,required=True); p.add_argument('--benchmark-version',default='v1'); a=p.parse_args()
 all_cases=load_cases(Path(__file__).parent/'cases',version=a.benchmark_version); by={c['id']:c for c in all_cases}; results=[]
 for path in sorted(a.raw.glob('*.json')):
  item=json.loads(path.read_text(encoding='utf-8')); c=by[item['caseId']]; s=score_case(c,item.get('response',{}),item.get('latencyMs')); results.append({'caseId':c['id'],'twin':c['twin'],'difficulty':c['difficulty'],'technology':c['technology'],'failure':item.get('failure'),**s})
 cases=[by[r['caseId']] for r in results]; out=report(cases,results,a.model,a.benchmark_version); out['benchmarkHash']=benchmark_manifest(all_cases); out['evaluationMode']='MODEL_ONLY'; out['modelInfo']=json.loads((a.raw.parent/'run-metadata.json').read_text(encoding='utf-8')).get('modelInfo',{}) if (a.raw.parent/'run-metadata.json').exists() else {}
 for group in ('twin','difficulty','technology'):
  buckets=defaultdict(list)
  for r in results: buckets[r[group]].append(r)
  out[group+'Breakdown']={k:{'cases':len(v),'valid':sum(x['metrics'].get('structuredOutputValidity',0) for x in v),'metrics':{m:round(sum(x['metrics'][m] for x in v if m in x['metrics'])/sum(m in x['metrics'] for x in v),4) if any(m in x['metrics'] for x in v) else 'N/A' for m in sorted({m for x in v for m in x['metrics']})}} for k,v in sorted(buckets.items())}
 a.output.parent.mkdir(parents=True,exist_ok=True); a.output.with_suffix('.json').write_text(json.dumps(out,indent=2),encoding='utf-8'); a.output.with_suffix('.md').write_text('# '+out['title']+'\n\n'+json.dumps({k:out[k] for k in ('model','benchmarkVersion','benchmarkHash','caseCount','approvedCaseCount','metrics','twinBreakdown','difficultyBreakdown')},indent=2)+'\n',encoding='utf-8'); print(json.dumps({'cases':len(results),'valid':sum(x['metrics'].get('structuredOutputValidity',0) for x in results),'output':str(a.output)},indent=2))
if __name__=='__main__': main()
