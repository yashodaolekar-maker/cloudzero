import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from build_demo_benchmark import TARGETS

class BenchmarkTests(unittest.TestCase):
 def test_all_targets_are_distinct(self): self.assertEqual(16,len(TARGETS)); self.assertEqual(len(TARGETS),len(set(TARGETS)))
 def test_completed_adapters_are_mapped(self):
  self.assertTrue(all(adapter.endswith("-adapter-v1") for adapter,_ in TARGETS.values()))

if __name__=="__main__": unittest.main()
