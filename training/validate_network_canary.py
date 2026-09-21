"""Non-production reload and smoke validation for network-candidate-v2."""
import gc, json, time
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

ROOT = Path(__file__).resolve().parents[1]
BASE = 'Qwen/Qwen3-0.6B'
REV = 'c1899de289a04d12100db370d81485cdf75e47ca'
ADAPTER = ROOT / '.data/training/artifacts/network-candidate-v2/adapter'
PROMPT = 'Return JSON with diagnosis, evidence, nextDiagnosticAction, verification, and abstain for a simulated SSID corp not connecting incident. Use only supplied evidence and do not claim a root cause without validation.'

def config():
    return BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16)

def run(model, tokenizer):
    messages=[{'role':'system','content':'You are a senior network operations investigator. Return only valid JSON.'},{'role':'user','content':PROMPT}]
    inputs=tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, enable_thinking=False, return_tensors='pt').to('cuda:0')
    attention_mask=torch.ones_like(inputs)
    with torch.inference_mode():
        out=model.generate(inputs, attention_mask=attention_mask, max_new_tokens=256, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    text=tokenizer.decode(out[0][inputs.shape[1]:], skip_special_tokens=True)
    try:
        json.loads(text)
        schema=True
    except json.JSONDecodeError:
        schema=False
    return text, schema

def main():
    torch.cuda.empty_cache()
    tokenizer=AutoTokenizer.from_pretrained(BASE, revision=REV, trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(BASE, revision=REV, trust_remote_code=False, quantization_config=config(), device_map={'':'cuda:0'}, torch_dtype=torch.float16)
    clean, clean_schema=run(model, tokenizer)
    del model; gc.collect(); torch.cuda.empty_cache()
    base=AutoModelForCausalLM.from_pretrained(BASE, revision=REV, trust_remote_code=False, quantization_config=config(), device_map={'':'cuda:0'}, torch_dtype=torch.float16)
    adapted=PeftModel.from_pretrained(base, ADAPTER, is_trainable=False)
    loaded_base=getattr(adapted.peft_config['default'], 'base_model_name_or_path', None)
    candidate, candidate_schema=run(adapted, tokenizer)
    result={'baseModel':BASE,'revision':REV,'adapter':str(ADAPTER.relative_to(ROOT)),'adapterReloaded':True,'adapterConfigBase':loaded_base,'cleanInferenceSuccess':bool(clean),'cleanSchemaSuccess':clean_schema,'candidateInferenceSuccess':bool(candidate),'candidateSchemaSuccess':candidate_schema,'cleanOutput':clean,'candidateOutput':candidate,'peakAllocatedBytes':torch.cuda.max_memory_allocated(),'peakReservedBytes':torch.cuda.max_memory_reserved()}
    (ADAPTER.parent/'canary-validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
    del adapted, base; gc.collect(); torch.cuda.empty_cache()
if __name__ == '__main__': main()
