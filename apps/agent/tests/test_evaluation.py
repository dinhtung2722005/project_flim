import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from pjflim_agent.catalog import AgentError, create_demo
from pjflim_agent.evaluation import CASES, evaluate_demo

class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.catalog = create_demo(Path(self.temp.name) / "catalog.snapshot.json")
    def tearDown(self):
        self.temp.cleanup()
    def run_eval(self, fail=None, forged=False):
        questions = []
        def ask(question, mode):
            questions.append((question, mode))
            if fail:
                raise AgentError(fail)
            expected = next(c[2] for c in CASES if c[1] == question)
            return {"cards": [{"title_id": expected, "evidence": [{"title_id": "forged" if forged else expected}],
                              "external_ratings": []}], "tool_calls": 2}
        class Retrieval:
            def search(_, name, **kw):
                return [next(t for t in self.catalog.by_id.values() if t.name == name)]
        agent = SimpleNamespace(catalog=self.catalog, ask=ask)
        return evaluate_demo(agent, Retrieval()), questions

    def test_three_cases_passing_and_no_prompt_saved(self):
        report, questions = self.run_eval()
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["passedCases"], 3)
        self.assertTrue(all(q[1] == "CATALOG" for q in questions))
        raw = json.dumps(report, ensure_ascii=False)
        self.assertTrue(all(case[1] not in raw for case in CASES))
        self.assertTrue(report["quality_review_required"])

    def test_failure_is_not_claimed_as_accepted_quality(self):
        report, _ = self.run_eval(fail="MODEL_UNAVAILABLE")
        self.assertEqual(report["status"], "NEEDS_REVIEW")
        self.assertEqual(report["passedCases"], 0)
        self.assertTrue(all(c["errorCode"] == "MODEL_UNAVAILABLE" for c in report["cases"]))

    def test_forged_evidence_fails(self):
        report, _ = self.run_eval(forged=True)
        self.assertEqual(report["status"], "NEEDS_REVIEW")

    def test_never_evaluates_live_catalog_without_labels(self):
        catalog = SimpleNamespace(snapshot=SimpleNamespace(demo=False))
        report = evaluate_demo(SimpleNamespace(catalog=catalog), None)
        self.assertEqual(report["status"], "SKIPPED")
        self.assertEqual(report["reason"], "DEMO_ONLY")
