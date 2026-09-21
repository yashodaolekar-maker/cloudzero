"""Sequential, isolated experimental QLoRA run for the seven non-Network Twins."""
import gc, json, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; PY=sys.executable; BASE='Qwen/Qwen3-0.6B'; REV='c1899de289a04d12100db370d81485cdf75e47ca'
ORDER=['windows','linux','database','middleware','cloudops','devops','cyber']
PROMPTS={'windows':'A Windows service reports an initial timeout signal. Request safe discriminating evidence.','linux':'A Linux host reports an initial service failure signal. Request safe discriminating evidence.','database':'A database reports initial connection latency. Request safe discriminating evidence.','middleware':'A message service reports initial processing delay. Request safe discriminating evidence.','cloudops':'A cloud workload reports initial connectivity loss. Request safe discriminating evidence.','devops':'A deployment reports an initial readiness failure. Request safe discriminating evidence.','cyber':'An identity alert reports an initial anomalous login signal. Request safe discriminating evidence.'}
def gpu_free():
 try: return subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],text=True,timeout=10).strip()
 except Exception:return None
def smoke(name,out):
 import torch
 from peft import PeftModel
 from transformers import AutoModelForCausalLM,AutoTokenizer,BitsAndBytesConfig
 torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats(); q=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.float16)
 tok=AutoTokenizer.from_pretrained(BASE,revision=REV,trust_remote_code=False); model=AutoModelForCausalLM.from_pretrained(BASE,revision=REV,trust_remote_code=False,quantization_config=q,device_map={'':'cuda:0'},dtype=torch.float16); adapted=PeftModel.from_pretrained(model,out/'adapter',is_trainable=False)
 ids=tok.apply_chat_template([{'role':'user','content':PROMPTS[name]}],tokenize=True,add_generation_prompt=True,enable_thinking=False,return_tensors='pt').to('cuda:0')
 with torch.inference_mode(): generated=adapted.generate(ids,attention_mask=torch.ones_like(ids),max_new_tokens=128,do_sample=False,pad_token_id=tok.eos_token_id)
 raw=tok.decode(generated[0][ids.shape[1]:],skip_special_tokens=True); result={'adapterReloaded':True,'adapterConfigBase':getattr(adapted.peft_config['default'],'base_model_name_or_path',None),'smokeInferenceCompleted':bool(raw.strip()),'smokeRawOutput':raw,'markdownFence':raw.lstrip().startswith('```'),'catastrophicOrRepetitive':not bool(raw.strip()),'peakAllocatedBytes':torch.cuda.max_memory_allocated(),'peakReservedBytes':torch.cuda.max_memory_reserved()}
 del adapted,model; gc.collect(); torch.cuda.empty_cache(); return result
def main():
 results=[]
 for name in ORDER:
  data=ROOT/'.data/training/prepared-domain-v3'/name; out=ROOT/'.data/training/artifacts'/f'{name}-candidate-v1'
  if out.exists() and (out/'experiment-result.json').exists():
   prior=json.loads((out/'experiment-result.json').read_text(encoding='utf-8'))
   if prior.get('status')=='SUCCEEDED': results.append(prior); print(json.dumps({'twin':name,'status':'SKIPPED_ALREADY_SUCCEEDED'},indent=2),flush=True); continue
  if out.exists(): raise SystemExit(f'{name}: output exists; will not overwrite {out}')
  before=gpu_free(); started=time.perf_counter(); command=[PY,str(ROOT/'training/finetune.py'),'--data',str(data),'--output',str(out),'--base-model',BASE,'--revision',REV,'--max-length','640','--epochs','1','--recipe','4b']
  run=subprocess.run(command,cwd=ROOT,text=True,capture_output=True); duration=round(time.perf_counter()-started,2); out.mkdir(parents=True,exist_ok=True); (out/'training.log').write_text(run.stdout+'\n'+run.stderr,encoding='utf-8')
  if run.returncode!=0:
   result={'twin':name,'status':'FAILED','returnCode':run.returncode,'freeVRAMMiBBefore':before,'durationSeconds':duration,'error':(run.stderr or run.stdout)[-4000:]}; (out/'experiment-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8'); results.append(result); break
  pilot=json.loads((out/'pilot-result.json').read_text(encoding='utf-8')); checkpoints=sorted(out.glob('checkpoint-*')); state=json.loads((checkpoints[-1]/'trainer_state.json').read_text(encoding='utf-8')) if checkpoints and (checkpoints[-1]/'trainer_state.json').exists() else {}
  losses=[x.get('loss') for x in state.get('log_history',[]) if isinstance(x.get('loss'),(int,float))]; smoke_result=smoke(name,out); adapter=out/'adapter'/'adapter_model.safetensors'
  result={'twin':name,'status':'SUCCEEDED','baseModel':BASE,'revision':REV,'dataset':str(data.relative_to(ROOT)),'trainCount':json.loads((data/'readiness.json').read_text())['trainCount'],'validationCount':json.loads((data/'readiness.json').read_text())['validationCount'],'maxSequenceLength':640,'qlora':{'bits':4,'quantType':'nf4','doubleQuantization':True,'rank':8,'alpha':16,'dropout':.05,'targets':['q_proj','v_proj'],'epochs':1,'batchSize':1,'gradientAccumulation':8,'learningRate':1e-4,'gradientCheckpointing':True,'useCache':False,'seed':42},'freeVRAMMiBBefore':before,'durationSeconds':duration,'trainLoss':losses[-1] if losses else None,'evalLoss':pilot.get('evaluation',{}).get('eval_loss'),'adapterBytes':adapter.stat().st_size if adapter.exists() else None,**smoke_result}
  (out/'experiment-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8'); results.append(result); print(json.dumps({'twin':name,'status':result['status'],'duration':duration,'trainLoss':result['trainLoss'],'evalLoss':result['evalLoss']},indent=2),flush=True)
 summary={'order':ORDER,'results':results,'allSucceeded':len(results)==len(ORDER) and all(x['status']=='SUCCEEDED' for x in results)}; dest=ROOT/'.data/training/artifacts/seven-twin-training-summary.json'; dest.write_text(json.dumps(summary,indent=2),encoding='utf-8'); print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
