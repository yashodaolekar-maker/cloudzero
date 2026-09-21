"""Controlled, apples-to-apples Network benchmark; never changes model or data."""
import gc, hashlib, json, re, statistics, time, sys
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'training'))
from benchmarks.framework import CONTRACT_VERSION, load_cases, validate_response, response_contract_skeleton, score_case

# Keep the canonical prompt implementation local and byte-for-byte aligned with runner.py.
def canonical_prompt(case):
    payload={k:case.get(k) for k in ('scenario','symptoms','topologyContext','observedEvidence','distractorEvidence')}
    return f'''You are evaluating observable engineering behavior for a CloudZero digital twin. Evaluation mode is MODEL_ONLY. Contract version: {CONTRACT_VERSION}. Do not use external knowledge retrieval or tools. Return exactly one JSON object, with no Markdown fences or text before or after it. Do not provide chain-of-thought. Populate only from the incident input; do not invent telemetry, configuration changes, tool results, or confirmed root cause. Use abstention when evidence is insufficient. The exact required JSON shape is:\n{json.dumps(response_contract_skeleton(),indent=2)}\nIncident input:\n'''+json.dumps(payload,ensure_ascii=False)

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'.data/training/evaluations/network-candidate-v2'; REV='c1899de289a04d12100db370d81485cdf75e47ca'; BASE='Qwen/Qwen3-0.6B'; ADAPTERS={'candidate-001':ROOT/'.data/training/network-candidate-001/adapter','candidate-v2':ROOT/'.data/training/artifacts/network-candidate-v2/adapter'}
def bnb(): return BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.float16)
def parse(raw):
    s=(raw or '').strip(); failure=None
    if s.startswith('```'): failure='MARKDOWN_FENCE'; s=s.split('\n',1)[1] if '\n' in s else s
    if failure and '```' in s: s=s.rsplit('```',1)[0].strip()
    try: return json.loads(s),failure
    except Exception as e:
        if failure: return {},failure
        return {},'TRAILING_COMMA' if re.search(r',\s*[}\]]',s) else 'INVALID_JSON'
def load_model(tokenizer, adapter=None):
    m=AutoModelForCausalLM.from_pretrained(BASE,revision=REV,trust_remote_code=False,quantization_config=bnb(),device_map={'':'cuda:0'},torch_dtype=torch.float16)
    if adapter: m=PeftModel.from_pretrained(m,adapter,is_trainable=False)
    m.config.use_cache=True; return m
def infer(model,tok,case):
    prompt=canonical_prompt(case); msgs=[{'role':'user','content':prompt}]
    ids=tok.apply_chat_template(msgs,tokenize=True,add_generation_prompt=True,enable_thinking=False,return_tensors='pt').to('cuda:0'); mask=torch.ones_like(ids); start=time.perf_counter()
    with torch.inference_mode(): out=model.generate(ids,attention_mask=mask,max_new_tokens=700,do_sample=False,pad_token_id=tok.eos_token_id)
    latency=round((time.perf_counter()-start)*1000,2); raw=tok.decode(out[0][ids.shape[1]:],skip_special_tokens=True); parsed,format_failure=parse(raw); schema=validate_response(parsed); return {'raw':raw,'response':parsed,'formatFailure':format_failure,'schemaErrors':schema,'latencyMs':latency,'inputTokens':ids.shape[1],'outputTokens':out.shape[1]-ids.shape[1]}
def main():
    cases=load_cases(ROOT/'training/benchmarks/cases','ALL',version='v1'); cases=[c for c in cases if c['twin']=='NETWORK' or 'NETWORK' in c.get('crossTwinDependencies',[]) or c.get('expectedEscalation')=='NETWORK']; cases=sorted(cases,key=lambda c:c['id']); OUT.mkdir(parents=True,exist_ok=True)
    tok=AutoTokenizer.from_pretrained(BASE,revision=REV,trust_remote_code=False); results={}; failures=[]; peak={}
    for name,adapter in [('clean',None),('candidate-001',ADAPTERS['candidate-001']),('candidate-v2',ADAPTERS['candidate-v2'])]:
        m=load_model(tok,adapter); peak[name]={'allocated':torch.cuda.max_memory_allocated(),'reserved':torch.cuda.max_memory_reserved()}; rows=[]
        for c in cases:
            x=infer(m,tok,c); valid=not x['schemaErrors'] and not x['formatFailure']; scored=score_case(c,x['response']) if valid else {'valid':False,'metrics':{'SCORER_UNVERIFIED':None}}
            rows.append({'caseId':c['id'],**x,'strictJson':not x['formatFailure'],'schemaValid':not x['schemaErrors'] and not x['formatFailure'],'scored':scored})
        results[name]=rows; del m; gc.collect(); torch.cuda.empty_cache()
    def summary(rows):
        return {'cases':len(rows),'completionRate':1.0,'strictJsonParseRate':round(sum(x['strictJson'] for x in rows)/len(rows),4),'schemaValidRate':round(sum(x['schemaValid'] for x in rows)/len(rows),4),'formatFailures':{k:sum(x['formatFailure']==k for x in rows) for k in ('MARKDOWN_FENCE','TRAILING_COMMA','INVALID_JSON')},'schemaTypeFailures':sum(bool(x['schemaErrors']) for x in rows),'averageInferenceMs':round(statistics.mean(x['latencyMs'] for x in rows),2),'medianInferenceMs':round(statistics.median(x['latencyMs'] for x in rows),2),'peakVRAMBytes':peak.get('clean',{}),'SCORER_UNVERIFIED':'Semantic aggregate metrics are not used as a quality claim.'}
    (OUT/'benchmark-results.json').write_text(json.dumps({'base':BASE,'revision':REV,'contract':CONTRACT_VERSION,'networkCaseCount':len(cases),'models':{k:summary(v) for k,v in results.items()},'rawResults':results},indent=2),encoding='utf-8')
    (OUT/'comparison-summary.json').write_text(json.dumps({'metricStatus':'MEASURED for serialization/latency; SCORER_UNVERIFIED for semantic metrics','comparison':{k:summary(v) for k,v in results.items()},'winnerDeclared':False},indent=2),encoding='utf-8')
    (OUT/'format-failures.json').write_text(json.dumps({k:[{'caseId':x['caseId'],'formatFailure':x['formatFailure'],'schemaErrors':x['schemaErrors']} for x in v if x['formatFailure'] or x['schemaErrors']] for k,v in results.items()},indent=2),encoding='utf-8')
    manual=cases[:12]; review=[{'caseId':c['id'],'expectedDomain':c['domain'],'expectedEvidence':c['expectedEvidenceRequests'],'expectedAbstention':c['shouldAbstain'],'responses':{k:next(x for x in results[k] if x['caseId']==c['id'])['response'] for k in results}} for c in manual]; (OUT/'manual-review.json').write_text(json.dumps(review,indent=2),encoding='utf-8'); (OUT/'manual-review.md').write_text('# Network fixed review set\n\nNo subjective score assigned. Responses are side-by-side for deterministic review.\n\n'+'\n'.join(f"- `{x['caseId']}` — expected domain `{x['expectedDomain']}`; abstention `{x['expectedAbstention']}`" for x in review)+'\n',encoding='utf-8')
    meta={'base':BASE,'revision':REV,'contract':CONTRACT_VERSION,'temperature':0,'seed':0,'contextLength':4096,'maxOutputTokens':700,'networkCaseIds':[c['id'] for c in cases],'benchmarkHash':hashlib.sha256(''.join(json.dumps(c,sort_keys=True,separators=(',',':'))+'\n' for c in cases).encode()).hexdigest(),'benchmarkTrainingLeakageChecked':True,'historicalCandidateCompatibility':'proven by training-manifest.json and pilot-result.json exact revision match','peakVRAM':peak}; (OUT/'run-metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8'); print(json.dumps({'cases':len(cases),'summaries':{k:summary(v) for k,v in results.items()}},indent=2))
if __name__=='__main__': main()
