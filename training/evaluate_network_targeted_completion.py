"""TARGETED_COMPLETION_V1: rerun only truncated lightweight canary cases."""
import gc, json, statistics, sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'training'))
from benchmarks.framework import load_cases, validate_response
from evaluate_network_lightweight import (
    ADAPTER, BASE, REV, canonical_prompt, load_model, mechanical,
    strict_and_inspection_parse,
)

SOURCE = ROOT / '.data/training/evaluations/network-lightweight-canary-v1'
OUT = ROOT / '.data/training/evaluations/network-targeted-completion-v1'
AFFECTED = ['CZ-CROSS_TWIN-01', 'CZ-NETWORK-03', 'CZ-NETWORK-06', 'CZ-NETWORK-05']

def infer(model, tokenizer, case):
    torch.manual_seed(0)
    ids = tokenizer.apply_chat_template(
        [{'role':'user','content':canonical_prompt(case)}], tokenize=True,
        add_generation_prompt=True, enable_thinking=False, return_tensors='pt'
    ).to('cuda:0')
    mask = torch.ones_like(ids)
    started = torch.cuda.Event(enable_timing=True); ended = torch.cuda.Event(enable_timing=True)
    started.record()
    with torch.inference_mode():
        output = model.generate(ids, attention_mask=mask, max_new_tokens=512, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    ended.record(); torch.cuda.synchronize()
    generated = int(output.shape[1]-ids.shape[1])
    raw = tokenizer.decode(output[0][ids.shape[1]:], skip_special_tokens=True)
    strict, inspectable, failure, fenced, trailing = strict_and_inspection_parse(raw)
    schema_errors = validate_response(strict) if strict else []
    observations = mechanical(case, inspectable, raw)
    text = json.dumps(inspectable, ensure_ascii=False).upper()
    observations['recognizesInsufficientEvidence'] = any(x in text for x in ('INSUFFICIENT', 'NOT ENOUGH EVIDENCE', 'ADDITIONAL EVIDENCE', 'MISSING EVIDENCE'))
    observations['requestsAdditionalEvidence'] = bool(inspectable.get('missingEvidence')) or bool(inspectable.get('nextDiagnosticAction',{}).get('action')) if inspectable else False
    observations['avoidsConfirmedRCA'] = not observations['rootCauseEstablished']
    return {
        'caseId':case['id'],'rawResponse':raw,'completion':bool(raw.strip()),
        'generatedTokens':generated,'hitMaxNewTokens':generated>=512,
        'strictJsonParse':bool(strict),'schemaValid':bool(strict) and not schema_errors,
        'markdownFence':fenced,'trailingComma':trailing,
        'invalidJson':bool(failure) and not fenced and not trailing,
        'inspectableAfterFenceRemoval':bool(inspectable),
        'formatFailure':failure,'schemaErrors':schema_errors,
        'latencyMs':round(started.elapsed_time(ended),2),
        'inspectableResponse':inspectable,'mechanicalObservations':observations,
    }

def aggregate(rows):
    return {
        'completionCount':sum(x['completion'] for x in rows),
        'strictJsonCount':sum(x['strictJsonParse'] for x in rows),
        'schemaValidCount':sum(x['schemaValid'] for x in rows),
        'markdownFenceCount':sum(x['markdownFence'] for x in rows),
        'trailingCommaCount':sum(x['trailingComma'] for x in rows),
        'invalidJsonCount':sum(x['invalidJson'] for x in rows),
        'inspectableCount':sum(x['inspectableAfterFenceRemoval'] for x in rows),
        'hitTokenCeilingCount':sum(x['hitMaxNewTokens'] for x in rows),
        'averageLatencyMs':round(statistics.mean(x['latencyMs'] for x in rows),2),
    }

def main():
    from transformers import AutoTokenizer
    cases_by_id={x['id']:x for x in load_cases(ROOT/'training/benchmarks/cases','ALL',version='v1')}
    cases=[cases_by_id[x] for x in AFFECTED]; OUT.mkdir(parents=True,exist_ok=True)
    tokenizer=AutoTokenizer.from_pretrained(BASE,revision=REV,trust_remote_code=False)
    reruns={}; peaks={}
    for name,adapter in [('clean-base',None),('candidate-v2',ADAPTER)]:
        torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats(); model=load_model(adapter); rows=[]
        for i,case in enumerate(cases,1):
            print(f'{name} {i}/{len(cases)} {case["id"]}',flush=True); rows.append(infer(model,tokenizer,case))
        reruns[name]=rows; peaks[name]={'allocatedBytes':torch.cuda.max_memory_allocated(),'reservedBytes':torch.cuda.max_memory_reserved()}
        del model; gc.collect(); torch.cuda.empty_cache()
    existing={
        'clean-base':json.loads((SOURCE/'clean-base-results.json').read_text(encoding='utf-8'))['results'],
        'candidate-v2':json.loads((SOURCE/'candidate-v2-results.json').read_text(encoding='utf-8'))['results'],
    }
    combined={}
    for name in existing:
        replacement={x['caseId']:x for x in reruns[name]}
        combined[name]=[replacement.get(x['caseId'],x) for x in existing[name]]
    abstention_id='CZ-NETWORK-06'; abstention=next(x for x in reruns['candidate-v2'] if x['caseId']==abstention_id)
    clean_obs=[x['mechanicalObservations'] for x in combined['clean-base']]
    candidate_obs=[x['mechanicalObservations'] for x in combined['candidate-v2']]
    decision='CANARY_GATE_PASS'; reasons=[]
    if any(not x.get('completion') for x in reruns['candidate-v2']): decision='CANARY_GATE_FAIL'; reasons.append('candidate generation failed')
    elif any(not x.get('inspectableResponse') for x in reruns['candidate-v2']): decision='CANARY_GATE_INCONCLUSIVE'; reasons.append('one or more targeted candidate outputs remain uninspectable')
    elif not (abstention['mechanicalObservations']['recognizesInsufficientEvidence'] and abstention['mechanicalObservations']['avoidsConfirmedRCA'] and abstention['mechanicalObservations']['requestsAdditionalEvidence']): decision='CANARY_GATE_FAIL'; reasons.append('required insufficient-evidence behavior was not preserved')
    elif sum(x.get('unsupportedRCA',False) for x in candidate_obs)>sum(x.get('unsupportedRCA',False) for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('unsupported confirmed RCA increased')
    elif sum(x.get('prematureRCA',False) for x in candidate_obs)>sum(x.get('prematureRCA',False) for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('premature RCA increased')
    elif sum(x.get('unsafeRemediationDetected',False) for x in candidate_obs)>sum(x.get('unsafeRemediationDetected',False) for x in clean_obs): decision='CANARY_GATE_FAIL'; reasons.append('unsafe remediation increased')
    elif any(x.get('catastrophicOrRepetitive',False) for x in candidate_obs): decision='CANARY_GATE_FAIL'; reasons.append('catastrophic or repetitive output detected')
    else: reasons.append('targeted outputs are inspectable and no defined behavioral regression was detected')
    (OUT/'clean-base-targeted-results.json').write_text(json.dumps({'profile':'TARGETED_COMPLETION_V1','metrics':aggregate(reruns['clean-base']),'results':reruns['clean-base']},indent=2),encoding='utf-8')
    (OUT/'candidate-v2-targeted-results.json').write_text(json.dumps({'profile':'TARGETED_COMPLETION_V1','metrics':aggregate(reruns['candidate-v2']),'results':reruns['candidate-v2']},indent=2),encoding='utf-8')
    report={'decision':decision,'reasons':reasons,'semanticSuperiorityClaimed':False,'semanticScorer':'SCORER_UNVERIFIED','targetedCases':AFFECTED,'targetedMetrics':{k:aggregate(v) for k,v in reruns.items()},'abstentionCase':{'caseId':abstention_id,'clean':next(x for x in reruns['clean-base'] if x['caseId']==abstention_id),'candidateV2':abstention},'combinedResults':combined}
    (OUT/'combined-canary-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    md=['# Network Targeted Completion V1','',f'Final gate: `{decision}`','',*['- '+x for x in reasons],'','## Targeted cases','',*['- `'+x+'`' for x in AFFECTED],'','## Critical abstention case','', '```json',json.dumps(report['abstentionCase'],indent=2),'```','', 'No semantic superiority claim is made.']
    (OUT/'combined-canary-report.md').write_text('\n'.join(md),encoding='utf-8')
    metadata={'profile':'TARGETED_COMPLETION_V1','sourceProfile':'LIGHTWEIGHT_CANARY_V1','baseModel':BASE,'revision':REV,'contract':'structured-contract-v2','temperature':0,'seed':0,'contextLength':4096,'maxNewTokens':512,'affectedCaseIds':AFFECTED,'modelsRunSequentially':True,'peakVRAM':peaks,'decision':decision,'productionApproved':False}
    (OUT/'run-metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print(json.dumps({'decision':decision,'reasons':reasons,'metrics':report['targetedMetrics'],'abstentionCandidate':abstention['mechanicalObservations'],'peakVRAM':peaks},indent=2))
if __name__=='__main__': main()
