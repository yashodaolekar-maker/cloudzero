"""Compare two installed local Ollama models on held-out cases; correctness needs human review."""
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from workflow import read_rows


def local_url(url):
    parsed = urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Evaluation accepts only a local Ollama HTTP endpoint.')
    return url.rstrip('/')


def evaluate(model, messages, base_url, timeout=120):
    # The reference answer is deliberately never sent to the model.
    started = time.monotonic()
    request = urllib.request.Request(base_url + '/api/chat', data=json.dumps({
        'model': model, 'messages': messages, 'stream': False, 'think': False,
        'format': 'json', 'keep_alive': 0,
        'options': {'temperature': 0, 'seed': 42, 'num_ctx': 2048, 'num_predict': 384},
    }).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
        answer = payload.get('message', {}).get('content', '')
        complete = bool(answer.strip()) and payload.get('done_reason') != 'length' and '<think>' not in answer.lower()
        try:
            parsed = json.loads(answer)
            structure = isinstance(parsed, dict) and (
                isinstance(parsed.get('answer'), str) and bool(parsed['answer'].strip()) or
                isinstance(parsed.get('assessment'), str) and isinstance(parsed.get('nextCheck'), str)
                and isinstance(parsed.get('evidenceIds'), list))
        except (ValueError, TypeError):
            structure = False
        # Never export an embedded reasoning block as a final answer.
        if '<think>' in answer.lower() or '</think>' in answer.lower():
            answer = '[Incomplete final answer; reasoning content withheld]'
            complete = False
        return {'model': model, 'status': 'COMPLETED' if complete and structure else 'INVALID',
                'answer': answer, 'elapsedSeconds': time.monotonic() - started,
                'inputTokens': payload.get('prompt_eval_count'), 'outputTokens': payload.get('eval_count'),
                'review': {'correctness': None, 'evidenceSupported': None, 'nextCheckUseful': None, 'notes': ''}}
    except Exception as error:
        return {'model': model, 'status': 'FAILED', 'errorType': type(error).__name__,
                'elapsedSeconds': time.monotonic() - started, 'inputTokens': None, 'outputTokens': None}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data', type=Path, required=True, help='Prepared dataset directory; only validation.jsonl is used')
    p.add_argument('--base', required=True)
    p.add_argument('--candidate', required=True)
    p.add_argument('--url', default='http://127.0.0.1:11434')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if args.base == args.candidate:
        p.error('Choose different base and candidate models.')
    url = local_url(args.url)
    rows = read_rows(args.data / 'validation.jsonl')
    readiness = json.loads((args.data / 'readiness.json').read_text(encoding='utf-8'))
    for filename, digest in readiness.get('sha256', {}).items():
        if filename not in ('train.jsonl', 'validation.jsonl'):
            p.error('Unexpected prepared dataset manifest entry.')
        if hashlib.sha256((args.data / filename).read_bytes()).hexdigest() != digest:
            p.error('Prepared dataset was changed; prepare a new version before evaluation.')
    train = read_rows(args.data / 'train.jsonl')
    for field in ('incidentId', 'incidentFamily'):
        seen = {row['provenance'].get(field) for row in train} - {None, ''}
        if seen & {row['provenance'].get(field) for row in rows}:
            p.error('Training and evaluation groups overlap.')
    if not rows:
        p.error('No held-out cases available.')
    with urllib.request.urlopen(url + '/api/tags', timeout=10) as response:
        installed = {m['name']: m.get('digest') for m in json.load(response)['models']}
    if any(model not in installed for model in (args.base, args.candidate)):
        p.error('Both models must already be installed under their exact Ollama names; no model is downloaded automatically.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as output:
        for index, row in enumerate(rows):
            messages = row['messages']
            if len(messages) < 2 or messages[-1]['role'] != 'assistant':
                raise ValueError('Invalid held-out dialogue')
            models = [args.base, args.candidate] if index % 2 == 0 else [args.candidate, args.base]
            results = [evaluate(model, messages[:-1], url) for model in models]
            record = {'incidentId': row['provenance']['incidentId'], 'domain': row['provenance'].get('domain'),
                      'prompt': messages[:-1], 'reference': messages[-1]['content'],
                      'promptSha256': hashlib.sha256(json.dumps(messages[:-1], sort_keys=True).encode()).hexdigest(),
                      'modelDigests': {model: installed[model] for model in models}, 'results': results,
                      'note': 'Cold-load-inclusive timing; structural validity is not accuracy. Human review required.'}
            output.write(json.dumps(record, ensure_ascii=False) + '\n')
            output.flush()
            print(json.dumps({'case': index + 1, 'statuses': [r['status'] for r in results]}), flush=True)
    print(f'Comparison saved to {args.output}; no promotion or accuracy claim was made.')


if __name__ == '__main__':
    main()
