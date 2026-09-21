import json, tempfile, unittest
from pathlib import Path
from .framework import validate_case, validate_response, score_case, load_cases, report

class BenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.cases=load_cases(Path(__file__).parent/'cases')
    def test_case_counts_and_schema(self):
        self.assertEqual(len(self.cases),55)
        self.assertTrue(all(not validate_case(c) for c in self.cases))
    def test_invalid_values(self):
        c=dict(self.cases[0]); c['twin']='BAD'; self.assertIn('invalid twin',validate_case(c))
        c['twin']='NETWORK'; c['difficulty']='BAD'; self.assertIn('invalid difficulty',validate_case(c))
        c['difficulty']='L1_BASIC'; c['reviewStatus']='BAD'; self.assertIn('invalid review status',validate_case(c))
    def test_malformed_response(self): self.assertTrue(validate_response({}))
    def test_root_cause_and_tool_scoring(self):
        c=self.cases[0]; r={"domain":c['domain'],"technology":c['technology'],"vendor":c['vendor'],"assessment":"x","observedFacts":[],"hypotheses":[{"cause":c['incidentFamily'],"status":"candidate","evidence":["x"]}],"missingEvidence":[],"nextDiagnosticAction":{"action":c['expectedNextAction'],"reason":"x"},"toolSelection":{"tool":c['expectedTool']['id'],"reason":"x"},"rootCause":{"established":True,"cause":c['expectedRootCause']['id'],"evidence":["x"]},"remediation":"x","risk":"low","rollback":"x","verification":"x","abstain":False,"abstentionReason":"","escalateTo":[]}
        s=score_case(c,r); self.assertEqual(s['metrics']['rootCauseAccuracy'],1.0); self.assertEqual(s['metrics']['toolSelectionAccuracy'],1.0)
    def test_abstention_scoring(self):
        c=next(x for x in self.cases if x['shouldAbstain']); r={"domain":c['domain'],"technology":c['technology'],"vendor":c['vendor'],"assessment":"x","observedFacts":[],"hypotheses":[],"missingEvidence":["x"],"nextDiagnosticAction":{"action":"COLLECT_RELEVANT_TELEMETRY","reason":"x"},"toolSelection":{"tool":"x","reason":"x"},"rootCause":{"established":False,"cause":"","evidence":[]},"remediation":"none","risk":"high","rollback":"none","verification":"none","abstain":True,"abstentionReason":"missing","escalateTo":[]}
        self.assertEqual(score_case(c,r)['metrics']['correctAbstentionRate'],1.0)
    def test_report_empty(self):
        x=report([],[],"model","v1"); self.assertEqual(x['caseCount'],0); self.assertIn('DEVELOPMENT',x['title'])
    def test_training_leakage_guard(self):
        import sys
        sys.path.insert(0, str(Path(__file__).parents[1]))
        from prepare import assert_no_benchmark_leakage
        with self.assertRaises(ValueError): assert_no_benchmark_leakage([{"id": self.cases[0]['id']}])
    def test_safety_vendor_and_cross_twin_metrics(self):
        c=next(x for x in self.cases if x['twin']=='CROSS_TWIN'); r={"domain":c['domain'],"technology":c['technology'],"vendor":c['vendor'],"assessment":"x","observedFacts":[],"hypotheses":[],"missingEvidence":[],"nextDiagnosticAction":{"action":"x","reason":"x"},"toolSelection":{"tool":"x","reason":"x"},"rootCause":{"established":False,"cause":"","evidence":[]},"remediation":"UNCONTROLLED_PRODUCTION_CHANGE","risk":"high","rollback":"x","verification":"x","abstain":False,"abstentionReason":"","escalateTo":c['crossTwinDependencies']}
        m=score_case(c,r)['metrics']; self.assertEqual(m['unsafeRemediationRate'],1.0); self.assertEqual(m['crossTwinEscalationAccuracy'],1.0); self.assertEqual(m['vendorIdentificationAccuracy'],1.0)
    def test_inference_prompt_excludes_ground_truth(self):
        from .runner import model_prompt, FORBIDDEN
        prompt=model_prompt(self.cases[0])
        self.assertFalse(any(field in prompt for field in FORBIDDEN))
    def test_canonical_contract_rejects_wrong_shapes(self):
        from .framework import response_contract_skeleton
        r=response_contract_skeleton(); self.assertFalse(validate_response(r))
        r['abstain']='false'; self.assertIn('abstain must be a boolean',validate_response(r))
        r=response_contract_skeleton(); r['rootCause']='DNS failure'; self.assertIn('rootCause must be an object',validate_response(r))
    def test_calibration_selection_is_deterministic(self):
        from .runner import select_calibration_cases
        a=select_calibration_cases(self.cases); b=select_calibration_cases(self.cases)
        self.assertEqual([x['id'] for x in a],[x['id'] for x in b]); self.assertEqual(len(a),11)

if __name__=='__main__': unittest.main()
