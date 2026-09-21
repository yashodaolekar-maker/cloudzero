"""Authenticated local control plane for reviewed QLoRA improvement jobs."""
import hashlib
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path('/workspace')
STATE_FILE = ROOT / 'learning-control-plane.json'
TOKEN = os.environ.get('TRAINING_CONTROL_TOKEN', '')
DOMAINS = {'NETWORK','WINDOWS','LINUX','DATABASE','CLOUDOPS','DEVOPS','MIDDLEWARE','SECURITY','SRE','COLLABORATION'}
LOCK = threading.Lock()

def now(): return datetime.now(timezone.utc).isoformat()
def fresh(): return {'version':1,'candidates':[],'jobs':[],'adapters':[],'evaluations':[],'updatedAt':now()}
def load():
    try: return json.loads(STATE_FILE.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError): return fresh()
def save(state):
    state['updatedAt'] = now(); tmp = STATE_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, indent=2), encoding='utf-8'); tmp.replace(STATE_FILE)
def ident(prefix, value): return prefix + '-' + hashlib.sha256(value.encode()).hexdigest()[:16]
def safe_domain(value):
    domain = str(value or '').upper()
    if domain not in DOMAINS: raise ValueError('Unsupported twin domain.')
    return domain
def public(state):
    active = next((j for j in reversed(state['jobs']) if j['status'] == 'RUNNING'), None)
    counts = {s:sum(1 for c in state['candidates'] if c['status']==s) for s in ('REVIEWED','CURATED_SIMULATION','QUARANTINED','REJECTED')}
    return {**state,'summary':{**counts,'activeJobId':active and active['id'],'adapterVersions':len(state['adapters'])}}

def run_job(job_id, action, domain):
    with LOCK:
        state=load(); job=next(j for j in state['jobs'] if j['id']==job_id)
        rows=[c['record'] for c in state['candidates'] if c['status'] in ('REVIEWED','CURATED_SIMULATION') and c['domain']==domain]
    run_dir=ROOT/'runs'/job_id; run_dir.mkdir(parents=True, exist_ok=False)
    source=run_dir/'reviewed.jsonl'; source.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    prepared=run_dir/'prepared'; output=run_dir/'candidate'
    commands=[[sys.executable,'prepare.py',str(source),'--output',str(prepared),'--include-simulation']]
    if action in ('PREFLIGHT','TRAIN'):
        commands.append([sys.executable,'workflow.py',action.lower(),'--data',str(prepared),'--output',str(output)])
    log=run_dir/'job.log'; code=0
    with log.open('w',encoding='utf-8') as stream:
        for command in commands:
            result=subprocess.run(command,cwd='/opt/training',stdout=stream,stderr=subprocess.STDOUT,check=False)
            code=result.returncode
            if code: break
    with LOCK:
        state=load(); job=next(j for j in state['jobs'] if j['id']==job_id)
        job.update(status='COMPLETED' if code==0 else 'BLOCKED',completedAt=now(),exitCode=code,log=str(log))
        manifest=output/'training-manifest.json'
        if action=='TRAIN' and code==0 and manifest.exists():
            version=ident('adapter',job_id+manifest.read_text(encoding='utf-8'))
            state['adapters'].append({'id':version,'domain':domain,'jobId':job_id,'status':'CANDIDATE','createdAt':now(),'manifest':json.loads(manifest.read_text(encoding='utf-8'))})
        save(state)

class Handler(BaseHTTPRequestHandler):
    def reply(self, code, value):
        body=json.dumps(value).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def body(self): return json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
    def allowed(self): return bool(TOKEN) and self.headers.get('Authorization') == 'Bearer '+TOKEN
    def do_GET(self):
        if self.path=='/healthz': return self.reply(200,{'status':'ready'})
        if not self.allowed(): return self.reply(401,{'error':'Unauthorized'})
        if self.path=='/v1/state': return self.reply(200,public(load()))
        return self.reply(404,{'error':'Not found'})
    def do_POST(self):
        if not self.allowed(): return self.reply(401,{'error':'Unauthorized'})
        path=urlparse(self.path).path
        try:
            payload=self.body()
            with LOCK:
                state=load()
                if path=='/v1/candidates/sync':
                    added=0
                    for record in payload.get('candidates',[]):
                        raw=json.dumps(record,sort_keys=True); cid=ident('candidate',raw)
                        if any(c['id']==cid for c in state['candidates']): continue
                        provenance=record.get('provenance',{}); domain=safe_domain(provenance.get('domain') or record.get('task',{}).get('role'))
                        synthetic=provenance.get('curationType')=='USER_AUTHORIZED_SYNTHETIC' and provenance.get('mode')=='SIMULATION'
                        reviewed=record.get('trainingReady') is True and bool(provenance.get('reviewEventId')) and bool(provenance.get('reviewerId'))
                        status='CURATED_SIMULATION' if synthetic and reviewed else 'REVIEWED' if reviewed else 'QUARANTINED'
                        state['candidates'].append({'id':cid,'domain':domain,'status':status,'reason':record.get('exclusion') or ('' if reviewed else 'Missing accepted human-review provenance'),'createdAt':now(),'record':record}); added+=1
                    save(state); return self.reply(200,{'success':True,'added':added,'state':public(state)})
                if path=='/v1/jobs':
                    action=str(payload.get('action','PREFLIGHT')).upper(); domain=safe_domain(payload.get('domain'))
                    if action not in ('PREPARE','PREFLIGHT','TRAIN'): raise ValueError('Unsupported job action.')
                    if any(j['status']=='RUNNING' for j in state['jobs']): return self.reply(409,{'error':'A training job is already running.'})
                    count=sum(1 for c in state['candidates'] if c['status'] in ('REVIEWED','CURATED_SIMULATION') and c['domain']==domain)
                    if count<20: return self.reply(409,{'error':f'{domain} needs at least 20 reviewed examples; {count} available.'})
                    job={'id':ident('job',domain+action+now()),'domain':domain,'action':action,'status':'RUNNING','candidateCount':count,'startedAt':now()}
                    state['jobs'].append(job); save(state); threading.Thread(target=run_job,args=(job['id'],action,domain),daemon=True).start()
                    return self.reply(202,{'success':True,'job':job})
                if path=='/v1/adapters/import':
                    domain=safe_domain(payload.get('domain')); specialty=str(payload.get('specialty') or domain).upper()[:80]; relative=str(payload.get('runPath','')).strip().strip('/')
                    run=(ROOT/relative).resolve()
                    if ROOT.resolve() not in run.parents: raise ValueError('Adapter run must be inside the training workspace.')
                    manifest_path=run/'training-manifest.json'; result_path=run/'pilot-result.json'; weights=run/'adapter'/'adapter_model.safetensors'
                    if not all(item.is_file() for item in (manifest_path,result_path,weights)): raise ValueError('Completed manifest, result, and adapter weights are required.')
                    manifest=json.loads(manifest_path.read_text(encoding='utf-8')); result=json.loads(result_path.read_text(encoding='utf-8'))
                    if result.get('trainingStarted') is not True or result.get('runningOllamaModelModified') is not False: raise ValueError('Run does not prove an isolated completed training job.')
                    digest=hashlib.sha256(weights.read_bytes()).hexdigest(); version=ident('adapter',json.dumps(manifest,sort_keys=True)+digest)
                    adapter=next((a for a in state['adapters'] if a['id']==version),None)
                    if not adapter:
                        adapter={'id':version,'domain':domain,'specialty':specialty,'jobId':None,'status':'CANDIDATE','createdAt':now(),'runPath':relative,'weightsSha256':digest,'manifest':manifest,'trainingResult':result}
                        state['adapters'].append(adapter); save(state)
                    return self.reply(200,{'success':True,'adapter':adapter})
                if path=='/v1/evaluations':
                    adapter=next((a for a in state['adapters'] if a['id']==payload.get('adapterId')),None)
                    if not adapter: return self.reply(404,{'error':'Adapter candidate not found.'})
                    metrics=payload.get('metrics',{}); required=('rootCauseAccuracy','evidenceTraceability','commandAccuracy','safeAbstention')
                    if any(not isinstance(metrics.get(k),(int,float)) or not 0<=metrics[k]<=1 for k in required): raise ValueError('All evaluation metrics must be numbers from 0 to 1.')
                    passed=metrics['rootCauseAccuracy']>=.85 and metrics['evidenceTraceability']>=.9 and metrics['commandAccuracy']>=.9 and metrics['safeAbstention']>=.95
                    evaluation={'id':ident('evaluation',adapter['id']+now()),'adapterId':adapter['id'],'domain':adapter['domain'],'metrics':metrics,'passed':passed,'reviewer':str(payload.get('reviewer',''))[:120],'createdAt':now()}
                    state['evaluations'].append(evaluation); adapter['status']='EVALUATED' if passed else 'REJECTED'; save(state)
                    return self.reply(200,{'success':True,'evaluation':evaluation})
                if path=='/v1/promotions/shadow':
                    adapter=next((a for a in state['adapters'] if a['id']==payload.get('adapterId')),None)
                    if not adapter or adapter['status']!='EVALUATED': return self.reply(409,{'error':'A passing evaluated adapter is required.'})
                    if not str(payload.get('approvedBy','')).strip(): raise ValueError('Human approver is required.')
                    for item in state['adapters']:
                        if item['domain']==adapter['domain'] and item['status']=='SHADOW': item['status']='ARCHIVED'
                    adapter.update(status='SHADOW',promotedAt=now(),approvedBy=str(payload['approvedBy'])[:120]); save(state)
                    return self.reply(200,{'success':True,'adapter':adapter})
            return self.reply(404,{'error':'Not found'})
        except (ValueError,KeyError,json.JSONDecodeError) as error: return self.reply(400,{'error':str(error)})
    def log_message(self, fmt, *args): pass

if __name__=='__main__':
    if not TOKEN: raise SystemExit('TRAINING_CONTROL_TOKEN is required.')
    ROOT.mkdir(parents=True,exist_ok=True)
    print(json.dumps({'status':'READY','port':8091}),flush=True)
    ThreadingHTTPServer(('0.0.0.0',8091),Handler).serve_forever()
