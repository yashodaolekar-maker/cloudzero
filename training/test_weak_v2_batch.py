import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from generate_weak_twin_curricula import TARGETS
class BatchTests(unittest.TestCase):
 def test_twelve_unique_targets(self): self.assertEqual(12,len(TARGETS)); self.assertEqual(12,len(set(TARGETS)))
 def test_v2_names_do_not_replace_v1(self): self.assertTrue(all(f"{x}-adapter-v2"!=f"{x}-adapter-v1" for x in TARGETS))
if __name__=="__main__": unittest.main()
