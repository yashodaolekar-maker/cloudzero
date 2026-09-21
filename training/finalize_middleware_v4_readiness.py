import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; D=ROOT/'.data/training/prepared-domain-v4-reconstructed/middleware'; Q=json.loads((D/'quality-report-v4.json').read_text())
def main():
 report={'baseModel':'Qwen/Qwen3-0.6B','revision':'c1899de289a04d12100db370d81485cdf75e47ca','schemaVersion':'structured-contract-v4','total':Q['records'],'train':Q['train'],'validation':Q['validation'],'families':Q['families'],'stateDistribution':Q['stateDistribution'],'maxSequenceLength':640,'qualityGates':Q,'sha256':{n:hashlib.sha256((D/n).read_bytes()).hexdigest() for n in ('train.jsonl','validation.jsonl')},'readyForPilotTraining':bool(Q['readiness'])}
 (D/'readiness.json').write_text(json.dumps(report,indent=2)); print(json.dumps({'readyForPilotTraining':report['readyForPilotTraining'],'sha256':report['sha256']},indent=2))
if __name__=='__main__':main()
