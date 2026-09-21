"""Run exact QLoRA preflight for every weak-domain v2 dataset."""
import json, subprocess, sys
from pathlib import Path
from generate_weak_twin_curricula import TARGETS
REV="c1899de289a04d12100db370d81485cdf75e47ca"; ROOT=Path("/workspace")
results={}
for target in TARGETS:
 command=[sys.executable,"/opt/training/finetune.py","--base-model","Qwen/Qwen3-0.6B","--revision",REV,"--recipe","laptop-small","--max-length","512","--epochs","1","--data",str(ROOT/f"{target}-prepared-v2"),"--output",str(ROOT/f"{target}-adapter-v2"),"--preflight"]
 run=subprocess.run(command,capture_output=True,text=True); results[target]={"passed":run.returncode==0,"exitCode":run.returncode,"report":run.stdout.strip(),"error":run.stderr.strip()}
(ROOT/"weak-v2-preflight-status.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
print(json.dumps({k:v["passed"] for k,v in results.items()},indent=2))
raise SystemExit(0 if all(x["passed"] for x in results.values()) else 2)
