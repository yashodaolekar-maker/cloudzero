import test from "node:test";
import assert from "node:assert/strict";
import { buildGroundedPostmortem } from "../../grounded-response.ts";
import { SRE_DIAGNOSTIC_CASE_IDS, sreDiagnosticIncident } from "../../sre-diagnostic-cases.ts";

test("all SRE diagnostic selections produce integrity-bound postmortems", () => {
  assert.deepEqual(SRE_DIAGNOSTIC_CASE_IDS, ["INC-2026-9041", "INC-2026-8912", "INC-2026-7734"]);
  for (const incidentId of SRE_DIAGNOSTIC_CASE_IDS) {
    const incident = sreDiagnosticIncident(incidentId);
    assert.ok(incident);
    assert.equal(incident.evidence.length, 3);
    assert.ok(incident.evidence.every(item => /^[a-f0-9]{64}$/.test(item.integrityHash || "")));
    const report = buildGroundedPostmortem(incident);
    assert.match(report.markdown, new RegExp(incidentId));
    assert.doesNotMatch(report.markdown, /Actions actually recorded\n- \[[^\]]+\]/);
  }
});

test("all diagnostic cases assert an evidence-backed immediate technical cause", () => {
  for (const incidentId of SRE_DIAGNOSTIC_CASE_IDS) {
    const report = buildGroundedPostmortem(sreDiagnosticIncident(incidentId)!).markdown;
    assert.match(report, /Status: CONFIRMED/);
    assert.match(report, /## 7\. Five whys/);
    assert.match(report, /## 8\. Temporary fix or containment/);
    assert.match(report, /## 9\. Permanent corrective action/);
  }
  assert.equal(sreDiagnosticIncident("INC-UNKNOWN"), undefined);
});
