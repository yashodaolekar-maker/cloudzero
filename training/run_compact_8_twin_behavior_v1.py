"""COMPACT_8_TWIN_BEHAVIOR_V1: raw adapter behavior, then runtime validation.

This is an evaluation-only harness.  It never writes to a dataset, adapter,
benchmark case, runtime route, or Ollama model.  It loads one 4-bit model at a
time and writes immutable-looking (new, versioned) evaluation artifacts.
"""
import gc
import hashlib
import json
import re
import statistics
import sys
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))
from benchmarks.framework import CONTRACT_VERSION, load_cases, response_contract_skeleton, validate_response

BASE = "Qwen/Qwen3-0.6B"
REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
OUT = ROOT / ".data/training/evaluations/compact-8-twin-behavior-v1"
TWINS = ("network", "windows", "linux", "database", "middleware", "cloudops", "devops", "cyber")
ADAPTERS = {t: ROOT / f".data/training/artifacts/{t}-candidate-v{'3' if t == 'network' else '1'}/adapter" for t in TWINS}


def canonical_prompt(case):
    payload = {k: case.get(k) for k in ("scenario", "symptoms", "topologyContext", "observedEvidence", "distractorEvidence")}
    return ("You are evaluating observable engineering behavior for a CloudZero digital twin. "
            f"Evaluation mode is MODEL_ONLY. Contract version: {CONTRACT_VERSION}. "
            "Do not use external knowledge retrieval or tools. Return exactly one JSON object, with no Markdown fences or text before or after it. "
            "Do not provide chain-of-thought. Populate only from the incident input; do not invent telemetry, configuration changes, tool results, or confirmed root cause. "
            "Use abstention when evidence is insufficient. The exact required JSON shape is:\n"
            + json.dumps(response_contract_skeleton(), indent=2) + "\nIncident input:\n" + json.dumps(payload, ensure_ascii=False))


def select_cases(all_cases):
    by_twin = {t.upper(): [c for c in all_cases if c["twin"] == t.upper()] for t in TWINS}
    cross = [c for c in all_cases if c["twin"] == "CROSS_TWIN"]
    selections = {}
    for twin in TWINS:
        domain = by_twin[twin.upper()]
        normal = next(c for c in domain if c["difficulty"] == "L1_BASIC")
        hard_negative = next(c for c in domain if c["difficulty"] == "L6_CONTRADICTORY_EVIDENCE")
        dependency = next(c for c in cross if twin.upper() in c["crossTwinDependencies"])
        insufficient = next((c for c in domain + cross if c["shouldAbstain"] and (c["twin"] == twin.upper() or twin.upper() in c["crossTwinDependencies"])), None)
        # The frozen suite has no abstention case for several domains.  Retain a
        # real ambiguous case instead of fabricating an insufficient-evidence case.
        if insufficient is None:
            insufficient = next(c for c in domain if c["difficulty"] == "L4_AMBIGUOUS")
            insufficient_kind = "AMBIGUOUS_EVIDENCE_SUBSTITUTE__SCORER_UNVERIFIED"
        else:
            insufficient_kind = "INSUFFICIENT_EVIDENCE"
        if dependency["id"] == insufficient["id"]:
            dependency = next(c for c in cross if twin.upper() in c["crossTwinDependencies"] and c["id"] != insufficient["id"])
        selections[twin] = [
            {"role": "NORMAL_DOMAIN_DIAGNOSIS", "case": normal},
            {"role": insufficient_kind, "case": insufficient},
            {"role": "HARD_NEGATIVE_MISLEADING_SYMPTOM", "case": hard_negative},
            {"role": "CROSS_TWIN_DEPENDENCY", "case": dependency},
        ]
    return selections


def strict_and_inspection_parse(raw):
    text = (raw or "").strip()
    fenced = text.startswith("```")
    trailing = bool(re.search(r",\s*[}\]]", text))
    try:
        parsed = json.loads(text)
        return parsed, parsed, None, fenced, trailing
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    inspect_text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip() if fenced and "\n" in text else text
    try:
        inspected = json.loads(inspect_text)
    except Exception:
        inspected = {}
    label = "MARKDOWN_FENCE" if fenced else ("TRAILING_COMMA" if trailing else "INVALID_JSON")
    return {}, inspected, f"{label}: {error}", fenced, trailing


def words(value):
    return set(re.findall(r"[A-Z0-9_]+", json.dumps(value, ensure_ascii=False).upper()))


def behavior(case, response, raw):
    root = response.get("rootCause", {}) if response else {}
    hypotheses = response.get("hypotheses", []) if response else []
    proposed = "CONFIRMED" if root.get("established") is True else ("INSUFFICIENT_EVIDENCE" if response.get("abstain") else "SUSPECTED")
    statuses = {str(x.get("status", "")).upper() for x in hypotheses if isinstance(x, dict)}
    proposed = next((x for x in ("ELIMINATED", "CONFIRMED", "SUPPORTED", "SUSPECTED", "INSUFFICIENT_EVIDENCE") if x in statuses), proposed)
    initial_only = bool(case.get("observedEvidence")) and all(str(x).upper() == "INITIAL_SIGNAL" for x in case["observedEvidence"])
    remediation = str(response.get("remediation", "")) if response else ""
    mutation = bool(re.search(r"\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|APPLY|PATCH|ROTATE|ASSIGN|UPDATE)\b", remediation.upper()))
    escalations = {str(x).upper() for x in response.get("escalateTo", [])} if response else set()
    expected = {str(x).upper() for x in case.get("crossTwinDependencies", [])}
    raw_words = re.findall(r"\w+", raw.lower())
    repetition = 1 - len(set(raw_words)) / len(raw_words) if raw_words else 1
    evidence_text = words(root.get("evidence", [])) | words([x.get("evidence", []) for x in hypotheses if isinstance(x, dict)])
    return {
        "domainSelection": str(response.get("domain", "")).upper() == str(case["domain"]).upper() if response else False,
        "observedFacts": bool(response.get("observedFacts")) if response else False,
        "hypotheses": bool(hypotheses),
        "nextEvidence": bool(response.get("missingEvidence")) or bool(response.get("nextDiagnosticAction", {}).get("action")) if response else False,
        "rcaState": proposed,
        "abstention": response.get("abstain") is True if response else False,
        "crossTwinEscalation": bool(expected & escalations) if expected else None,
        "remediation": bool(remediation), "rollback": bool(response.get("rollback")) if response else False,
        "verification": bool(response.get("verification")) if response else False,
        "unsupportedRCA": bool(root.get("established")) and not bool(root.get("evidence")),
        "prematureRCA": initial_only and (bool(root.get("established")) or proposed in {"SUPPORTED", "CONFIRMED", "ELIMINATED"}),
        "unsafeRemediation": initial_only and mutation,
        "overAbstention": not case.get("shouldAbstain") and response.get("abstain") is True if response else False,
        "catastrophicOutput": not bool(raw.strip()) or repetition > .85,
        "initialSignalViolation": initial_only and proposed in {"SUPPORTED", "CONFIRMED", "ELIMINATED"},
        "eliminationSupported": (proposed != "ELIMINATED") or any(x in " ".join(case.get("observedEvidence", []) + case.get("distractorEvidence", [])).upper() for x in ("ELIMINATED", "DISPROVED", "CONTRADICT")),
        "evidenceStateScorer": "SCORER_UNVERIFIED" if not any(x in " ".join(case.get("observedEvidence", [])).upper() for x in ("SUPPORTED", "CONFIRMED", "ELIMINATED", "CONTRADICT")) else "DETERMINISTIC_CASE_EVIDENCE",
        "modelProposedState": proposed,
    }


def quantization():
    return BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16)


def load_model(adapter=None):
    model = AutoModelForCausalLM.from_pretrained(BASE, revision=REVISION, trust_remote_code=False, quantization_config=quantization(), device_map={"": "cuda:0"}, dtype=torch.float16)
    if adapter:
        model = PeftModel.from_pretrained(model, adapter, is_trainable=False)
    model.eval()
    return model


def infer(model, tokenizer, case):
    torch.manual_seed(42)
    prompt = canonical_prompt(case)
    ids = tokenizer.apply_chat_template([{"role": "user", "content": prompt}], tokenize=True, add_generation_prompt=True, enable_thinking=False, return_tensors="pt").to("cuda:0")
    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(ids, attention_mask=torch.ones_like(ids), max_new_tokens=512, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    torch.cuda.synchronize()
    latency = round((time.perf_counter() - started) * 1000, 2)
    raw = tokenizer.decode(output[0][ids.shape[1]:], skip_special_tokens=True)
    strict, inspectable, error, fenced, trailing = strict_and_inspection_parse(raw)
    schema_errors = validate_response(strict) if strict else []
    return {"caseId": case["id"], "rawResponse": raw, "completion": bool(raw.strip()), "generatedTokens": int(output.shape[1]-ids.shape[1]), "hitTokenCeiling": int(output.shape[1]-ids.shape[1]) >= 512, "inferenceDurationMs": latency, "strictJson": bool(strict), "schemaValid": bool(strict) and not schema_errors, "markdownFence": fenced, "trailingComma": trailing, "invalidJson": bool(error) and not fenced and not trailing, "formatFailure": error, "schemaErrors": schema_errors, "inspectableResponse": inspectable, "behavior": behavior(case, inspectable, raw)}


def leakage(cases):
    training_files = [p for p in (ROOT / ".data/training").rglob("*.jsonl") if any(x in str(p).lower() for x in ("prepared", "dataset"))]
    corpus = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in training_files)
    rows = [{"caseId": c["id"], "idPresent": c["id"] in corpus, "scenarioPresent": c["scenario"] in corpus} for c in cases]
    return {"trainingFilesChecked": [str(p.relative_to(ROOT)) for p in training_files], "cases": rows, "leakageDetected": any(x["idPresent"] or x["scenarioPresent"] for x in rows)}


def aggregate(rows):
    b = [x["behavior"] for x in rows]
    return {"cases": len(rows), "completed": sum(x["completion"] for x in rows), "schemaValid": sum(x["schemaValid"] for x in rows), "correctAbstention": sum(x["behavior"]["abstention"] and x["caseId"].endswith(("-06",)) for x in rows), "unsupportedRCA": sum(x["unsupportedRCA"] for x in b), "prematureRCA": sum(x["prematureRCA"] for x in b), "unsafeRemediation": sum(x["unsafeRemediation"] for x in b), "crossTwinBehavior": sum(x["crossTwinEscalation"] is True for x in b), "medianInferenceMs": round(statistics.median(x["inferenceDurationMs"] for x in rows), 2), "maxInferenceMs": max(x["inferenceDurationMs"] for x in rows), "truncations": sum(x["hitTokenCeiling"] for x in rows)}


def delta(base, adapter):
    bb, ab = base["behavior"], adapter["behavior"]
    if bb["evidenceStateScorer"] == "SCORER_UNVERIFIED": return "INCONCLUSIVE"
    bad = lambda x: x["unsupportedRCA"] or x["prematureRCA"] or x["unsafeRemediation"] or x["catastrophicOutput"]
    if bad(bb) and not bad(ab): return "BETTER_BEHAVIOR"
    if not bad(bb) and bad(ab): return "REGRESSION"
    return "SAME_BEHAVIOR"


def main():
    if not torch.cuda.is_available(): raise SystemExit("CUDA is required; CPU fallback is prohibited for this benchmark.")
    all_cases = load_cases(ROOT / "training/benchmarks/cases", "ALL", version="v1")
    selected = select_cases(all_cases)
    flat = [entry["case"] for entries in selected.values() for entry in entries]
    leak = leakage(flat)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "selected-cases.json").write_text(json.dumps({t: [{"role": x["role"], "caseId": x["case"]["id"], "reviewStatus": x["case"]["reviewStatus"]} for x in v] for t,v in selected.items()}, indent=2), encoding="utf-8")
    (OUT / "leakage-report.json").write_text(json.dumps(leak, indent=2), encoding="utf-8")
    if leak["leakageDetected"]: raise SystemExit("Benchmark leakage detected; inference stopped.")
    tokenizer = AutoTokenizer.from_pretrained(BASE, revision=REVISION, trust_remote_code=False)
    unique = {c["id"]: c for c in flat}
    torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats(); base = load_model(); base_rows = []
    for index, c in enumerate(unique.values(), 1):
        print(f"base {index}/{len(unique)} {c['id']}", flush=True)
        base_rows.append(infer(base, tokenizer, c))
        (OUT / "base-results.partial.json").write_text(json.dumps({"model": BASE, "revision": REVISION, "results": base_rows}, indent=2), encoding="utf-8")
    base_peak = {"allocatedBytes": torch.cuda.max_memory_allocated(), "reservedBytes": torch.cuda.max_memory_reserved()}; del base; gc.collect(); torch.cuda.empty_cache()
    (OUT / "base-results.json").write_text(json.dumps({"model": BASE, "revision": REVISION, "results": base_rows, "peakVRAM": base_peak}, indent=2), encoding="utf-8")
    base_by_id = {x["caseId"]: x for x in base_rows}; summaries = {}; comparisons = []; performance = {"base": base_peak, "adapters": {}}
    for twin in TWINS:
        torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats(); model = load_model(ADAPTERS[twin]); rows = []
        for index, entry in enumerate(selected[twin], 1):
            print(f"{twin} {index}/4 {entry['case']['id']}", flush=True)
            rows.append(infer(model, tokenizer, entry["case"]))
            (OUT / f"{twin}-results.partial.json").write_text(json.dumps({"adapter": str(ADAPTERS[twin]), "results": rows}, indent=2), encoding="utf-8")
        peak = {"allocatedBytes": torch.cuda.max_memory_allocated(), "reservedBytes": torch.cuda.max_memory_reserved()}; del model; gc.collect(); torch.cuda.empty_cache()
        summary = aggregate(rows); status = "RAW_BEHAVIOR_ACCEPTABLE_FOR_EXPERIMENT" if summary["completed"] == 4 and summary["schemaValid"] == 4 and not any(r["behavior"][x] for r in rows for x in ("unsupportedRCA", "prematureRCA", "unsafeRemediation", "catastrophicOutput")) else "RAW_BEHAVIOR_NEEDS_IMPROVEMENT"
        summary["gate"] = status; summaries[twin] = summary; performance["adapters"][twin] = {**peak, **{k: summary[k] for k in ("medianInferenceMs", "maxInferenceMs", "truncations")}}
        (OUT / f"{twin}-results.json").write_text(json.dumps({"adapter": str(ADAPTERS[twin]), "results": rows, "summary": summary, "peakVRAM": peak}, indent=2), encoding="utf-8")
        for row in rows: comparisons.append({"twin": twin, "caseId": row["caseId"], "delta": delta(base_by_id[row["caseId"]], row), "base": base_by_id[row["caseId"]], "adapter": row})
    (OUT / "raw-behavior-summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    (OUT / "adapter-vs-base.json").write_text(json.dumps(comparisons, indent=2), encoding="utf-8")
    (OUT / "performance-summary.json").write_text(json.dumps(performance, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "twins": summaries, "baseCases": len(unique)}, indent=2))


if __name__ == "__main__": main()
