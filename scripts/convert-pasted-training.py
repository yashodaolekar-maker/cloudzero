"""Convert reviewed incident JSONL into the auditable CloudZero SFT schema."""
import json
import sys
from pathlib import Path

src, out = map(Path, sys.argv[1:3])
append = len(sys.argv) > 3 and sys.argv[3] == "--append"
raw = src.read_text(encoding="utf-8-sig")
rows = []
decoder = json.JSONDecoder()
while raw.strip():
    raw = raw.lstrip()
    try:
        row, end = decoder.raw_decode(raw)
    except json.JSONDecodeError:
        print("warning: ignored truncated or malformed trailing record", file=sys.stderr)
        break
    rows.append(row)
    raw = raw[end:]
converted = []
for row in rows:
    incident = row["incidentId"]
    domain = row.get("domain", "UNKNOWN")
    answer = {"diagnosis": row.get("rootCause", ""), "evidence": row.get("evidence", []), "validationChecks": row.get("validationChecks", []), "rejectedHypothesis": row.get("rejectedHypothesis", ""), "temporaryFix": row.get("temporaryFix", ""), "permanentFix": row.get("permanentFix", ""), "verification": row.get("verification", ""), "rollback": row.get("rollback", ""), "simulation": True}
    converted.append({"trainingReady": True, "messages": [{"role": "system", "content": f"Act as a senior {domain} engineer. Use only supplied evidence. Distinguish hypotheses from facts. Label simulation and require approval for changes. Return an auditable response."}, {"role": "user", "content": f"Investigate {incident} in {row.get('location', 'unknown location')}: {row.get('issueSummary', '')}."}, {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False, separators=(",", ":"))}], "provenance": {"domain": domain, "incidentId": incident, "incidentFamily": f"{domain}:{incident.split('-', 2)[-1].rsplit('-', 1)[0]}", "mode": "SIMULATION", "source": "USER_PROVIDED_SIMULATION", "reviewerId": row.get("reviewerId", ""), "reviewEventId": f"USER-REVIEW-{incident}", "reviewDecision": row.get("reviewDecision", ""), "approvalMetadata": row.get("approvalMetadata", {}), "correctionHistory": row.get("correctionHistory", [])}, "reviewNotice": "User-provided simulation record; domain validation is still required before promotion."})
out.parent.mkdir(parents=True, exist_ok=True)
payload = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in converted)
if append:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf-8") as handle:
        handle.write(payload)
else:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(payload, encoding="utf-8")
print(f"converted={len(converted)} output={out}")
