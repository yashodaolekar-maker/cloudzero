"""Expand weak-domain training seeds into review-ready, benchmark-isolated curricula."""
import argparse, hashlib, json
from pathlib import Path

TARGETS={
 "routing-switching":"prepared-routing-switching-demo-v1","dhcp":"prepared-dhcp-demo-v2","cisco-ise":"prepared-cisco-ise-demo-v1",
 "wireless":"prepared-wireless-demo-v1","palo-alto":"prepared-palo-alto-demo-v1","sdwan-zscaler":"sdwan-zscaler-prepared-v1",
 "silverpeak-edgeconnect":"silverpeak-edgeconnect-prepared-v1","windows":"windows-mastery-prepared-v1","linux":"linux-mastery-prepared-v1",
 "devops":"devops-mastery-prepared-v1","cloudops":"cloudops-mastery-prepared-v1","cyber-fusion":"security-mastery-prepared-v1"}
SITES=("Bengaluru","Mumbai","London","Frankfurt","Chicago","Toronto","Singapore","Sydney","Tokyo","Sao-Paulo")
ENVIRONMENTS=("campus production","hybrid datacenter and cloud","regulated branch estate","active-active service region")
STAGES=(
 ("initial-triage","Establish scope, onset, affected services, recent changes, and safe read-only checks before proposing cause."),
 ("hypothesis-discrimination","Rank plausible causes and run checks whose outputs distinguish them; preserve exact evidence and limitations."),
 ("cross-twin-correlation","Correlate timestamps, CIs, dependencies, and prior checks across twins without repeating completed diagnostics."),
 ("controlled-mitigation","Propose a bounded temporary mitigation with approval boundary, blast radius, success criteria, and rollback."),
 ("recovery-and-prevention","Verify customer recovery, state the supported root cause, and define a permanent corrective action and prevention controls."))

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]
def parse_answer(text):
 try: return json.loads(text)
 except json.JSONDecodeError: return {"issueSummary":text}

def build(target, rows):
 seeds=rows[:10]
 if len(seeds)<10:
  seeds=(rows*((10+len(rows)-1)//len(rows)))[:10]
 for seed_index,seed in enumerate(seeds,1):
  original=seed["messages"]; base=parse_answer(original[-1]["content"]); provenance=seed.get("provenance",{})
  for site in SITES:
   for environment in ENVIRONMENTS:
    family=f"{target}:{seed_index:02d}:{site}:{environment.replace(' ','-')}"
    for stage_index,(stage,instruction) in enumerate(STAGES,1):
     incident=f"CURR-V2-{target.upper()}-{seed_index:02d}-{SITES.index(site)+1:02d}-{ENVIRONMENTS.index(environment)+1:02d}-{stage_index:02d}"
     answer={**base,"scenarioContext":{"site":site,"environment":environment,"investigationStage":stage,"simulation":True},
       "stageObjective":instruction,"evidenceBoundary":"Use only supplied or newly collected target-bound evidence. Mark unsupported claims as hypotheses and abstain when decisive evidence is absent.",
       "approvalBoundary":"Read-only diagnostics may proceed. Any mutation, containment, restart, failover, policy, identity, routing, or configuration action requires an incident-bound HITL approval.",
       "auditRequirements":["Record incident ID, UTC timestamp, target CI, command or query, normalized output, provenance and evidence hash.","Bind handoffs to completed checks, findings, limitations and the next discriminating check."],
       "benchmarkLeakage":"This curriculum record was derived only from the prepared training split; held-out validation records were not read."}
     system=original[0]["content"]+" Respond with an auditable structured answer. Never invent command output or claim execution from simulation."
     source_user=original[-2]["content"] if len(original)>1 else "Investigate the supplied incident."
     user=f"SIMULATED CURRICULUM V2 | Incident {incident} | Site {site} | Environment {environment} | Stage {stage}. {instruction} Source scenario: {source_user}"
     yield {"trainingReady":False,"messages":[{"role":"system","content":system},{"role":"user","content":user},{"role":"assistant","content":json.dumps(answer,ensure_ascii=False,separators=(",",":"))}],
       "provenance":{"domain":target,"specialty":target.upper(),"incidentId":incident,"incidentFamily":family,"mode":"SIMULATION","source":"SYNTHETIC_CURRICULUM_V2","sourceTrainingFamily":provenance.get("incidentFamily"),"reviewStatus":"PENDING_DOMAIN_REVIEW"},
       "reviewNotice":"Synthetic review draft. It must be sampled, corrected and explicitly authorized before QLoRA preparation."}

def main():
 p=argparse.ArgumentParser(); p.add_argument("--workspace",type=Path,default=Path("/workspace")); p.add_argument("--output",type=Path,default=Path("/workspace/weak-twins-curriculum-v2")); p.add_argument("--cases",type=int,default=2000); a=p.parse_args()
 if not 200 <= a.cases <= 2500: raise SystemExit("Cases per target must be between 200 and 2500.")
 if a.output.exists(): raise SystemExit("Use a new output directory.")
 a.output.mkdir(parents=True); manifest={"curriculum":"weak-twins-curriculum-v2","casesPerTarget":a.cases,"targets":{},"benchmarkIsolation":"Only prepared train.jsonl seeds were read; validation.jsonl and demo benchmark answers were excluded.","trainingReady":False,"productionPromotionApproved":False}
 for target,prepared in TARGETS.items():
  train=a.workspace/prepared/"train.jsonl"; rows=list(build(target,read(train)))[:a.cases]; output=a.output/f"{target}-review-drafts-v2.jsonl"
  output.write_text("".join(json.dumps(x,ensure_ascii=False,separators=(",",":"))+"\n" for x in rows),encoding="utf-8")
  families={x["provenance"]["incidentFamily"] for x in rows}; prompts={x["messages"][1]["content"] for x in rows}
  manifest["targets"][target]={"cases":len(rows),"incidentFamilies":len(families),"uniquePrompts":len(prompts),"sha256":digest(output),"file":output.name}
 (a.output/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8"); print(json.dumps(manifest,indent=2))
if __name__=="__main__": main()
