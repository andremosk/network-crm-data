import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
SPEC = importlib.util.spec_from_file_location("gmail_sync", Path(__file__).parents[1] / "scripts" / "gmail_sync.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GmailSyncTests(unittest.TestCase):
    def test_bounded_review_and_daily_recent_enrichment(self):
        calls = []
        def request(path, payload):
            calls.append((path, payload))
            if path.endswith("gmail-review-sync"):
                return {"scanned": 25, "proposed": 1, "has_more": True}
            self.assertEqual(payload, {"mode": "recent"})
            return {"scanned": 20, "proposed": 1, "completed": True}
        state = MODULE.sync(request, {}, "2026-10-23")
        self.assertEqual(len(calls), 5)
        self.assertEqual(state["lastEnrichmentDate"], "2026-10-23")
        calls.clear()
        MODULE.sync(request, state, "2026-10-23")
        self.assertEqual(len(calls), 4)

    def test_incomplete_enrichment_is_resumed_and_failures_are_not_marked_done(self):
        def request(path, payload):
            return {"scanned": 0, "has_more": False, "completed": False}
        self.assertNotIn("lastEnrichmentDate", MODULE.sync(request, {}, "2026-10-23"))
        state = {}
        def failure(path, payload):
            raise RuntimeError("offline")
        with self.assertRaises(RuntimeError):
            MODULE.sync(failure, state, "2026-10-23")
        self.assertEqual(state, {})
