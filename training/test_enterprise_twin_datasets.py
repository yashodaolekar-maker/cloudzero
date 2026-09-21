import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_enterprise_twin_datasets import CURRICULA, cases

class EnterpriseTwinDatasetTests(unittest.TestCase):
    def test_each_domain_has_at_least_1500_unique_review_drafts(self):
        for domain in CURRICULA:
            rows=list(cases(domain))
            self.assertGreaterEqual(len(rows),1500)
            self.assertEqual(len(rows),len({json.dumps(r['messages'][:-1],sort_keys=True) for r in rows}))
            self.assertEqual(len(rows),len({r['messages'][-1]['content'] for r in rows}))
            self.assertGreaterEqual(len({r['provenance']['incidentFamily'] for r in rows}),300)

    def test_review_boundary_and_response_contract(self):
        for domain in CURRICULA:
            for row in cases(domain):
                self.assertFalse(row['trainingReady'])
                self.assertEqual(row['provenance']['domain'],domain)
                answer=json.loads(row['messages'][-1]['content'])
                for field in ('rankedHypotheses','observedEvidence','validationChecks','rootCause','temporaryFix','permanentFix','crossTwin','verification','rollback','approval','confidence'):
                    self.assertIn(field,answer)
                self.assertNotIn('<think>',row['messages'][-1]['content'].lower())

if __name__=='__main__': unittest.main()
