"""Run one adapter against its held-out demo cases and write auditable results."""
import argparse, json, re, time
from pathlib import Path

def normal(text): return set(re.findall(r"[a-z0-9_.:/-]+", text.lower()))

def score(case, response):
    low=response.lower(); actual=normal(response); concepts=case["rubric"]["concepts"]
    dimensions={}
    groups={
      "rca":["issueSummary","rankedHypotheses","rootCause"], "evidence":["evidence","validationChecks"],
      "remediation":["temporaryFix","permanentFix"], "operationalSafety":["verification","rollback","approval"],
      "collaboration":["crossTwin"], "confidence":["confidence"]}
    for name,fields in groups.items():
        expected=[word for field in fields for word in concepts.get(field,[])]; overlap=len(set(expected)&actual)/max(1,len(set(expected)))
        field_signal=sum(1 for field in fields if field.lower() in low or re.sub(r"([A-Z])",r" \1",field).lower() in low)/max(1,len(fields))
        dimensions[name]=round(min(1.0,0.65*overlap+0.35*field_signal),4)
    safety_hits=sum(term in low for term in case["rubric"]["safetyTerms"])
    dimensions["operationalSafety"]=round(min(1.0,0.7*dimensions["operationalSafety"]+0.3*safety_hits/3),4)
    return dimensions, round(sum(dimensions.values())/len(dimensions),4)

def main():
    p=argparse.ArgumentParser(); p.add_argument("--benchmark",type=Path,required=True); p.add_argument("--workspace",type=Path,default=Path("/workspace")); p.add_argument("--target",required=True); p.add_argument("--output",type=Path,required=True); p.add_argument("--max-new-tokens",type=int,default=320); args=p.parse_args()
    cases=[json.loads(x) for x in (args.benchmark/"cases.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    cases=[x for x in cases if x["target"]==args.target]
    if not cases: raise SystemExit("No cases for target")
    adapter=args.workspace/cases[0]["adapter"]/"adapter"
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import PeftModel
    import torch
    base="Qwen/Qwen3-0.6B"; revision="c1899de289a04d12100db370d81485cdf75e47ca"
    tokenizer=AutoTokenizer.from_pretrained(base,revision=revision,trust_remote_code=False); tokenizer.pad_token=tokenizer.eos_token
    model=AutoModelForCausalLM.from_pretrained(base,revision=revision,trust_remote_code=False,quantization_config=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type="nf4",bnb_4bit_compute_dtype=torch.float16),device_map={"":0},torch_dtype=torch.float16)
    model=PeftModel.from_pretrained(model,str(adapter)); model.eval(); args.output.parent.mkdir(parents=True,exist_ok=True)
    summaries=[]
    with args.output.open("w",encoding="utf-8") as out:
      for case in cases:
        started=time.perf_counter(); failure=None; response=""
        try:
          prompt=tokenizer.apply_chat_template(case["messages"],tokenize=False,add_generation_prompt=True,enable_thinking=False)
          encoded=tokenizer(prompt,return_tensors="pt").to("cuda")
          with torch.inference_mode(): generated=model.generate(**encoded,max_new_tokens=args.max_new_tokens,do_sample=False,pad_token_id=tokenizer.eos_token_id)
          response=tokenizer.decode(generated[0][encoded["input_ids"].shape[1]:],skip_special_tokens=True)
        except Exception as exc: failure=f"{type(exc).__name__}: {exc}"[:500]
        dimensions,overall=score(case,response) if not failure else ({k:0 for k in ("rca","evidence","remediation","operationalSafety","collaboration","confidence")},0)
        result={"caseId":case["caseId"],"target":args.target,"response":response,"latencyMs":round((time.perf_counter()-started)*1000),"failure":failure,"dimensions":dimensions,"score":overall,"caseSha256":case["caseSha256"]}
        summaries.append(result); out.write(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n"); out.flush()
    averages={key:round(sum(x["dimensions"][key] for x in summaries)/len(summaries),4) for key in summaries[0]["dimensions"]}
    report={"target":args.target,"adapter":cases[0]["adapter"],"cases":len(summaries),"failures":sum(bool(x["failure"]) for x in summaries),"averageScore":round(sum(x["score"] for x in summaries)/len(summaries),4),"dimensions":averages,"promotionApproved":False,"humanReviewRequired":True}
    args.output.with_suffix(".summary.json").write_text(json.dumps(report,indent=2),encoding="utf-8"); print(json.dumps(report,indent=2))
if __name__=="__main__": main()
