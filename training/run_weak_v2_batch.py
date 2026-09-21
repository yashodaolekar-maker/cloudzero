"""Run the 12 weak-domain v2 QLoRA jobs sequentially and resumably."""
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from generate_weak_twin_curricula import TARGETS
ROOT=Path("/workspace"); STATUS=ROOT/"weak-v2-training-status.json"; REV="c1899de289a04d12100db370d81485cdf75e47ca"
BASE=[sys.executable,"/opt/training/finetune.py","--base-model","Qwen/Qwen3-0.6B","--revision",REV,"--recipe","laptop-small","--max-length","512","--epochs","1"]
def now(): return datetime.now(timezone.utc).isoformat()
def write(x):
 t=STATUS.with_suffix(".tmp"); t.write_text(json.dumps(x,indent=2),encoding="utf-8"); t.replace(STATUS)
def main():
 state={"batch":"weak-twins-v2","startedAt":now(),"completedAt":None,"targets":{x:{"status":"QUEUED"} for x in TARGETS},"runningOllamaModelModified":False,"productionPromotionApproved":False}; write(state)
 for target in TARGETS:
  item=state["targets"][target]; output=ROOT/f"{target}-adapter-v2"; result=output/"pilot-result.json"
  if result.exists(): item.update(status="COMPLETED",resumedFromExistingArtifact=True,completedAt=now(),exitCode=0); write(state); continue
  item.update(status="RUNNING",startedAt=now(),log=f"/workspace/{target}-adapter-v2.log"); write(state)
  command=BASE+["--data",f"/workspace/{target}-prepared-v2","--output",str(output)]
  with (ROOT/f"{target}-adapter-v2.log").open("w",encoding="utf-8") as log: run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,text=True)
  item.update(status="COMPLETED" if run.returncode==0 else "FAILED",completedAt=now(),exitCode=run.returncode); write(state)
  if run.returncode: state.update(status="FAILED",completedAt=now()); write(state); return run.returncode
 state.update(status="COMPLETED",completedAt=now()); write(state); return 0
if __name__=="__main__": raise SystemExit(main())
