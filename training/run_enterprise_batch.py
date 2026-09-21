"""Run the four authorized enterprise QLoRA pilots sequentially on one GPU."""
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

DOMAINS=("dba","middleware","sre","collaboration")
ROOT=Path('/workspace'); STATUS=ROOT/'enterprise-training-status.json'
BASE=[sys.executable,'finetune.py','--base-model','Qwen/Qwen3-0.6B','--revision','c1899de289a04d12100db370d81485cdf75e47ca','--recipe','laptop-small','--max-length','512','--epochs','1']

def now(): return datetime.now(timezone.utc).isoformat()
def write(state):
    temporary=STATUS.with_suffix('.tmp'); temporary.write_text(json.dumps(state,indent=2),encoding='utf-8'); temporary.replace(STATUS)

def main():
    state={'batch':'enterprise-twins-v1','startedAt':now(),'completedAt':None,'runningOllamaModelModified':False,'domains':{d:{'status':'QUEUED'} for d in DOMAINS}}
    write(state)
    for domain in DOMAINS:
        item=state['domains'][domain]; item.update(status='RUNNING',startedAt=now(),log=f'/workspace/{domain}-adapter-v1.log'); write(state)
        result_file=ROOT/f'{domain}-adapter-v1'/'pilot-result.json'
        if result_file.exists():
            item.update(status='COMPLETED',completedAt=now(),exitCode=0,resumedFromExistingArtifact=True)
            write(state)
            continue
        command=BASE+['--data',f'/workspace/{domain}-prepared-v1','--output',f'/workspace/{domain}-adapter-v1']
        with (ROOT/f'{domain}-adapter-v1.log').open('w',encoding='utf-8') as log:
            result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,text=True)
        item.update(status='COMPLETED' if result.returncode==0 else 'FAILED',completedAt=now(),exitCode=result.returncode); write(state)
        if result.returncode:
            state['status']='FAILED'; state['completedAt']=now(); write(state); return result.returncode
    state['status']='COMPLETED'; state['completedAt']=now(); write(state); return 0

if __name__=='__main__': raise SystemExit(main())
