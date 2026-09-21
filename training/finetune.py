"""Opt-in QLoRA pilot on an explicit matching Hugging Face checkpoint. Never changes the running Ollama model."""
import argparse
import importlib.util
import json
import re
import hashlib
import subprocess
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--base-model', required=True, help='Exact upstream checkpoint; verify compatibility with your desired base')
    p.add_argument('--revision', required=True, help='Immutable 40-character upstream commit SHA')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--max-length', type=int, default=1024)
    p.add_argument('--epochs', type=float, default=1)
    p.add_argument('--preflight', action='store_true')
    p.add_argument('--recipe', choices=['4b', 'laptop-small'], default='4b')
    args = p.parse_args()
    if not 128 <= args.max_length <= 2048 or not 0 < args.epochs <= 3:
        raise SystemExit('Pilot limits: max length 128–2048 and epochs greater than zero, at most three.')
    missing = [name for name in ('torch', 'transformers', 'peft', 'bitsandbytes', 'accelerate') if importlib.util.find_spec(name) is None]
    readiness_file = args.data / 'readiness.json'
    readiness = json.loads(readiness_file.read_text()) if readiness_file.exists() else {}
    blockers = []
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        blockers.append('Pin the exact upstream checkpoint with a 40-character commit SHA in local-config.json.')
    if args.recipe == 'laptop-small' and (args.base_model != 'Qwen/Qwen3-0.6B' or args.max_length > 512):
        blockers.append('Laptop recipe supports only Qwen/Qwen3-0.6B with max length at most 512.')
    if sys.version_info < (3, 10) or sys.version_info >= (3, 14):
        blockers.append('Use a separate Python 3.11 or 3.12 environment for this training recipe.')
    if not readiness.get('readyForPilotTraining'):
        blockers.append('Reviewed dataset is not ready: at least 20 examples across five incident groups, with held-out evaluation required.')
    if missing:
        blockers.append('Training dependencies missing: ' + ', '.join(missing))
    for name, expected in readiness.get('sha256', {}).items():
        if name not in ('train.jsonl', 'validation.jsonl'):
            blockers.append('Unexpected dataset manifest entry')
            continue
        path = args.data / name
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            blockers.append('Dataset changed after preparation: ' + name)
    for name in ('train.jsonl', 'validation.jsonl'):
        if not (args.data / name).is_file():
            blockers.append('Missing dataset file: ' + name)
    gpu_gib = None
    free_gib = None
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=memory.total,memory.free', '--format=csv,noheader,nounits'],
                                capture_output=True, text=True, timeout=10, check=True)
        total, free = result.stdout.splitlines()[0].split(',')
        gpu_gib, free_gib = float(total) / 1024, float(free) / 1024
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        pass
    # The controlled QLoRA canary is intentionally allowed on the 4 GiB
    # RTX 3050 path; actual model loading and forward/backward remain the
    # authoritative memory-fit checks.
    # 4-bit QLoRA for this pinned 0.6B model is validated on the local 4 GiB
    # GPU. Leave headroom for the desktop driver while allowing a parent
    # smoke-validation CUDA context to coexist briefly.
    minimum_gib = 2.5
    if gpu_gib is not None and gpu_gib < minimum_gib:
        blockers.append(f'This recipe requires at least {minimum_gib} GiB total CUDA VRAM.')
    if free_gib is not None and free_gib < minimum_gib:
        blockers.append(f'Less than {minimum_gib} GiB VRAM is free. Close GPU workloads before training.')
    if not missing:
        import torch
        gpu_gib = torch.cuda.get_device_properties(0).total_memory / 2**30 if torch.cuda.is_available() else 0
        if gpu_gib < minimum_gib:
            blockers.append(f'This recipe requires at least {minimum_gib} GiB CUDA VRAM; memory fit still needs an actual pilot.')
    report = {'baseModel': args.base_model, 'revision': args.revision, 'recipe': args.recipe, 'gpuGiB': gpu_gib, 'freeGpuGiB': free_gib, 'blockers': blockers,
              'trainingStarted': False, 'runningOllamaModelModified': False}
    print(json.dumps(report, indent=2))
    if args.preflight:
        raise SystemExit(2 if blockers else 0)
    if blockers:
        raise SystemExit('Preflight failed. No weights were downloaded or trained.')
    if args.output.exists():
        raise SystemExit('Use a new output directory; existing adapters are not overwritten.')
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer, TrainingArguments
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    import torch
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, revision=args.revision, trust_remote_code=False)
    tokenizer.pad_token = tokenizer.eos_token
    def examples(name):
        result = []
        for line in (args.data / name).read_text(encoding='utf-8').splitlines():
            messages = json.loads(line)['messages']
            prefix = tokenizer.apply_chat_template(messages[:-1], tokenize=True, add_generation_prompt=True, enable_thinking=False)
            full = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=False, enable_thinking=False)
            if full[:len(prefix)] != prefix:
                raise ValueError('Tokenizer prefix does not match the complete dialogue; refusing incorrect loss masking.')
            if len(full) > args.max_length:
                raise ValueError('A reviewed example exceeds max length. Shorten/review the example or increase the bounded length; targets are never silently truncated.')
            result.append({'input_ids': full, 'attention_mask': [1]*len(full), 'labels': [-100]*len(prefix) + full[len(prefix):]})
        return result
    train, validation = examples('train.jsonl'), examples('validation.jsonl')
    if not train or not validation:
        raise SystemExit('Both training and held-out examples are required.')
    model = AutoModelForCausalLM.from_pretrained(args.base_model, revision=args.revision, trust_remote_code=False,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16),
        device_map={'': 0}, torch_dtype=torch.float16)
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(model, LoraConfig(task_type='CAUSAL_LM', r=8, lora_alpha=16, lora_dropout=.05, target_modules=['q_proj','v_proj']))
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'training-manifest.json').write_text(json.dumps({
        **report, 'maxLength': args.max_length, 'epochs': args.epochs,
        'datasetSha256': {name: hashlib.sha256((args.data / name).read_bytes()).hexdigest()
                         for name in ('train.jsonl', 'validation.jsonl')},
    }, indent=2), encoding='utf-8')
    def collate(rows):
        length = max(len(row['input_ids']) for row in rows)
        return {key: torch.tensor([row[key] + [pad]*(length-len(row[key])) for row in rows])
                for key, pad in [('input_ids',tokenizer.pad_token_id),('attention_mask',0),('labels',-100)]}
    trainer = Trainer(model=model, args=TrainingArguments(output_dir=str(args.output), num_train_epochs=args.epochs,
        per_device_train_batch_size=1, per_device_eval_batch_size=1, gradient_accumulation_steps=8,
        learning_rate=1e-4, fp16=True, gradient_checkpointing=True, eval_strategy='epoch', save_strategy='epoch',
        logging_steps=1, report_to='none', seed=42, save_total_limit=2), train_dataset=train, eval_dataset=validation, data_collator=collate)
    trainer.train()
    evaluation = trainer.evaluate()
    model.save_pretrained(args.output / 'adapter')
    tokenizer.save_pretrained(args.output / 'adapter')
    (args.output / 'pilot-result.json').write_text(json.dumps({**report,'trainingStarted':True,'evaluation':evaluation,
        'productionPromotionApproved':False,'note':'Loss is not domain accuracy; benchmark the candidate before any GGUF conversion or model promotion.'},indent=2))


if __name__ == '__main__':
    main()
