"""LIGHTWEIGHT_CANARY_V1: six-case Network regression gate on a 4 GiB GPU."""
import gc, hashlib, json, re, statistics, sys, time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'training'))
from benchmarks.framework import CONTRACT_VERSION, load_cases, response_contract_skeleton, validate_response

BASE = 'Qwen/Qwen3-0.6B'
REV = 'c1899de289a04d12100db370d81485cdf75e47ca'
ADAPTER = ROOT / '.data/training/artifacts/network-candidate-v2/adapter'
DATA = ROOT / '.data/training/user-proposed-prepared-network-v6'
OUT = ROOT / '.data/training/evaluations/network-lightweight-canary-v1'
CASE_IDS = [
    'CZ-NETWORK-01',       # routing
    'CZ-CROSS_TWIN-01',    # DNS dependency
    'CZ-NETWORK-03',       # VLAN
    'CZ-NETWORK-06',       # insufficient evidence / abstention
    'CZ-CROSS_TWIN-03',    # cross-domain routing
    'CZ-NETWORK-05',       # contradictory evidence / misleading symptom
]

def canonical_prompt(case):
    payload = {k: case.get(k) for k in ('scenario','symptoms','topologyContext','observedEvidence','distractorEvidence')}
    return f'''You are evaluating observable engineering behavior for a CloudZero digital twin. Evaluation mode is MODEL_ONLY. Contract version: {CONTRACT_VERSION}. Do not use external knowledge retrieval or tools. Return exactly one JSON object, with no Markdown fences or text before or after it. Do not provide chain-of-thought. Populate only from the incident input; do not invent telemetry, configuration changes, tool results, or confirmed root cause. Use abstention when evidence is insufficient. The exact required JSON shape is:\n{json.dumps(response_contract_skeleton(),indent=2)}\nIncident input:\n''' + json.dumps(payload, ensure_ascii=False)

def quantization():
    return BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16)

def load_model(adapter=None):
    model = AutoModelForCausalLM.from_pretrained(BASE, revision=REV, trust_remote_code=False, quantization_config=quantization(), device_map={'':'cuda:0'}, dtype=torch.float16)
    if adapter is not None:
        model = PeftModel.from_pretrained(model, adapter, is_trainable=False)
    model.config.use_cache = True
    model.eval()
    return model

def strict_and_inspection_parse(raw):
    text = (raw or '').strip()
    fenced = text.startswith('```')
    trailing = bool(re.search(r',\s*[}\]]', text))
    try:
        strict = json.loads(text)
        return strict, strict, None, fenced, trailing
    except Exception as exc:
        strict_error = f'{type(exc).__name__}: {exc}'
    inspect_text = text
    if fenced and '\n' in inspect_text:
        inspect_text = inspect_text.split('\n',1)[1].rsplit('```',1)[0].strip()
    try:
        inspectable = json.loads(inspect_text)
    except Exception:
        inspectable = {}
    failure = 'MARKDOWN_FENCE' if fenced else ('TRAILING_COMMA' if trailing else 'INVALID_JSON')
    return {}, inspectable, failure + ': ' + strict_error, fenced, trailing

def normalize(value):
    return set(re.findall(r'[A-Z0-9]+', json.dumps(value, ensure_ascii=False).upper()))

def mechanical(case, response, raw):
    errors = validate_response(response) if response else ['response is not inspectable JSON']
    expected_evidence = normalize(case.get('expectedEvidenceRequests', []))
    actual_evidence = normalize(response.get('observedFacts', []) + response.get('missingEvidence', [])) if response else set()
    root = response.get('rootCause', {}) if response else {}
    established = root.get('established') is True
    root_evidence = root.get('evidence', []) if isinstance(root, dict) else []
    escalations = {str(x).upper() for x in response.get('escalateTo', [])} if response else set()
    dependencies = {str(x).upper() for x in case.get('crossTwinDependencies', [])}
    remediation = str(response.get('remediation', '')) if response else ''
    unsafe = any(str(x).upper() in remediation.upper() for x in case.get('unsafeActions', []))
    words = re.findall(r'\w+', raw.lower())
    repetition = 0.0 if not words else 1 - len(set(words)) / len(words)
    return {
        'domainMatches': str(response.get('domain','')).upper() == str(case['domain']).upper() if response else False,
        'expectedEvidenceConceptsPresent': sorted(expected_evidence & actual_evidence),
        'expectedEvidenceConceptCoverage': round(len(expected_evidence & actual_evidence) / len(expected_evidence), 4) if expected_evidence else 1.0,
        'hypothesesPresent': bool(response.get('hypotheses')) if response else False,
        'nextActionPresent': bool(response.get('nextDiagnosticAction',{}).get('action')) if response else False,
        'rootCauseEstablished': established,
        'rootCauseState': 'CONFIRMED' if established else ('INSUFFICIENT_EVIDENCE' if response.get('abstain') else 'SUSPECTED') if response else 'UNPARSEABLE',
        'unsupportedRCA': established and not bool(root_evidence),
        'prematureRCA': established and (case.get('shouldAbstain') or not bool(root_evidence)),
        'abstained': response.get('abstain') is True if response else False,
        'requiredAbstentionPreserved': (response.get('abstain') is True) if case.get('shouldAbstain') and response else None,
        'crossTwinEscalationPresent': bool(dependencies & escalations) if dependencies else None,
        'remediationPresent': bool(remediation),
        'rollbackPresent': bool(response.get('rollback')) if response else False,
        'verificationPresent': bool(response.get('verification')) if response else False,
        'unsafeRemediationDetected': unsafe,
        'catastrophicOrRepetitive': not bool(raw.strip()) or repetition > 0.85,
        'schemaErrors': errors,
    }

def infer(model, tokenizer, case):
    torch.manual_seed(0)
    prompt = canonical_prompt(case)
    ids = tokenizer.apply_chat_template([{'role':'user','content':prompt}], tokenize=True, add_generation_prompt=True, enable_thinking=False, return_tensors='pt').to('cuda:0')
    mask = torch.ones_like(ids)
    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(ids, attention_mask=mask, max_new_tokens=300, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    latency = round((time.perf_counter()-started)*1000, 2)
    raw = tokenizer.decode(output[0][ids.shape[1]:], skip_special_tokens=True)
    strict, inspectable, failure, fenced, trailing = strict_and_inspection_parse(raw)
    schema_errors = validate_response(strict) if strict else []
    missing = [x for x in schema_errors if x.startswith('missing field:')]
    type_errors = [x for x in schema_errors if not x.startswith('missing field:')]
    return {
        'caseId': case['id'], 'rawResponse': raw, 'completion': bool(raw.strip()),
        'strictJsonParse': bool(strict), 'schemaValid': bool(strict) and not schema_errors,
        'formatFailure': failure, 'markdownFence': fenced, 'trailingComma': trailing,
        'missingRequiredFields': missing, 'schemaTypeErrors': type_errors,
        'latencyMs': latency, 'inputTokens': ids.shape[1], 'outputTokens': output.shape[1]-ids.shape[1],
        'inspectableResponse': inspectable, 'mechanicalObservations': mechanical(case, inspectable, raw),
    }

def metrics(rows):
    return {
        'completionCount': sum(x['completion'] for x in rows),
        'strictJsonParseCount': sum(x['strictJsonParse'] for x in rows),
        'schemaValidCount': sum(x['schemaValid'] for x in rows),
        'markdownFenceFailures': sum(x['markdownFence'] for x in rows),
        'trailingCommaFailures': sum(x['trailingComma'] for x in rows),
        'invalidJsonCount': sum(bool(x['formatFailure']) and not x['markdownFence'] and not x['trailingComma'] for x in rows),
        'missingRequiredFieldCount': sum(bool(x['missingRequiredFields']) for x in rows),
        'schemaTypeErrorCount': sum(bool(x['schemaTypeErrors']) for x in rows),
        'averageInferenceMs': round(statistics.mean(x['latencyMs'] for x in rows),2),
        'medianInferenceMs': round(statistics.median(x['latencyMs'] for x in rows),2),
    }

def main():
    all_cases = load_cases(ROOT/'training/benchmarks/cases', 'ALL', version='v1')
    by_id = {c['id']:c for c in all_cases}
    cases = [by_id[x] for x in CASE_IDS]
    dataset_text = (DATA/'train.jsonl').read_text(encoding='utf-8') + (DATA/'validation.jsonl').read_text(encoding='utf-8')
    leakage = {c['id']:{'idPresent':c['id'] in dataset_text,'scenarioPresent':c['scenario'] in dataset_text} for c in cases}
    if any(v['idPresent'] or v['scenarioPresent'] for v in leakage.values()): raise SystemExit('Benchmark leakage detected; canary stopped.')
    OUT.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(BASE, revision=REV, trust_remote_code=False)
    runs={}; peaks={}
    for name, adapter in [('clean-base',None),('candidate-v2',ADAPTER)]:
        torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats(); model=load_model(adapter); rows=[]
        for index,case in enumerate(cases,1):
            print(f'{name} {index}/6 {case["id"]}', flush=True); rows.append(infer(model,tokenizer,case))
        peaks[name]={'allocatedBytes':torch.cuda.max_memory_allocated(),'reservedBytes':torch.cuda.max_memory_reserved()}; runs[name]=rows
        del model; gc.collect(); torch.cuda.empty_cache()
    for name, filename in [('clean-base','clean-base-results.json'),('candidate-v2','candidate-v2-results.json')]:
        (OUT/filename).write_text(json.dumps({'profile':'LIGHTWEIGHT_CANARY_V1','metrics':metrics(runs[name]),'peakVRAM':peaks[name],'results':runs[name]},indent=2),encoding='utf-8')
    format_comparison={name:metrics(rows) for name,rows in runs.items()}; (OUT/'format-comparison.json').write_text(json.dumps(format_comparison,indent=2),encoding='utf-8')
    comparisons=[]
    for case in cases:
        clean=next(x for x in runs['clean-base'] if x['caseId']==case['id']); candidate=next(x for x in runs['candidate-v2'] if x['caseId']==case['id'])
        comparisons.append({'caseId':case['id'],'expected':{'domain':case['domain'],'evidenceConcepts':case['expectedEvidenceRequests'],'shouldAbstain':case['shouldAbstain'],'crossTwinDependencies':case['crossTwinDependencies'],'expectedEscalation':case.get('expectedEscalation')},'cleanBase':clean,'candidateV2':candidate,'semanticScorer':'SCORER_UNVERIFIED'})
    (OUT/'case-comparison.json').write_text(json.dumps(comparisons,indent=2),encoding='utf-8')
    md=['# Network Lightweight Canary V1','','No subjective score or semantic superiority claim is assigned.','']
    for x in comparisons:
        md += [f"## {x['caseId']}",'',f"Expected domain: `{x['expected']['domain']}`; abstain: `{x['expected']['shouldAbstain']}`",'', '### Clean base','', '```json',json.dumps(x['cleanBase'],indent=2),'```','', '### Candidate v2','', '```json',json.dumps(x['candidateV2'],indent=2),'```','']
    (OUT/'case-comparison.md').write_text('\n'.join(md),encoding='utf-8')
    clean_obs=[x['mechanicalObservations'] for x in runs['clean-base']]; cand_obs=[x['mechanicalObservations'] for x in runs['candidate-v2']]
    required=[i for i,c in enumerate(cases) if c['shouldAbstain']]
    decision='CANARY_GATE_PASS'
    reasons=[]
    inspectable_clean=sum(bool(x['inspectableResponse']) for x in runs['clean-base'])
    inspectable_candidate=sum(bool(x['inspectableResponse']) for x in runs['candidate-v2'])
    if inspectable_clean < 6 or inspectable_candidate < 6 or any(not runs['candidate-v2'][i]['inspectableResponse'] for i in required):
        decision='CANARY_GATE_INCONCLUSIVE'; reasons.append(f'300-token cap left only {inspectable_clean}/6 clean and {inspectable_candidate}/6 candidate outputs inspectable; required abstention output was truncated')
    elif len(runs['candidate-v2'])!=6 or any(x['catastrophicOrRepetitive'] for x in cand_obs): decision='CANARY_GATE_FAIL'; reasons.append('candidate generation incomplete or catastrophic/repetitive')
    elif sum(x['unsupportedRCA'] for x in cand_obs)>sum(x['unsupportedRCA'] for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('unsupported confirmed RCA increased')
    elif any(clean_obs[i]['requiredAbstentionPreserved'] and not cand_obs[i]['requiredAbstentionPreserved'] for i in required): decision='CANARY_GATE_FAIL'; reasons.append('required abstention regressed')
    elif sum(x['unsafeRemediationDetected'] for x in cand_obs)>sum(x['unsafeRemediationDetected'] for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('unsafe remediation increased')
    elif sum(x['expectedEvidenceConceptCoverage'] for x in cand_obs)+0.01 < sum(x['expectedEvidenceConceptCoverage'] for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('systematic evidence-concept coverage regression')
    metadata={'profile':'LIGHTWEIGHT_CANARY_V1','baseModel':BASE,'revision':REV,'contract':CONTRACT_VERSION,'temperature':0,'seed':0,'contextLength':4096,'maxNewTokens':300,'caseIds':CASE_IDS,'leakage':leakage,'modelsRunSequentially':True,'peakVRAM':peaks,'semanticScorer':'SCORER_UNVERIFIED','decision':decision,'decisionReasons':reasons,'productionApproved':False,'semanticSuperiorityClaimed':False}
    (OUT/'run-metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print(json.dumps({'decision':decision,'reasons':reasons,'format':format_comparison,'peakVRAM':peaks},indent=2))
if __name__=='__main__': main()
