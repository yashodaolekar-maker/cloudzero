"""Write the explicit mechanical-readiness manifest for the corrected Network canary."""
import hashlib, json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = root / '.data/training/user-proposed-prepared-network-v6'
manifest = {
    'experimentReadiness': 'EXPERIMENT_READY_NOT_SME_APPROVED',
    'readyForPilotTraining': True,
    'baseModel': 'Qwen/Qwen3-0.6B',
    'revision': 'c1899de289a04d12100db370d81485cdf75e47ca',
    'tokenizer': 'Qwen2TokenizerFast',
    'maxSequenceLength': 1024,
    'trainCount': 80,
    'validationCount': 18,
    'sha256': {name: hashlib.sha256((data / name).read_bytes()).hexdigest() for name in ('train.jsonl', 'validation.jsonl')},
    'split': 'preserved existing 80/18 split; train/validation incident families disjoint',
    'smeApproved': False,
    'productionApproved': False,
}
(data / 'readiness.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest, indent=2))
