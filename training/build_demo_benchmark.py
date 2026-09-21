"""Build a compact, reproducible benchmark from held-out incident groups."""
import argparse, hashlib, json, re
from pathlib import Path

TARGETS = {
    "routing-switching": ("routing-switching-adapter-v1", "prepared-routing-switching-demo-v1"),
    "dhcp": ("dhcp-network-adapter-v1", "prepared-dhcp-demo-v2"),
    "cisco-ise": ("cisco-ise-adapter-v1", "prepared-cisco-ise-demo-v1"),
    "wireless": ("wireless-adapter-v1", "prepared-wireless-demo-v1"),
    "palo-alto": ("palo-alto-adapter-v1", "prepared-palo-alto-demo-v1"),
    "sdwan-zscaler": ("sdwan-zscaler-adapter-v1", "sdwan-zscaler-prepared-v1"),
    "silverpeak-edgeconnect": ("silverpeak-edgeconnect-adapter-v1", "silverpeak-edgeconnect-prepared-v1"),
    "windows": ("windows-mastery-adapter-v1", "windows-mastery-prepared-v1"),
    "linux": ("linux-mastery-adapter-v1", "linux-mastery-prepared-v1"),
    "devops": ("devops-mastery-adapter-v1", "devops-mastery-prepared-v1"),
    "cloudops": ("cloudops-mastery-adapter-v1", "cloudops-mastery-prepared-v1"),
    "cyber-fusion": ("security-mastery-adapter-v1", "security-mastery-prepared-v1"),
    "dba": ("dba-adapter-v1", "dba-prepared-v1"),
    "middleware": ("middleware-adapter-v1", "middleware-prepared-v1"),
    "sre": ("sre-adapter-v1", "sre-prepared-v1"),
    "collaboration": ("collaboration-adapter-v1", "collaboration-prepared-v1"),
}

CAPABILITIES = ("issueSummary", "rankedHypotheses", "evidence", "validationChecks", "rootCause",
                "temporaryFix", "permanentFix", "verification", "rollback", "approval", "crossTwin", "confidence")

def sha(data: bytes) -> str: return hashlib.sha256(data).hexdigest()

def tokens(value):
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    words = re.findall(r"[a-z0-9_.:/-]+", text.lower())
    stop = {"the","and","for","with","from","that","this","then","are","was","use","only","after","before"}
    return sorted({w for w in words if len(w) >= 4 and w not in stop})

def rubric(answer):
    try: parsed = json.loads(answer)
    except json.JSONDecodeError: parsed = {}
    expected = {}
    for capability in CAPABILITIES:
        aliases = [capability, capability[0].lower()+capability[1:]]
        value = next((parsed[a] for a in aliases if a in parsed), None)
        if value not in (None, "", [], {}): expected[capability] = tokens(value)[:24]
    return {"requiredCapabilities": list(expected), "concepts": expected,
            "safetyTerms": ["approval", "rollback", "verify", "read-only", "abstain", "insufficient"]}

def main():
    p=argparse.ArgumentParser(); p.add_argument("--workspace",type=Path,default=Path("/workspace")); p.add_argument("--output",type=Path,default=Path("/workspace/demo-benchmark-v1")); p.add_argument("--cases-per-target",type=int,default=30); args=p.parse_args()
    if not 10 <= args.cases_per_target <= 50: raise SystemExit("Demo benchmark supports 10-50 cases per target.")
    if args.output.exists(): raise SystemExit("Use a new benchmark output directory.")
    args.output.mkdir(parents=True)
    counts={}; hashes=[]
    with (args.output/"cases.jsonl").open("w",encoding="utf-8") as out:
        for target,(adapter,prepared) in TARGETS.items():
            validation=args.workspace/prepared/"validation.jsonl"
            if not validation.is_file(): raise SystemExit(f"Missing held-out validation set: {validation}")
            rows=[json.loads(line) for line in validation.read_text(encoding="utf-8").splitlines() if line.strip()]
            selected=rows[:args.cases_per_target]
            if len(selected)<4: raise SystemExit(f"{target} has only {len(selected)} held-out cases; at least four are required")
            counts[target]=len(selected)
            for index,row in enumerate(selected,1):
                messages=row["messages"]; prompt=messages[:-1]; answer=messages[-1]["content"]
                case={"caseId":f"DEMO-BENCH-{target.upper()}-{index:03d}","target":target,"adapter":adapter,
                      "preparedDataset":prepared,"messages":prompt,"reference":answer,"rubric":rubric(answer),
                      "provenance":row.get("provenance",{}),"heldOut":True}
                encoded=json.dumps(case,sort_keys=True,ensure_ascii=False).encode(); case["caseSha256"]=sha(encoded); hashes.append(case["caseSha256"])
                out.write(json.dumps(case,ensure_ascii=False,separators=(",",":"))+"\n")
    cases_path=args.output/"cases.jsonl"
    manifest={"benchmark":"cloudzero-demo-benchmark-v1","casesPerTargetRequested":args.cases_per_target,"targets":counts,
              "totalCases":sum(counts.values()),"casesSha256":sha(cases_path.read_bytes()),"caseHashesSha256":sha("".join(hashes).encode()),
              "heldOutOnly":True,"runningOllamaModelModified":False,"promotionApproved":False,
              "notice":"Synthetic held-out demo benchmark. Domain review remains required before production promotion."}
    (args.output/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    print(json.dumps(manifest,indent=2))
if __name__=="__main__": main()
