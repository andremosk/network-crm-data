import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import tempfile


SPEC = importlib.util.spec_from_file_location(
    "messages_sync", Path(__file__).parents[1] / "scripts" / "messages_sync.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MessagesSyncTests(unittest.TestCase):
    def test_parses_exporter_text(self):
        transcript = (
            "Jul 16, 2026  9:15:00 AM\nAndre\nWould next week work?\n\n"
            "Jul 16, 2026  9:20:00 AM (Read by you after 1 minute)\n"
            "Mary Claire Sullivan\nYes, Tuesday is good.\n\n"
        )
        messages = MODULE.parse_export(transcript)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["sender"], "Andre")
        self.assertEqual(messages[1]["body"], "Yes, Tuesday is good.")
        self.assertIsInstance(messages[0]["at"], dt.datetime)

    def test_matches_only_one_unambiguous_contact(self):
        contacts = [
            {"id": "1", "name": "Mary Claire Sullivan", "email": "mary@example.com", "phone": ""},
            {"id": "2", "name": "Jennifer Greene", "email": "", "phone": "+19145550199"},
        ]
        indexes = MODULE.build_indexes(contacts)
        self.assertEqual(MODULE.match_contact(["Mary Claire Sullivan"], indexes)["id"], "1")
        self.assertEqual(MODULE.match_contact(["(914) 555-0199"], indexes)["id"], "2")
        self.assertIsNone(MODULE.match_contact(["Unknown Person"], indexes))

    def test_matches_unique_name_subset_and_rejects_group_filename(self):
        contacts = [
            {"id": "1", "name": "Mary Claire (Sullivan) Mandeville", "email": "", "phone": ""},
            {"id": "2", "name": "Jennifer Greene", "email": "", "phone": ""},
        ]
        indexes = MODULE.build_indexes(contacts)
        self.assertEqual(MODULE.match_contact(["Mary Claire Sullivan"], indexes)["id"], "1")
        self.assertTrue(MODULE.is_likely_group("Mary Claire Sullivan, Jennifer Greene", ["Mary Claire Sullivan"], indexes))

    def test_writes_private_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "unmatched.json"
            MODULE.write_private_json(path, {"unmatched": [{"participant": "Example"}]})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_conversation_keys_are_stable_and_private(self):
        self.assertEqual(MODULE.conversation_key("Karen"), MODULE.conversation_key("Karen"))
        self.assertNotEqual(MODULE.conversation_key("Karen"), MODULE.conversation_key("Dad"))
        self.assertNotIn("Karen", MODULE.conversation_key("Karen"))


if __name__ == "__main__":
    unittest.main()
