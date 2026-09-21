"""Validate generated non-Network domain datasets without training them."""
import json, re, statistics, sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.benchmarks.framework import load_cases
from training.prepare import benchmark_ids

def validate(root):
    benchmark=benchmark_ids(); benchmark_cases=load_cases(Path(__file__).parent/'benchmarks'/'cases')
    benchmark_text={str(c.get('scenario','')).strip() for c in benchmark_cases}
    result={}; failures=[]
    for path in sorted(Path(root).glob('*-behavior-v1.jsonl')):
        rows=[json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
        ids=Counter(r.get('provenance',{}).get('incidentId') for r in rows); difficulty=Counter(r.get('metadata',{}).get('difficulty') for r in rows); kinds=Counter(r.get('metadata',{}).get('caseType') for r in rows)
        lengths=[]; leaks=[]
        for row in rows:
            msgs=row.get('messages',[]); text=json.dumps(row,ensure_ascii=False)
            if row.get('trainingReady') is not False or len(msgs)!=3 or [m.get('role') for m in msgs]!=['system','user','assistant']: failures.append(f'{path.name}: invalid draft/messages')
            if not row.get('provenance',{}).get('domain') or not row.get('provenance',{}).get('incidentId'): failures.append(f'{path.name}: missing provenance')
            try: answer=json.loads(msgs[-1]['content'])
            except Exception: failures.append(f'{path.name}: assistant JSON invalid'); continue
            for key in ('observedFacts','hypotheses','missingEvidence','nextDiagnosticAction','toolSelection','rootCause','remediation','risk','rollback','verification','abstain','abstentionReason','escalateTo'):
                if key not in answer: failures.append(f'{path.name}: missing answer field {key}')
            lengths.append(max(1,len(msgs[-1]['content'])//4))
            if any(x in benchmark for x in re.findall(r'CZ-[A-Z_0-9-]+',text)) or any(s and s in text for s in benchmark_text): leaks.append(row.get('provenance',{}).get('incidentId'))
        result[path.stem]={'examples':len(rows),'duplicateIds':sum(x-1 for x in ids.values() if x>1),'difficulty':dict(difficulty),'caseTypes':dict(kinds),'abstention':sum(r.get('metadata',{}).get('abstention') is True for r in rows),'crossDomain':sum(r.get('metadata',{}).get('crossDomain') is True for r in rows),'unsafeActionCoverage':sum('risk' in json.loads(r['messages'][-1]['content']) for r in rows),'tokenStats':{'p50':statistics.median(lengths),'p90':sorted(lengths)[max(0,int(len(lengths)*.9)-1)],'p95':sorted(lengths)[max(0,int(len(lengths)*.95)-1)],'max':max(lengths) if lengths else 0},'leakageMatches':leaks}
    return {'datasets':result,'validationFailures':failures,'benchmarkLeakagePassed':not any(x.get('leakageMatches') for x in result.values()),'totalExamples':sum(x['examples'] for x in result.values())}
def main():
    root=Path(__file__).resolve().parents[1]/'.data'/'training'/'domain-datasets'; out=validate(root); print(json.dumps(out,indent=2)); (root/'validation-report.json').write_text(json.dumps(out,indent=2),encoding='utf-8'); raise SystemExit(1 if out['validationFailures'] or not out['benchmarkLeakagePassed'] else 0)
if __name__=='__main__': main()
