import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from curriculum import drafts
from prepare import prepare
from workflow import prepare_dataset
from compare import evaluate, local_url


class WorkflowTests(unittest.TestCase):
    def test_drafts_cover_all_domains_and_are_not_trainable(self):
        rows = list(drafts())
        self.assertEqual(len(rows), 25)
        self.assertEqual(len({r['provenance']['domain'] for r in rows}), 5)
        self.assertEqual(prepare(rows, True)[2]['accepted'], 0)

    def test_malformed_rows_are_reported(self):
        self.assertEqual(prepare([None, {'provenance': [], 'messages': []},
                                 {'trainingReady': True, 'provenance': {}, 'messages': [None]}])[2]['accepted'], 0)

    def test_incident_and_family_links_do_not_leak(self):
        rows = []
        for i in range(30):
            rows.append({'trainingReady': True, 'messages': [{'role': 'user', 'content': str(i)}, {'role': 'assistant', 'content': 'answer'}],
                         'provenance': {'incidentId': f'I{i//2}', 'incidentFamily': f'F{i//6}', 'reviewerId': 'reviewer', 'reviewEventId': str(i), 'mode': 'LIVE'}})
        train, validation, report = prepare(rows)
        self.assertTrue(report['readyForPilotTraining'])
        for field in ['incidentId', 'incidentFamily']:
            self.assertFalse({r['provenance'][field] for r in train} & {r['provenance'][field] for r in validation})

    def test_unbalanced_dataset_is_not_ready_and_outputs_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'drafts.jsonl'
            source.write_text('\n'.join(json.dumps(row) for row in drafts()), encoding='utf-8')
            output = Path(folder) / 'prepared'
            report = prepare_dataset(source, output, {'domains': ['NETWORK', 'SECURITY'], 'includeSimulation': True})
            self.assertFalse(report['readyForPilotTraining'])
            self.assertEqual(len(report['sha256']), 2)
            with self.assertRaises(FileExistsError):
                prepare_dataset(source, output, {'domains': []})

    def test_evaluation_is_local_only(self):
        self.assertEqual(local_url('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434')
        for url in ['https://external.example', 'http://localhost@external.example', 'http://localhost/path', 'http://localhost?token=x']:
            with self.assertRaises(ValueError):
                local_url(url)

    def test_failed_generation_never_becomes_a_success(self):
        with patch('urllib.request.urlopen', side_effect=TimeoutError):
            result = evaluate('candidate', [{'role': 'user', 'content': 'check'}], 'http://localhost:11434')
        self.assertEqual(result['status'], 'FAILED')
        self.assertIsNone(result['inputTokens'])

    def test_generation_keeps_usage_but_does_not_claim_accuracy(self):
        import io
        payload = {'done_reason': 'stop', 'message': {'content': '{"answer":"Request the service logs."}'},
                   'prompt_eval_count': 50, 'eval_count': 12}
        with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(payload).encode())) as transport:
            result = evaluate('candidate', [{'role': 'user', 'content': 'Inspect service failure'}], 'http://localhost:11434')
            sent = json.loads(transport.call_args.args[0].data)
        self.assertEqual(result['status'], 'COMPLETED')
        self.assertIsNone(result['review']['correctness'])
        self.assertEqual(result['outputTokens'], 12)
        self.assertEqual(sent['messages'], [{'role': 'user', 'content': 'Inspect service failure'}])

    def test_truncated_generation_is_invalid_even_with_valid_json(self):
        import io
        payload = {'done_reason': 'length', 'message': {'content': '{"answer":"Partial"}'}}
        with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(payload).encode())):
            result = evaluate('candidate', [], 'http://localhost:11434')
        self.assertEqual(result['status'], 'INVALID')


if __name__ == '__main__':
    unittest.main()
