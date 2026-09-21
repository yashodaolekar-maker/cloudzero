"""Mechanical quality gate and split preparation; never trains or changes source data."""
import argparse, hashlib, json, re, statistics
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; SOURCE=ROOT/'.data/training/domain-datasets'; OUT=ROOT/'.data/training/prepared-domain-v1'; REV='c1899de289a04d12100db370d81485cdf75e47ca'
def norm(s): return re.sub(r'\b(syn|windows|linux|database|middleware|cloudops|devops|cyber)[-_a-z0-9]*\b','TOKEN',s.lower())
def signature(s): return re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"','VALUE',s)
def read(path): return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
def quality(rows):
    prompts=[r['messages'][1]['content'] for r in rows]; answers=[r['messages'][2]['content'] for r in rows]; scenarios=[r['messages'][1]['content'].split('Initial evidence:')[0] for r in rows]
    ps=Counter(signature(x) for x in prompts); ass=Counter(signature(x) for x in answers); exact_a=len(answers)-len(set(answers)); exact_p=len(prompts)-len(set(prompts)); near_a=sum(n*(n-1)//2 for n in ass.values() if n>1); near_p=sum(n*(n-1)//2 for n in ps.values() if n>1); normalized=len(scenarios)-len(set(norm(x) for x in scenarios))
    return {'exactDuplicateAssistant':exact_a,'exactDuplicatePrompts':exact_p,'nearDuplicateAssistantPairs':near_a,'nearDuplicatePromptPairs':near_p,'normalizedScenarioCollisions':normalized,'templateWarning':near_a>len(rows)*2 or near_p>len(rows)*2}
def review(row):
    answer=json.loads(row['messages'][2]['content']); meta=row['metadata']; required=['observedFacts','hypotheses','missingEvidence','nextDiagnosticAction','toolSelection','rootCause','remediation','risk','rollback','verification']
    if any(not answer.get(k) for k in required): return 'REJECT'
    return 'NEEDS_SME_REVIEW'
def split(rows):
    # Family-disjoint deterministic split: every 5th family group to validation.
    groups={}
    for row in rows: groups.setdefault(row['provenance']['incidentFamily'],[]).append(row)
    keys=sorted(groups); valkeys={k for i,k in enumerate(keys) if i%5==0}; train=[]; val=[]
    for k in keys: (val if k in valkeys else train).extend(groups[k])
    return train,val
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--source',type=Path,default=SOURCE); ap.add_argument('--output',type=Path,default=OUT); args=ap.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    report={'tokenizer':{'available':False,'base':'Qwen/Qwen3-0.6B','revision':REV,'reason':'transformers/tokenizers are not installed; exact tokenization was not fabricated'},'datasets':{},'sourceUnchanged':True}
    for path in sorted(args.source.glob('*-behavior-v1.jsonl')):
        rows=read(path); train,val=split(rows); twin=path.stem.replace('-behavior-v1',''); statuses=[review(r) for r in rows]; q=quality(rows)
        sample=rows[::15][:10]; sample_status=[review(r) for r in sample]
        abstention_categories=Counter()
        for r in rows:
            m=r['metadata'];
            if m['abstention']:
                abstention_categories['insufficient_or_contradictory_evidence' if m['difficulty'] in ('L6_CONTRADICTORY_EVIDENCE','L7_INSUFFICIENT_EVIDENCE') else ('cross_domain_evidence_required' if m['crossDomain'] else ('deliberate_hard_negative' if m['caseType']=='HARD_NEGATIVE' else 'other_abstention'))]+=1
        td=args.output/twin; td.mkdir(parents=True,exist_ok=True)
        (td/'train.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n' for x in train),encoding='utf-8'); (td/'validation.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n' for x in val),encoding='utf-8')
        report['datasets'][twin]={'examples':len(rows),'train':len(train),'validation':len(val),'splitMethod':'sorted incidentFamily groups; every fifth family to validation','seed':'deterministic lexical ordering','quality':q,'abstention':{'unique':sum(r['metadata']['abstention'] for r in rows),'categories':dict(abstention_categories)},'sampleReview':{'sampleSize':len(sample),'caseIds':[r['provenance']['incidentId'] for r in sample],'statusCounts':dict(Counter(sample_status)),'recommendation':'NEEDS_SME_REVIEW','reason':'Synthetic development drafts require technical SME review; trainingReady remains false.'},'trainingReadySourceValues':sorted(set(r.get('trainingReady') for r in rows)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    (args.output/'quality-gate-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8'); print(json.dumps(report,indent=2))
if __name__=='__main__': main()
