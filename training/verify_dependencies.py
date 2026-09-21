"""Exercise a tiny random Qwen3 4-bit LoRA training step without downloading model weights."""
import argparse
import importlib.metadata
import json
import platform
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    import torch
    from transformers import Qwen3Config, Qwen3ForCausalLM, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    if not torch.cuda.is_available():
        raise RuntimeError('CUDA is unavailable to the training environment.')
    torch.manual_seed(42)
    config = Qwen3Config(vocab_size=64, hidden_size=32, intermediate_size=64,
                        num_hidden_layers=1, num_attention_heads=2, num_key_value_heads=2,
                        head_dim=16, max_position_embeddings=128)
    with tempfile.TemporaryDirectory(prefix='cloudzero-dependency-check-') as folder:
        Qwen3ForCausalLM(config).save_pretrained(folder)
        model = AutoModelForCausalLM.from_pretrained(folder, device_map={'': 0},
            quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16),
            torch_dtype=torch.float16)
        model.config.use_cache = False
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
        model = get_peft_model(model, LoraConfig(task_type='CAUSAL_LM', r=8,
            lora_alpha=16, target_modules=['q_proj', 'v_proj']))
        trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
        before = [parameter.detach().clone() for parameter in trainable]
        optimizer = torch.optim.AdamW(trainable, lr=1e-3)
        tokens = torch.randint(0, 64, (1, 16), device='cuda')
        model.train()
        loss = model(input_ids=tokens, attention_mask=torch.ones_like(tokens), labels=tokens).loss
        if not torch.isfinite(loss):
            raise RuntimeError('Non-finite training loss.')
        loss.backward()
        if not any(p.grad is not None and torch.isfinite(p.grad).all() and p.grad.abs().sum() > 0 for p in trainable):
            raise RuntimeError('No finite adapter gradient.')
        optimizer.step()
        torch.cuda.synchronize()
        if not any(not torch.equal(old, new) for old, new in zip(before, trainable)):
            raise RuntimeError('Adapter optimizer step did not update weights.')
        report = {'status': 'PASS', 'python': platform.python_version(),
                  'packages': {name: importlib.metadata.version(name) for name in
                               ['torch', 'transformers', 'peft', 'accelerate', 'bitsandbytes', 'safetensors']},
                  'gpu': torch.cuda.get_device_name(0), 'cudaRuntime': torch.version.cuda,
                  'gpuGiB': torch.cuda.get_device_properties(0).total_memory / 2**30,
                  'testLoss': loss.item(), 'peakAllocatedMiB': torch.cuda.max_memory_allocated() / 2**20,
                  'note': 'Tiny random model, NF4 load, LoRA backward and optimizer step only. No infrastructure model trained or promoted.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
