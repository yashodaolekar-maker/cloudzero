"""Prepare a local Ollama import file for an explicitly supplied, already converted GGUF."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--gguf', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    source = args.gguf.resolve(strict=True)
    digest = hashlib.sha256()
    with source.open('rb') as model:
        if model.read(4) != b'GGUF':
            raise SystemExit('Expected a GGUF model, not an adapter directory.')
        model.seek(0)
        for block in iter(lambda: model.read(1024 * 1024), b''):
            digest.update(block)
    if any(character in str(source) for character in ('"', '\n', '\r')):
        raise SystemExit('Unsupported GGUF path characters.')
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'Modelfile').write_text(f'FROM "{source.as_posix()}"\nPARAMETER temperature 0\nPARAMETER num_ctx 2048\n', encoding='utf-8')
    (args.output / 'artifact.json').write_text(json.dumps({'gguf': str(source), 'sha256': digest.hexdigest(),
        'imported': False, 'evaluated': False, 'note': 'Header and hash only; verify tokenizer and model compatibility before import.'}, indent=2), encoding='utf-8')
    print(f'Modelfile created at {args.output}. Import under a new candidate name; the running model is unchanged.')


if __name__ == '__main__':
    main()
