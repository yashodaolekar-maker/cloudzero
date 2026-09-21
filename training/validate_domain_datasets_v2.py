import json, statistics
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from training.benchmarks.framework import load_cases
from training.prepare import benchmark_ids

ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'.data/training/domain-datasets-v2'; OUT=ROOT/'.data/training/prepared-domain-v2'; HASH='e7e70c277cc98f985c9242d6db70b3e09f106f9015cac000c2c05ebc0e0d10f9'
def rows(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def main():
    cases=load_cases(ROOT/'training/benchmarks/cases'); ids=benchmark_ids(); texts={c['scenario'] for c in cases}; report={'benchmarkHash':HASH,'datasets':{},'crossTwinExactDuplicateResponses':0,'crossTwinNearDuplicatePairs':0,'leakagePassed':True,'failures':[]}
    allanswers=[]
    for p in sorted(SRC.glob('*-behavior-v2.jsonl')):
        rs=rows(p); prompts=[r['messages'][1]['content'] for r in rs]; answers=[r['messages'][2]['content'] for r in rs]; families=Counter(r['provenance']['incidentFamily'] for r in rs); supported=sum(r['metadata']['supportedRCA'] for r in rs); abstain=sum(r['metadata']['abstention'] for r in rs); cross=sum(r['metadata']['crossDomain'] for r in rs); hard=sum(r['metadata']['hardNegative'] for r in rs); pairs=[]; near=0; highest=[]
        token_sets=[set(a.lower().split()) for a in answers]
        for i,a in enumerate(answers):
            for j in range(i):
                union=token_sets[i]|token_sets[j]; ratio=len(token_sets[i]&token_sets[j])/len(union) if union else 1.0
                if ratio>=.80: near+=1; pairs.append((ratio,rs[i]['provenance']['incidentId'],rs[j]['provenance']['incidentId']))
                if len(highest)<5 or ratio>highest[0][0]: highest=sorted((highest+[(ratio,rs[i]['provenance']['incidentId'],rs[j]['provenance']['incidentId'])]),key=lambda x:x[0])[-5:]
        for r in rs:
            if r.get('trainingReady') is not False or len(r.get('messages',[]))!=3: report['failures'].append(p.name+': schema/trainingReady')
            text=json.dumps(r,ensure_ascii=False)
            if any(k in text for k in ids) or any(t and t in text for t in texts): report['leakagePassed']=False
        trainkeys={k for i,k in enumerate(sorted(families)) if i%5==0}; train=[r for r in rs if r['provenance']['incidentFamily'] not in trainkeys]; val=[r for r in rs if r['provenance']['incidentFamily'] in trainkeys]; d=p.stem.replace('-behavior-v2','').upper()
        out=OUT/d.lower(); out.mkdir(parents=True,exist_ok=True); (out/'train.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in train),encoding='utf-8'); (out/'validation.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in val),encoding='utf-8')
        report['datasets'][d]={'examples':len(rs),'train':len(train),'validation':len(val),'supportedRCA':supported,'abstention':abstain,'crossDomain':cross,'hardNegative':hard,'abstentionRate':round(abstain/len(rs),4),'nearDuplicateAssistantPairs':near,'nearDuplicateRate':round(near/(len(rs)*(len(rs)-1)/2),6),'exactDuplicateAssistantResponses':len(answers)-len(set(answers)),'exactDuplicatePrompts':len(prompts)-len(set(prompts)),'highestSimilarityPairs':highest,'familyCount':len(families),'splitMethod':'incidentFamily-disjoint; every fifth sorted family group validation','sourceSha256':__import__('hashlib').sha256(p.read_bytes()).hexdigest()}
        allanswers.extend((d,a) for a in answers)
    for i,(d,a) in enumerate(allanswers):
        for d2,b in allanswers[:i]:
            if d!=d2 and a==b: report['crossTwinExactDuplicateResponses']+=1
    report['totalExamples']=sum(x['examples'] for x in report['datasets'].values()); (OUT/'quality-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8'); print(json.dumps(report,indent=2)); raise SystemExit(1 if report['failures'] or not report['leakagePassed'] else 0)
if __name__=='__main__': main()
