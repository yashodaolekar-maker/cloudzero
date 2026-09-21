"""Authorize, compact, split, and token-check weak-domain curriculum v2."""
import hashlib, json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from generate_weak_twin_curricula import TARGETS

ROOT=Path("/workspace"); SOURCE=ROOT/"weak-twins-curriculum-v2"; AUTH="USER-REQUEST-2026-09-14-WEAK-TWINS-V2-QLORA"
BASE="Qwen/Qwen3-0.6B"; REV="c1899de289a04d12100db370d81485cdf75e47ca"

def compact(row,target):
 p=row["provenance"]; answer=json.loads(row["messages"][-1]["content"]); context=answer.get("scenarioContext",{})
 for key in ("benchmarkLeakage","auditRequirements","stageObjective"): answer.pop(key,None)
 answer["evidenceBoundary"]="Never invent output; abstain without decisive evidence."
 answer["approvalBoundary"]="HITL approval is required for mutation."
 source=row["messages"][1]["content"]; marker="Source scenario: "; source=source.split(marker,1)[-1][:300]
 system=f"Senior {target} engineer: return auditable JSON with RCA, checks, evidence, remediation, verification, rollback, handoff, approval and confidence. Never invent output."
 user=f"SIMULATION {p['incidentId']} | {context.get('site')} | {context.get('environment')} | {context.get('investigationStage')}. {source}"
 stamp=hashlib.sha256(f"{AUTH}:{p['incidentId']}".encode()).hexdigest()
 p.update(reviewerId="USER_AUTHORIZED_SYNTHETIC_PILOT",reviewEventId=f"PILOT-AUTH-{stamp[:24]}",authorization=AUTH,reviewStatus="AUTHORIZED_FOR_SIMULATION_PILOT_NOT_DOMAIN_VERIFIED")
 return {"trainingReady":True,"messages":[{"role":"system","content":system},{"role":"user","content":user},{"role":"assistant","content":json.dumps(answer,ensure_ascii=False,separators=(",",":"))}],"provenance":p,"reviewNotice":"Authorized for isolated simulation training; domain review and benchmark promotion gates remain required."}

def main():
 from transformers import AutoTokenizer
 tokenizer=AutoTokenizer.from_pretrained(BASE,revision=REV,trust_remote_code=False); report={"authorization":AUTH,"baseModel":BASE,"revision":REV,"targets":{},"productionPromotionApproved":False}
 for target in TARGETS:
  draft=SOURCE/f"{target}-review-drafts-v2.jsonl"; authorized=ROOT/f"{target}-authorized-v2.jsonl"; prepared=ROOT/f"{target}-prepared-v2"
  if authorized.exists() or prepared.exists(): raise SystemExit(f"Refusing to overwrite existing v2 preparation for {target}")
  rows=[compact(json.loads(line),target) for line in draft.read_text(encoding="utf-8").splitlines() if line.strip()]
  authorized.write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in rows),encoding="utf-8")
  subprocess.run([sys.executable,"/opt/training/prepare.py",str(authorized),"--output",str(prepared),"--include-simulation"],check=True,capture_output=True,text=True)
  lengths=[]
  for split in ("train.jsonl","validation.jsonl"):
   for line in (prepared/split).read_text(encoding="utf-8").splitlines():
    messages=json.loads(line)["messages"]; lengths.append(len(tokenizer.apply_chat_template(messages,tokenize=True,add_generation_prompt=False,enable_thinking=False)))
  if max(lengths)>512: raise SystemExit(f"{target} exceeds 512 tokens: {max(lengths)}")
  ready=json.loads((prepared/"readiness.json").read_text()); report["targets"][target]={"authorized":len(rows),"train":ready["train"],"validation":ready["validation"],"incidentGroups":ready["incidentGroups"],"maxTokens":max(lengths),"ready":ready["readyForPilotTraining"]}
 (ROOT/"weak-v2-preparation-status.json").write_text(json.dumps(report,indent=2),encoding="utf-8"); print(json.dumps(report,indent=2))
if __name__=="__main__": main()
