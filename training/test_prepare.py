import unittest
from prepare import prepare

def example(i, mode='LIVE'):
    return {'trainingReady':True,'messages':[{'role':'user','content':f'Question {i}'},{'role':'assistant','content':'{"answer":"Validated response"}'}],
            'provenance':{'incidentId':f'INC-{i//4}','mode':mode,'reviewEventId':f'review-{i}','reviewerId':'human'}}

class PreparationTests(unittest.TestCase):
    def test_incident_groups_are_isolated(self):
        train, validation, report = prepare([example(i) for i in range(20)])
        self.assertTrue(report['readyForPilotTraining'])
        self.assertFalse({r['provenance']['incidentId'] for r in train} & {r['provenance']['incidentId'] for r in validation})
    def test_simulation_and_duplicates_are_excluded(self):
        train, validation, report = prepare([example(1),example(1),example(2,'SIMULATION')])
        self.assertEqual(report['accepted'],1)
        self.assertFalse(report['readyForPilotTraining'])
    def test_missing_reviews_never_become_training(self):
        row=example(1); row['provenance']['reviewEventId']=None
        self.assertEqual(prepare([row])[2]['accepted'],0)

if __name__ == '__main__': unittest.main()
