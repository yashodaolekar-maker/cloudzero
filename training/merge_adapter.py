"""Merge an adapter into its pinned upstream base locally before llama.cpp GGUF conversion."""
import argparse
import json
import re
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    manifest = json.loads((args.run / 'training-manifest.json').read_text(encoding='utf-8'))
    adapter = args.run / 'adapter'
    metadata = json.loads((adapter / 'adapter_config.json').read_text(encoding='utf-8'))
    if not re.fullmatch('[a-f0-9]{40}', manifest['revision']):
        raise SystemExit('Training manifest must pin the base revision.')
    if metadata.get('base_model_name_or_path') != manifest['baseModel']:
        raise SystemExit('Adapter base differs from the training manifest.')
    if args.output.exists():
        raise SystemExit('Use a new output directory.')
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    import torch
    # CPU merge avoids competing with the local Ollama GPU process.
    base = AutoModelForCausalLM.from_pretrained(manifest['baseModel'], revision=manifest['revision'],
        torch_dtype=torch.float32, device_map={'': 'cpu'}, trust_remote_code=False)
    model = PeftModel.from_pretrained(base, str(adapter)).merge_and_unload(safe_merge=True)
    model.save_pretrained(args.output, safe_serialization=True)
    AutoTokenizer.from_pretrained(str(adapter), trust_remote_code=False).save_pretrained(args.output)
    (args.output / 'cloudzero-training-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Merged checkpoint: {args.output}. Convert to GGUF, import as a candidate, then evaluate.')


if __name__ == '__main__':
    main()
