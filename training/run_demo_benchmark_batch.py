"""Run all demo benchmark targets sequentially and maintain restartable status."""
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from build_demo_benchmark import TARGETS
ROOT=Path("/workspace"); BENCH=ROOT/"demo-benchmark-v1"; RESULTS=BENCH/"results"; STATUS=BENCH/"status.json"
def now(): return datetime.now(timezone.utc).isoformat()
def write(x):
 t=STATUS.with_suffix(".tmp"); t.write_text(json.dumps(x,indent=2),encoding="utf-8"); t.replace(STATUS)
def main():
 RESULTS.mkdir(parents=True,exist_ok=True); state={"benchmark":"cloudzero-demo-benchmark-v1","startedAt":now(),"completedAt":None,"targets":{x:{"status":"QUEUED"} for x in TARGETS},"runningOllamaModelModified":False}; write(state)
 for target in TARGETS:
  summary=RESULTS/f"{target}.summary.json"
  if summary.exists(): state["targets"][target]={"status":"COMPLETED","resumedFromExistingResult":True}; write(state); continue
  state["targets"][target]={"status":"RUNNING","startedAt":now()}; write(state)
  output=RESULTS/f"{target}.jsonl"; log=RESULTS/f"{target}.log"
  command=[sys.executable,"/opt/training/run_demo_benchmark.py","--benchmark",str(BENCH),"--workspace",str(ROOT),"--target",target,"--output",str(output)]
  with log.open("w",encoding="utf-8") as stream: result=subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT,text=True)
  state["targets"][target].update(status="COMPLETED" if result.returncode==0 else "FAILED",completedAt=now(),exitCode=result.returncode); write(state)
  if result.returncode: state.update(status="FAILED",completedAt=now()); write(state); return result.returncode
 state.update(status="COMPLETED",completedAt=now()); write(state); return 0
if __name__=="__main__": raise SystemExit(main())
