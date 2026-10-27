import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
import json
import types


SPEC = importlib.util.spec_from_file_location(
    "messages_sync", Path(__file__).parents[1] / "scripts" / "messages_sync.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MessagesSyncTests(unittest.TestCase):
    def test_group_run_queues_business_without_matching_and_dedupes_second_run(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            exporter = root / 'exporter'
            exporter.touch()
            config = root / 'config.json'
            config.write_text(json.dumps({'token': 'synthetic', 'exporter': str(exporter)}))
            now = dt.datetime.now().astimezone()
            stamp = (now - dt.timedelta(minutes=10)).strftime('%b %d, %Y  %I:%M:%S %p')
            (root / 'state.json').write_text(json.dumps({'lastCompletedAt': MODULE.isoformat(now - dt.timedelta(hours=1))}))
            requests = []
            def api(url, token, path, method='GET', payload=None):
                if method == 'GET':
                    return {'contacts': [{'id': '789', 'name': 'Mike Example'}], 'conversationDecisions': []}
                requests.append(payload)
                return {'status': 'pending', 'id': '91'}
            def export(command, **kwargs):
                target = Path(command[command.index('--export-path') + 1])
                (target / 'Mike & Samantha.txt').write_text(stamp + '\nAndre\nCould you connect me to the product manager?\n\n' + stamp + '\nSamantha Example\nI will reach out to him.\n')
                (target / 'Parents & Coaches.txt').write_text(stamp + '\nCoach\nCan you bring the bats to practice tomorrow?\n')
                return types.SimpleNamespace(returncode=0)
            args = ['messages_sync.py', '--config', str(config), '--state', str(root / 'state.json'), '--receipts', str(root / 'receipts.json'), '--unmatched-report', str(root / 'unmatched.json')]
            with patch('sys.argv', args), patch.object(MODULE, 'api_request', side_effect=api), patch.object(MODULE.subprocess, 'run', side_effect=export):
                MODULE.main()
                MODULE.main()
            self.assertEqual(len(requests), 1)
            self.assertTrue(requests[0]['isGroup'])
            self.assertNotIn('contactId', requests[0])
            self.assertEqual(requests[0]['participants'], ['Samantha Example'])
            receipts = json.loads((root / 'receipts.json').read_text())['conversations']
            self.assertEqual(receipts[MODULE.conversation_key('Mike & Samantha')]['outcome'], 'group_pending')
            self.assertEqual(receipts[MODULE.conversation_key('Parents & Coaches')]['outcome'], 'group_no_business_signal')

    def test_overlap_catches_late_arrivals_without_repeating_processed_messages(self):
        since = dt.datetime(2026, 10, 27, 15, tzinfo=dt.timezone.utc)
        old = {"at": since - dt.timedelta(hours=2), "sender": "Greg Booth", "body": "An earlier text"}
        late = {"at": since - dt.timedelta(hours=1), "sender": "Greg Booth", "body": "Would you be interested in some contract work on the strokepages.com project?"}
        receipt = {"seen": [MODULE.message_key(old)], "outcome": "skipped"}
        self.assertEqual(MODULE.select_unseen([old, late], since, receipt), [late])
        self.assertEqual(MODULE.select_unseen([old, late], since, {"seen": [MODULE.message_key(old), MODULE.message_key(late)]}), [])
        self.assertEqual(MODULE.select_unseen([late], since, {"seen": []}), [late])
        self.assertEqual(MODULE.select_unseen([old, late], since, None), [])

    def test_link_preview_text_survives_parsing(self):
        text = 'Oct 26, 2026  12:16:00 PM\nGreg Booth\nGood afternoon sir. Would you be interested in some contract work on the strokepages.com project?\nhttps://strokepages.com\n\n'
        messages = MODULE.parse_export(text)
        self.assertIn('interested in some contract work', messages[0]['body'])
        self.assertTrue(MODULE.has_business_context(messages))

    def test_verified_alias_matches_without_guessing_nicknames(self):
        samantha = {"id": "863", "name": "Samantha Rabinowicz Booth", "smsAliases": ["Sammy Booth"]}
        self.assertEqual(MODULE.match_contact(["Sammy Booth"], MODULE.build_indexes([samantha]))["id"], "863")
        self.assertIsNone(MODULE.match_contact(["Sam Booth"], MODULE.build_indexes([samantha])))
        other = {"id": "999", "name": "Sammy Booth"}
        self.assertIsNone(MODULE.match_contact(["Sammy Booth"], MODULE.build_indexes([samantha, other])))
        self.assertIsNone(MODULE.match_contact(["Sammy Booth", "Other Person"], MODULE.build_indexes([samantha, {"id": "998", "name": "Other Person"}])))

    def test_introduction_exchange_qualifies_for_review(self):
        for body in [
            "Yup happy to chat. You can connect us",
            "Would you possibly be able to connect me? I have feedback and add-on ideas for their product manager.",
            "She is a change management expert working with school districts / education groups.",
            "Happy to make an intro.",
            "Could you introduce her to the principal?",
        ]:
            self.assertTrue(MODULE.has_business_context([{"body": body}]), body)

    def test_business_gate_keeps_work_discussion(self):
        for body in [
            "I suggest waiting for BC Cloud before investing in the connector.",
            "The invoice is ready.",
            "Can I introduce you to a business owner?",
        ]:
            self.assertTrue(MODULE.has_business_context([{"body": body}]), body)

    def test_business_gate_skips_personal_logistics_and_keyword_noise(self):
        for body in [
            "Can you pick up the kids at three?",
            "Tuesday at noon works, see you then!",
            "Sounds good!", "Let's go to the fair.",
            'Liked “The client proposal is ready”',
            "Look at this https://example.com/client/proposal",
        ]:
            self.assertFalse(MODULE.has_business_context([{"body": body}]), body)
        self.assertFalse(MODULE.has_business_context([{"sender": "AI Consulting", "body": "Thanks!"}]))

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
        self.assertTrue(MODULE.is_likely_group("Mike & Samantha", ["Samantha Pessiki"], indexes))
        self.assertTrue(MODULE.is_likely_group("Named group", ["Mike", "Samantha"], indexes))
        self.assertFalse(MODULE.is_likely_group("Jennifer Greene", ["Jennifer Greene"], indexes))

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
