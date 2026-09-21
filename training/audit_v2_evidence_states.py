"""Read-only mechanical evidence-state audit for the seven V2 datasets."""
import json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'.data/training/domain-datasets-v2'; OUT=ROOT/'.data/training/prepared-domain-v2/evidence-state-audit.json'
STATES=('SUSPECTED','SUPPORTED','CONFIRMED','ELIMINATED','INSUFFICIENT_EVIDENCE')
def rows(path): return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
def content(row): return next((x.get('content','') for x in row.get('messages',[]) if x.get('role')=='assistant'),'')
def upper(row): return (json.dumps(row,ensure_ascii=False)+' '+content(row)).upper()
def main():
    report={}
    for path in sorted(DATA.glob('*-behavior-v2.jsonl')):
        dataset=rows(path); counts={key:0 for key in (*STATES,'explicitAbstention','crossTwinEscalation','diagnosticOnlyUnderInsufficient','remediationAfterSufficient','establishedFromInitialSignal','mutationBeforeEvidence','missingEscalationCrossDomain')}
        for row in dataset:
            raw=upper(row); answer=content(row); initial='INITIAL_SIGNAL' in raw and not any(x in raw for x in ('PACKET','LOG','COUNTER','TRACE','CONFIGURATION','TELEMETRY'))
            try: parsed=json.loads(answer)
            except Exception: parsed={}
            abstain=parsed.get('abstain') is True; hypotheses=parsed.get('hypotheses',[]) if isinstance(parsed.get('hypotheses',[]),list) else []
            statuses={str(x.get('status','')).upper() for x in hypotheses if isinstance(x,dict)}; root=parsed.get('rootCause',{}) if isinstance(parsed.get('rootCause',{}),dict) else {}
            insuff=abstain or 'INSUFFICIENT_EVIDENCE' in answer.upper(); supported='SUPPORTED' in statuses or bool(row.get('metadata',{}).get('supportedRCA'))
            normalized={'SUSPECTED':bool(statuses&{'OPEN','SUSPECTED'}),'SUPPORTED':supported and not bool(root.get('established')),'CONFIRMED':bool(root.get('established')) or 'CONFIRMED' in statuses,'ELIMINATED':'ELIMINATED' in statuses,'INSUFFICIENT_EVIDENCE':insuff}
            for state in STATES: counts[state]+=normalized[state]
            counts['explicitAbstention']+=abstain
            counts['crossTwinEscalation']+=bool(parsed.get('escalateTo'))
            action=answer.upper(); mutation=bool(re.search(r'\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|ASSIGN|UPDATE)\b',action)) and not bool(re.search(r'\b(DO NOT|NO)\s+(?:\w+\s+){0,2}(CHANGE|RECONFIGURE|CONFIGURE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|ASSIGN|UPDATE)',action)); diagnostic=bool(re.search(r'\b(COLLECT|INSPECT|QUERY|CHECK|VALIDATE|REQUEST|CORRELATE)\b',action))
            counts['diagnosticOnlyUnderInsufficient']+=insuff and diagnostic and not mutation
            counts['remediationAfterSufficient']+=(supported or bool(root.get('established'))) and mutation
            counts['establishedFromInitialSignal']+=initial and (bool(root.get('established')) or bool(statuses&{'ESTABLISHED','CONFIRMED'}))
            counts['mutationBeforeEvidence']+=initial and mutation
            cross=bool(row.get('metadata',{}).get('crossDomain'))
            counts['missingEscalationCrossDomain']+=cross and not bool(parsed.get('escalateTo'))
        gaps=[]
        for state in STATES:
            if counts[state]==0: gaps.append(f'missing {state} examples')
        if counts['explicitAbstention']==0: gaps.append('missing explicit abstention')
        if counts['crossTwinEscalation']==0: gaps.append('missing explicit cross-Twin escalation')
        if counts['establishedFromInitialSignal'] or counts['mutationBeforeEvidence']: gaps.append('unsafe initial-signal pattern detected')
        report[path.stem.replace('-behavior-v2','')]={'total':len(dataset),'counts':counts,'gaps':gaps,'status':'PATCH_REQUIRED' if gaps else 'MECHANICALLY_ADEQUATE'}
    OUT.write_text(json.dumps({'method':'mechanical lexical and structural audit; requires SME review before production','datasets':report},indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
if __name__=='__main__': main()
