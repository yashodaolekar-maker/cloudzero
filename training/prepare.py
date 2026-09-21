"""Prepare auditable SFT data from CloudZero human-reviewed exports (standard library only)."""
import argparse
import hashlib
import json
from pathlib import Path

BENCHMARK_DIR = Path(__file__).parent / 'benchmarks'

def benchmark_ids():
    ids = set()
    if BENCHMARK_DIR.exists():
        for path in BENCHMARK_DIR.glob('cases/**/*.jsonl'):
            for line in path.read_text(encoding='utf-8').splitlines():
                if line.strip():
                    value = json.loads(line).get('id')
                    if value: ids.add(value)
    return ids

def assert_no_benchmark_leakage(rows, source_path=None, generated_text=''):
    source = str(source_path or '').replace('\\', '/').lower()
    if '/benchmarks/' in source or source.endswith('/benchmarks'):
        raise ValueError('Benchmark directories cannot be supplied as QLoRA training data')
    ids = benchmark_ids()
    haystack = json.dumps(rows, ensure_ascii=False) + generated_text
    leaked = sorted(x for x in ids if x in haystack)
    if leaked:
        raise ValueError('Frozen benchmark case IDs found in training input/output: ' + ', '.join(leaked))


def prepare(rows, include_simulation=False):
    accepted, skipped, seen = [], [], set()
    for row in rows:
        if not isinstance(row, dict):
            skipped.append({'reason': 'Example must be an object'})
            continue
        provenance = row.get('provenance', {})
        messages = row.get('messages', [])
        if not isinstance(provenance, dict) or not isinstance(messages, list):
            skipped.append({'reason': 'Invalid provenance or messages'})
            continue
        reason = None
        if row.get('trainingReady') is not True:
            reason = row.get('exclusion') or 'Not marked training ready'
        elif provenance.get('mode') != 'LIVE' and not include_simulation:
            reason = 'Simulation/unknown evidence is excluded unless explicitly requested'
        elif any(not isinstance(provenance.get(key), str) or not provenance[key].strip() for key in ('reviewEventId', 'reviewerId')):
            reason = 'Missing human review provenance'
        elif not isinstance(provenance.get('incidentId'), str) or not provenance['incidentId'].strip():
            reason = 'Missing incident group'
        elif any(not isinstance(m, dict) for m in messages):
            reason = 'Invalid message object'
        elif len(messages) < 2 or messages[-1].get('role') != 'assistant':
            reason = 'Missing prompt or final response'
        elif not any(m.get('role') == 'user' for m in messages[:-1]):
            reason = 'Missing user question'
        elif any(m.get('role') not in ('system', 'user', 'assistant') or not isinstance(m.get('content'), str) or not m['content'].strip() or '<think>' in m['content'].lower() or '</think>' in m['content'].lower() for m in messages):
            reason = 'Invalid messages or reasoning trace'
        prompt_hash = hashlib.sha256(json.dumps(messages[:-1], sort_keys=True).encode()).hexdigest()
        if prompt_hash in seen:
            reason = 'Duplicate prompt excluded to prevent train/evaluation overlap'
        if reason:
            skipped.append({'reviewEventId': provenance.get('reviewEventId'), 'reason': reason})
            continue
        seen.add(prompt_hash)
        accepted.append({'messages': messages, 'provenance': provenance, 'promptHash': prompt_hash})
    # A family can contain several incidents with the same underlying exercise.
    # Connect both identifiers so neither a family nor an incident crosses splits.
    parents = {}
    def root(key):
        parents.setdefault(key, key)
        if parents[key] != key:
            parents[key] = root(parents[key])
        return parents[key]
    for row in accepted:
        p = row['provenance']
        incident = 'incident:' + p['incidentId']
        family = p.get('incidentFamily')
        if isinstance(family, str) and family.strip():
            a, b = root(incident), root('family:' + family)
            parents[max(a, b)] = min(a, b)
        else:
            root(incident)
    def group(row):
        return root('incident:' + row['provenance']['incidentId'])
    groups = sorted({group(r) for r in accepted}, key=lambda g: hashlib.sha256(g.encode()).hexdigest())
    validation_groups = set(groups[:max(1, len(groups) // 5)]) if len(groups) > 1 else set()
    train = [r for r in accepted if group(r) not in validation_groups]
    validation = [r for r in accepted if group(r) in validation_groups]
    ready = len(accepted) >= 20 and len(groups) >= 5 and bool(train) and bool(validation)
    return train, validation, {'accepted': len(accepted), 'incidentGroups': len(groups), 'train': len(train), 'validation': len(validation),
        'readyForPilotTraining': ready, 'minimumExamples': 20, 'minimumIncidentGroups': 5, 'skipped': skipped,
        'note': 'Pilot minimum only, not evidence of production accuracy. Human domain validation is required before promotion.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('export', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--include-simulation', action='store_true')
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.export.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    assert_no_benchmark_leakage(rows, args.export)
    train, validation, report = prepare(rows, args.include_simulation)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in [('train.jsonl', train), ('validation.jsonl', validation)]:
        (args.output / name).write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in data), encoding='utf-8')
    (args.output / 'readiness.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
