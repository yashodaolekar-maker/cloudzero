import argparse, json, hashlib, statistics, time, urllib.request, urllib.error
from pathlib import Path
from .framework import CONTRACT_VERSION, load_cases, validate_case, validate_response, response_contract_skeleton, score_case, report

FORBIDDEN = ('expectedHypotheses','expectedEvidenceRequests','expectedNextAction','expectedTool','expectedRootCause','acceptableAlternativeCauses','unsafeActions','expectedRemediation','expectedRollback','expectedVerification','shouldAbstain','expectedEscalation','groundTruthNotes','reviewerNotes')
def benchmark_manifest(cases):
    return hashlib.sha256(''.join(json.dumps(c,sort_keys=True,separators=(',',':'))+'\n' for c in cases).encode()).hexdigest()
def model_prompt(case, contract_version=CONTRACT_VERSION):
    payload={k:case.get(k) for k in ('scenario','symptoms','topologyContext','observedEvidence','distractorEvidence')}
    prompt=f'''You are evaluating observable engineering behavior for a CloudZero digital twin. Evaluation mode is MODEL_ONLY. Contract version: {contract_version}. Do not use external knowledge retrieval or tools. Return exactly one JSON object, with no Markdown fences or text before or after it. Do not provide chain-of-thought. Populate only from the incident input; do not invent telemetry, configuration changes, tool results, or confirmed root cause. Use abstention when evidence is insufficient. The exact required JSON shape is:\n{json.dumps(response_contract_skeleton(),indent=2)}\nIncident input:\n'''+json.dumps(payload,ensure_ascii=False)
    assert not any(k in prompt for k in FORBIDDEN)
    return prompt
def parse_response(text):
    text=(text or '').strip()
    if text.startswith('```'):
        text=text.split('\n',1)[1].rsplit('```',1)[0].strip()
    try: return json.loads(text), None
    except Exception as exc: return {}, f'{type(exc).__name__}: {exc}'
def ollama(model, prompt, timeout):
  body={'model':model,'messages':[{'role':'user','content':prompt}],'stream':False,'format':'json','options':{'temperature':0,'seed':0,'num_ctx':4096,'num_predict':700},'think':False}
  started=time.perf_counter()
  req=urllib.request.Request('http://localhost:11434/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=timeout) as response: data=json.loads(response.read().decode())
  latency=round((time.perf_counter()-started)*1000,2); message=data.get('message',{}).get('content','')
  parsed,error=parse_response(message); return parsed,error,latency,data
def model_info(model):
    req=urllib.request.Request('http://localhost:11434/api/show',data=json.dumps({'name':model}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=10) as r: return json.loads(r.read().decode())
def select_calibration_cases(cases):
    selected=[]; seen=set()
    for c in cases:
        if c['twin'] not in seen: selected.append(c); seen.add(c['twin'])
    for predicate in (lambda c: c['difficulty']=='L7_INSUFFICIENT_EVIDENCE', lambda c: c['difficulty']=='L6_CONTRADICTORY_EVIDENCE'):
        match=next((c for c in cases if predicate(c) and c not in selected),None)
        if match: selected.append(match)
    return selected

def main():
 p=argparse.ArgumentParser(); p.add_argument("--model",required=True); p.add_argument("--twin",default="all"); p.add_argument("--difficulty"); p.add_argument("--benchmark-version",default="v1"); p.add_argument("--output",type=Path,required=True); p.add_argument("--responses",type=Path); p.add_argument('--smoke',action='store_true'); p.add_argument('--calibration',action='store_true'); p.add_argument('--timeout',type=int,default=120)
 a=p.parse_args(); root=Path(__file__).parent/"cases"; cases=load_cases(root,a.twin,a.difficulty,a.benchmark_version)
 bad=[(c["id"],validate_case(c)) for c in cases if validate_case(c)]
 if bad: raise SystemExit(json.dumps({"invalidCases":bad},indent=2))
 if not cases: raise SystemExit('No benchmark cases selected')
 manifest=benchmark_manifest(cases)
 if a.smoke or a.calibration: cases=select_calibration_cases(cases) if a.calibration else select_calibration_cases(cases)[:9]
 responses={}; raw=[]
 if a.responses and a.responses.exists(): responses={x["caseId"]:x.get("response",{}) for x in map(json.loads,a.responses.read_text(encoding="utf-8").splitlines()) if x.strip()}
 elif not a.responses:
  try: info=model_info(a.model)
  except Exception as exc: raise SystemExit(f'Unable to inspect Ollama model {a.model}: {exc}')
  raw_dir=a.output.parent/'raw'; raw_dir.mkdir(parents=True,exist_ok=True)
  for c in cases:
   item={'caseId':c['id'],'model':a.model,'prompt':model_prompt(c),'response':{},'failure':None}
   try:
    response,error,latency,data=ollama(a.model,item['prompt'],a.timeout); item.update(response=response,latencyMs=latency,raw=data)
    if error: item['failure']=error
    elif validate_response(response): item['failure']='Missing or invalid response fields: '+', '.join(validate_response(response))
    responses[c['id']]=response
   except Exception as exc: item['failure']=f'{type(exc).__name__}: {exc}'
   (raw_dir/(c['id']+'.json')).write_text(json.dumps(item,indent=2),encoding='utf-8'); raw.append(item)
  a.output.parent.mkdir(parents=True,exist_ok=True); (a.output.parent/'run-metadata.json').write_text(json.dumps({'model':a.model,'modelInfo':info,'evaluationMode':'MODEL_ONLY','promptContractVersion':CONTRACT_VERSION,'temperature':0,'seed':0,'contextSize':4096,'maxOutputTokens':700,'timeoutSeconds':a.timeout,'benchmarkHash':manifest,'benchmarkVersion':a.benchmark_version,'calibrationSelection':a.calibration},indent=2),encoding='utf-8')
 results=[]
 for c in cases:
  raw_item=next((x for x in raw if x['caseId']==c['id']),{})
  results.append({'caseId':c['id'],'failure':raw_item.get('failure'),'latencyMs':raw_item.get('latencyMs'),**score_case(c,responses.get(c['id'],{}),raw_item.get('latencyMs'))})
 out=report(cases,results,a.model,a.benchmark_version); out['benchmarkHash']=manifest; out['evaluationMode']='MODEL_ONLY'; out['modelInfo']=locals().get('info',{}); a.output.parent.mkdir(parents=True,exist_ok=True); a.output.with_suffix(".json").write_text(json.dumps(out,indent=2),encoding="utf-8")
 md=[f"# {out['title']}","",f"Model: `{a.model}`  ",f"Twin: `{a.twin}`  ",f"Benchmark version: `{a.benchmark_version}`  ",f"Cases: {out['caseCount']} (approved: {out['approvedCaseCount']})","","## Metrics",""]
 md += [f"- {k}: {v}" for k,v in out["metrics"].items()] or ["- N/A"]
 md += ['',f'Benchmark hash: `{manifest}`','Evaluation mode: `MODEL_ONLY`']
 a.output.with_suffix(".md").write_text("\n".join(md)+"\n",encoding="utf-8"); print(json.dumps({k:out[k] for k in ('title','caseCount','approvedCaseCount','benchmarkHash','metrics')},indent=2))
if __name__=="__main__": main()
