import json, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from generate_weak_twin_curricula import TARGETS, build

class CurriculumTests(unittest.TestCase):
 def seed(self,n):
  return [{"messages":[{"role":"system","content":"Senior engineer"},{"role":"user","content":f"Issue {i}"},{"role":"assistant","content":json.dumps({"rootCause":f"cause {i}","validationChecks":[f"check {i}"]})}],"provenance":{"incidentFamily":f"seed:{i}"}} for i in range(n)]
 def test_targets(self): self.assertEqual(12,len(TARGETS))
 def test_unique_and_grouped(self):
  rows=list(build("routing-switching",self.seed(10))); self.assertEqual(2000,len(rows)); self.assertEqual(2000,len({x["messages"][1]["content"] for x in rows})); self.assertEqual(400,len({x["provenance"]["incidentFamily"] for x in rows})); self.assertTrue(all(not x["trainingReady"] for x in rows))
if __name__=="__main__": unittest.main()
