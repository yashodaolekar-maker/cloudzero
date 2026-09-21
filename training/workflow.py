"""Local-only infrastructure training workflow; preparation needs Python's standard library."""
import argparse
import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from curriculum import write_drafts
from prepare import prepare

HERE = Path(__file__).resolve().parent


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def domain(row):
    return row.get('provenance', {}).get('domain') or row.get('task', {}).get('role', 'UNKNOWN')


def prepare_dataset(source, output, config):
    rows = read_rows(source)
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get('provenance'), dict):
            row['provenance']['domain'] = domain(row)
    train, validation, report = prepare(rows, config.get('includeSimulation') is True)
    coverage = {split: dict(Counter(domain(row) for row in data))
                for split, data in [('train', train), ('validation', validation)]}
    minimum = config.get('minimumExamplesPerDomain', 20)
    blockers = []
    for role in config['domains']:
        total = coverage['train'].get(role, 0) + coverage['validation'].get(role, 0)
        if total < minimum:
            blockers.append(f'{role}: {total}/{minimum} reviewed examples')
        if not coverage['train'].get(role) or not coverage['validation'].get(role):
            blockers.append(f'{role}: needs independent families in both training and validation')
    report.update(domainCoverage=coverage, domainBlockers=blockers,
                  readyForPilotTraining=report['readyForPilotTraining'] and not blockers)
    output.mkdir(parents=True, exist_ok=False)
    hashes = {}
    for name, data in [('train.jsonl', train), ('validation.jsonl', validation)]:
        content = ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in data).encode('utf-8')
        (output / name).write_bytes(content)
        hashes[name] = hashlib.sha256(content).hexdigest()
    report['sha256'] = hashes
    (output / 'readiness.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=HERE / 'local-config.json')
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init', help='Create 25 unreviewed curriculum exercises')
    init.add_argument('--output', type=Path, required=True)
    prep = sub.add_parser('prepare', help='Validate reviews and split incident families')
    prep.add_argument('--input', type=Path, required=True)
    prep.add_argument('--output', type=Path, required=True)
    for name in ['preflight', 'train']:
        command = sub.add_parser(name)
        command.add_argument('--data', type=Path, required=True)
        command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    if args.command == 'init':
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_drafts(args.output)
        print(f'Created 25 draft exercises: {args.output}. No examples are approved for training.')
    elif args.command == 'prepare':
        report = prepare_dataset(args.input, args.output, config)
        print(json.dumps(report, indent=2))
        return 0 if report['readyForPilotTraining'] else 2
    else:
        # Child preflight reports all blockers, including an unpinned checkpoint.
        command = [sys.executable, str(HERE / 'finetune.py'), '--data', str(args.data),
                   '--output', str(args.output), '--base-model', config['baseModel'],
                   '--revision', config.get('revision', ''), '--recipe', config.get('recipe', '4b'),
                   '--max-length', str(config.get('maxLength', 512)), '--epochs', str(config.get('epochs', 1))]
        if args.command == 'preflight':
            command.append('--preflight')
        return subprocess.run(command, check=False).returncode
    return 0


if __name__ == '__main__':
    sys.exit(main())
