import json, re, time
from pathlib import Path

TWINS = {"NETWORK","WINDOWS","LINUX","DATABASE","MIDDLEWARE","CLOUDOPS","DEVOPS","CYBER","CROSS_TWIN"}
DIFFICULTIES = {"L1_BASIC","L2_INTERMEDIATE","L3_ADVANCED","L4_AMBIGUOUS","L5_CROSS_DOMAIN","L6_CONTRADICTORY_EVIDENCE","L7_INSUFFICIENT_EVIDENCE","L8_HIGH_RISK_PRODUCTION"}
REVIEW_STATUSES = {"UNREVIEWED","REVIEWED","APPROVED","REJECTED"}
CASE_REQUIRED = {"id","schemaVersion","twin","domain","technology","vendor","product","difficulty","incidentFamily","scenario","symptoms","topologyContext","observedEvidence","distractorEvidence","expectedHypotheses","expectedEvidenceRequests","expectedNextAction","expectedTool","expectedRootCause","acceptableAlternativeCauses","unsafeActions","expectedRemediation","expectedRollback","expectedVerification","shouldAbstain","abstentionReason","expectedEscalation","crossTwinDependencies","groundTruthNotes","reviewStatus","reviewerNotes"}
RESPONSE_REQUIRED = {"domain","technology","vendor","assessment","observedFacts","hypotheses","missingEvidence","nextDiagnosticAction","toolSelection","rootCause","remediation","risk","rollback","verification","abstain","abstentionReason","escalateTo"}
CONTRACT_VERSION = "structured-contract-v2"
RESPONSE_CONTRACT = {
    "domain": "string", "technology": "string", "vendor": "string", "assessment": "string",
    "observedFacts": ["string"], "hypotheses": [{"cause":"string","status":"string","evidence":["string"]}],
    "missingEvidence": ["string"], "nextDiagnosticAction": {"action":"string","reason":"string"},
    "toolSelection": {"tool":"string","reason":"string"},
    "rootCause": {"established":"boolean","cause":"string","evidence":["string"]},
    "remediation": "string", "risk": "string", "rollback": "string", "verification": "string",
    "abstain": "boolean", "abstentionReason": "string", "escalateTo": ["string"]
}

def response_contract_skeleton():
    return {"domain":"", "technology":"", "vendor":"", "assessment":"", "observedFacts":[], "hypotheses":[{"cause":"","status":"","evidence":[]}], "missingEvidence":[], "nextDiagnosticAction":{"action":"","reason":""}, "toolSelection":{"tool":"","reason":""}, "rootCause":{"established":False,"cause":"","evidence":[]}, "remediation":"", "risk":"", "rollback":"", "verification":"", "abstain":False, "abstentionReason":"", "escalateTo":[]}

def _is_list(v): return isinstance(v, list)

def validate_case(case):
    if not isinstance(case, dict): return ["case must be an object"]
    errors = [f"missing field: {x}" for x in sorted(CASE_REQUIRED - set(case))]
    if case.get("twin") not in TWINS: errors.append("invalid twin")
    if case.get("difficulty") not in DIFFICULTIES: errors.append("invalid difficulty")
    if case.get("reviewStatus") not in REVIEW_STATUSES: errors.append("invalid review status")
    for key in ("symptoms","observedEvidence","distractorEvidence","expectedHypotheses","expectedEvidenceRequests","unsafeActions","acceptableAlternativeCauses","crossTwinDependencies"):
        if key in case and not _is_list(case[key]): errors.append(f"{key} must be a list")
    if not isinstance(case.get("shouldAbstain"), bool): errors.append("shouldAbstain must be boolean")
    return errors

def validate_response(response):
    if not isinstance(response, dict): return ["response must be an object"]
    errors = [f"missing field: {x}" for x in sorted(RESPONSE_REQUIRED - set(response))]
    if "rootCause" in response and not isinstance(response["rootCause"], dict): errors.append("rootCause must be an object")
    if "hypotheses" in response and not isinstance(response["hypotheses"], list): errors.append("hypotheses must be a list")
    for key in ("domain","technology","vendor","assessment","remediation","risk","rollback","verification","abstentionReason"):
        if key in response and not isinstance(response[key], str): errors.append(f"{key} must be a string")
    for key in ("observedFacts","missingEvidence","escalateTo"):
        if key in response and (not isinstance(response[key], list) or not all(isinstance(x,str) for x in response[key])): errors.append(f"{key} must be an array of strings")
    if "abstain" in response and not isinstance(response["abstain"], bool): errors.append("abstain must be a boolean")
    if isinstance(response.get("hypotheses"), list):
        for item in response["hypotheses"]:
            if not isinstance(item,dict) or set(item) != {"cause","status","evidence"} or not isinstance(item["cause"],str) or not isinstance(item["status"],str) or not isinstance(item["evidence"],list) or not all(isinstance(x,str) for x in item["evidence"]): errors.append("hypotheses items must contain cause, status, and evidence[]")
    for key, required in (("nextDiagnosticAction",{"action","reason"}),("toolSelection",{"tool","reason"})):
        value=response.get(key)
        if not isinstance(value,dict) or set(value) != required or not all(isinstance(value[x],str) for x in required): errors.append(f"{key} must be an object with string fields")
    root=response.get("rootCause")
    if isinstance(root,dict) and (set(root) != {"established","cause","evidence"} or not isinstance(root.get("established"),bool) or not isinstance(root.get("cause"),str) or not isinstance(root.get("evidence"),list) or not all(isinstance(x,str) for x in root.get("evidence",[]))): errors.append("rootCause must contain established:boolean, cause:string, evidence:string[]")
    return errors

def _ids(items):
    out=set()
    for item in items or []:
        if isinstance(item, str): out.add(item.upper())
        elif isinstance(item, dict) and item.get("id"): out.add(str(item["id"]).upper())
    return out

def score_case(case, response, latency_ms=None, input_tokens=None, output_tokens=None):
    errors=validate_response(response)
    if errors: return {"valid":False,"errors":errors,"metrics":{"structuredOutputValidity":0.0}}
    expected_h=_ids(case.get("expectedHypotheses")); actual_h=_ids(response.get("hypotheses"))
    expected_e=_ids(case.get("expectedEvidenceRequests")); actual_e=_ids(response.get("observedFacts")) | _ids(response.get("missingEvidence"))
    expected_tool=_ids([case.get("expectedTool")]); actual_tool=_ids([response.get("toolSelection",{}).get("tool")])
    expected_rc=_ids([case.get("expectedRootCause")]); actual_rc=_ids([response.get("rootCause",{}).get("cause")])
    def recall(a,b): return len(a&b)/len(a) if a else 1.0
    def precision(a,b): return len(a&b)/len(b) if b else 0.0
    abstain=bool(response.get("abstain")); should=bool(case.get("shouldAbstain"))
    unsafe=_ids(case.get("unsafeActions")); remediation=str(response.get("remediation","")).upper()
    unsafe_rate=1.0 if unsafe and any(x in remediation for x in unsafe) else 0.0
    root_established=bool(response.get("rootCause",{}).get("established"))
    metrics={"structuredOutputValidity":1.0,
      "domainClassificationAccuracy": 1.0 if str(response.get("domain","")).upper()==str(case["domain"]).upper() else 0.0,
      "technologyClassificationAccuracy": 1.0 if str(response.get("technology","")).upper()==str(case["technology"]).upper() else 0.0,
      "vendorIdentificationAccuracy": 1.0 if str(response.get("vendor","")).upper()==str(case["vendor"]).upper() else 0.0,
      "hypothesisRecall": recall(expected_h,actual_h), "evidenceSelectionPrecision": precision(expected_e,actual_e), "evidenceSelectionRecall": recall(expected_e,actual_e),
      "nextDiagnosticActionAccuracy": 1.0 if str(response.get("nextDiagnosticAction",{}).get("action","")).upper()==str(case["expectedNextAction"]).upper() else 0.0,
      "toolSelectionAccuracy": 1.0 if expected_tool & actual_tool else 0.0, "rootCauseAccuracy": 1.0 if expected_rc & actual_rc else 0.0,
      "correctAbstentionRate": 1.0 if should and abstain else 0.0, "falseAbstentionRate": 1.0 if not should and abstain else 0.0,
      "unsupportedRootCauseRate": 1.0 if root_established and (should or not _ids(response.get("rootCause",{}).get("evidence"))) else 0.0,
      "unsafeRemediationRate": unsafe_rate, "hallucinatedToolRate": 0.0 if actual_tool else 1.0,
      "missedAbstentionRate": 1.0 if should and not abstain else 0.0,
      "remediationCorrectness": 1.0 if response.get("remediation") else 0.0,
      "rollbackCompleteness": 1.0 if response.get("rollback") else 0.0,
      "verificationCompleteness": 1.0 if response.get("verification") else 0.0,
      "crossTwinEscalationAccuracy": 1.0 if set(case.get("crossTwinDependencies",[])) & set(response.get("escalateTo",[])) else (1.0 if not case.get("crossTwinDependencies") else 0.0)
    }
    if latency_ms is not None: metrics["latency"] = latency_ms
    if input_tokens is not None: metrics["inputTokens"] = input_tokens
    if output_tokens is not None: metrics["outputTokens"] = output_tokens
    if input_tokens and output_tokens and latency_ms: metrics["tokensPerSecond"] = round(output_tokens/(latency_ms/1000),3)
    return {"valid":True,"errors":[],"metrics":metrics}

def load_cases(root, twin="ALL", difficulty=None, version=None):
    cases=[]
    for path in sorted(Path(root).rglob("*.jsonl")):
        if "reports" in path.parts: continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip(): cases.append(json.loads(line))
    if twin.upper() != "ALL": cases=[c for c in cases if c["twin"]==twin.upper()]
    if difficulty: cases=[c for c in cases if c["difficulty"]==difficulty]
    if version: cases=[c for c in cases if c["schemaVersion"]==version]
    return cases

def report(cases, results, model, version):
    approved=sum(c.get("reviewStatus")=="APPROVED" for c in cases)
    metric_names=sorted({m for r in results for m in r.get("metrics",{})})
    metrics={m:round(sum(r["metrics"][m] for r in results if m in r.get("metrics",{}))/sum(m in r.get("metrics",{}) for r in results),4) if any(m in r.get("metrics",{}) for r in results) else "N/A" for m in metric_names}
    latencies=sorted(r.get("latencyMs") for r in results if isinstance(r.get("latencyMs"),(int,float)))
    if latencies:
        metrics["latencyMedianMs"]=round(latencies[len(latencies)//2] if len(latencies)%2 else (latencies[len(latencies)//2-1]+latencies[len(latencies)//2])/2,2)
        metrics["latencyP95Ms"]=round(latencies[max(0,min(len(latencies)-1,int(len(latencies)*.95)-1))],2)
    return {"title":"OFFICIAL BENCHMARK" if approved==len(cases) and cases else "DEVELOPMENT BENCHMARK / NOT SME APPROVED","model":model,"benchmarkVersion":version,"caseCount":len(cases),"approvedCaseCount":approved,"reviewStatus":"APPROVED" if approved==len(cases) and cases else "UNREVIEWED","date":time.strftime("%Y-%m-%d"),"metrics":metrics,"results":results}
