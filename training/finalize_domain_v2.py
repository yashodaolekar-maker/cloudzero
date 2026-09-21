"""Exact-tokenizer readiness finalization; never trains or modifies source records."""
import argparse, hashlib, json, math, statistics, subprocess, sys
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'.data/training/domain-datasets-v2'; OUT=ROOT/'.data/training/prepared-domain-v2'; NETWORK=ROOT/'.data/training/user-proposed-prepared-network-v6'; REV='c1899de289a04d12100db370d81485cdf75e47ca'; MODEL='Qwen/Qwen3-0.6B'; BENCH='e7e70c277cc98f985c9242d6db70b3e09f106f9015cac000c2c05ebc0e0d10f9'
def read(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def stats(values):
    values=sorted(values); n=len(values); pct=lambda x: round(100*sum(v>x for v in values)/n,2)
    q=lambda p: values[min(n-1,max(0,math.ceil(p*n)-1))]
    return {'count':n,'p50':q(.50),'p90':q(.90),'p95':q(.95),'p99':q(.99),'max':max(values),'over512':pct(512),'over1024':pct(1024),'over1536':pct(1536),'over2048':pct(2048)}
def tokenize(tokenizer, row):
    messages=row['messages']; ids=tokenizer.apply_chat_template(messages,tokenize=True,add_generation_prompt=False,enable_thinking=False)
    return len(ids)
def duplicate_stats(rows):
    prompts=[json.dumps(r.get('messages',[]),ensure_ascii=False,sort_keys=True) for r in rows]
    answers=[json.dumps([m for m in r.get('messages',[]) if m.get('role')=='assistant'],ensure_ascii=False,sort_keys=True) for r in rows]
    return {'duplicatePrompts':len(prompts)-len(set(prompts)),'duplicateAssistantResponses':len(answers)-len(set(answers))}
def split(rows):
    groups={}
    for r in rows: groups.setdefault(r['provenance']['incidentFamily'],[]).append(r)
    keys=sorted(groups); validation={k for i,k in enumerate(keys) if i%5==0}; train=[r for k in keys if k not in validation for r in groups[k]]; val=[r for k in keys if k in validation for r in groups[k]]
    return train,val,sorted(set(r['provenance']['incidentFamily'] for r in train)),sorted(set(r['provenance']['incidentFamily'] for r in val))
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--output',type=Path,default=OUT); a=ap.parse_args(); a.output.mkdir(parents=True,exist_ok=True)
    from transformers import AutoTokenizer
    tokenizer=AutoTokenizer.from_pretrained(MODEL,revision=REV,trust_remote_code=False)
    report={'baseModel':MODEL,'revision':REV,'benchmarkHash':BENCH,'tokenizerClass':type(tokenizer).__name__,'datasets':{},'overall':{},'sourceRecordsUnchanged':True}
    all_lengths=[]
    for p in sorted(SRC.glob('*-behavior-v2.jsonl')):
        rows=read(p); lengths=[tokenize(tokenizer,r) for r in rows]; all_lengths.extend(lengths); train,val,tf,vf=split(rows); name=p.stem.replace('-behavior-v2',''); d=a.output/name; d.mkdir(parents=True,exist_ok=True); (d/'train.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in train),encoding='utf-8'); (d/'validation.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in val),encoding='utf-8'); s=stats(lengths); report['datasets'][name]={'total':len(rows),'train':len(train),'validation':len(val),'tokenStats':s,'trainFamilies':tf,'validationFamilies':vf,'splitDisjoint':not(set(tf)&set(vf)),'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'maxLengthPreservation':{str(x):round(100-sum(v>x for v in lengths)/len(lengths)*100,2) for x in (512,1024,1536,2048)}}
    nettrain=read(NETWORK/'train.jsonl'); netval=read(NETWORK/'validation.jsonl'); netall=nettrain+netval; nlen=[tokenize(tokenizer,r) for r in netall]; all_lengths.extend(nlen); tf=sorted(set(r.get('provenance',{}).get('incidentFamily') for r in nettrain)); vf=sorted(set(r.get('provenance',{}).get('incidentFamily') for r in netval)); report['datasets']['network']={'total':len(netall),'train':len(nettrain),'validation':len(netval),'tokenStats':stats(nlen),'trainFamilies':tf,'validationFamilies':vf,'splitDisjoint':not(set(tf)&set(vf)),'source':'existing '+str(NETWORK.relative_to(ROOT)),'sourceSha256Train':hashlib.sha256((NETWORK/'train.jsonl').read_bytes()).hexdigest(),'sourceSha256Validation':hashlib.sha256((NETWORK/'validation.jsonl').read_bytes()).hexdigest(),'maxLengthPreservation':{str(x):round(100-sum(v>x for v in nlen)/len(nlen)*100,2) for x in (512,1024,1536,2048)}}
    report['overall']=stats(all_lengths); candidates=[512,1024,1536,2048]; selected=next((x for x in candidates if report['overall']['over'+str(x)]<=5),2048); report['selectedMaxSeqLength']=selected; report['fullyPreservedPercent']=round(100-report['overall']['over'+str(selected)],2); report['requiresTruncation']=sum(v>selected for v in all_lengths); report['qloraConfig']={'baseModel':MODEL,'revision':REV,'bits':4,'quantType':'nf4','doubleQuantization':True,'loraRank':8,'loraAlpha':16,'loraDropout':0.05,'targetModules':['q_proj','v_proj'],'epochs':1,'batchSize':1,'gradientAccumulation':8,'learningRate':1e-4,'gradientCheckpointing':True,'seed':42,'maxSequenceLength':selected}
    report['commands']={k:f'python training/finetune.py --data .data/training/prepared-domain-v2/{k} --output .data/training/artifacts/{k}-candidate-v1 --base-model {MODEL} --revision {REV} --max-length {selected} --epochs 1 --recipe 4b --preflight' for k in ('windows','linux','database','middleware','cloudops','devops','cyber')}
    report['networkCommand']=f'python training/finetune.py --data {NETWORK.relative_to(ROOT)} --output .data/training/artifacts/network-candidate-v2 --base-model {MODEL} --revision {REV} --max-length {selected} --epochs 1 --recipe 4b --preflight'
    (a.output/'final-readiness.json').write_text(json.dumps(report,indent=2),encoding='utf-8'); print(json.dumps(report,indent=2))
if __name__=='__main__': main()
