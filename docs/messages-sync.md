# Messages Summary Sync

Network.crm can create reviewable CRM summaries from recent one-to-one conversations in Apple Messages without changing your phone number or sending messages.

## Privacy model

- Apple Messages remains the communication system.
- The Mac helper reads a temporary, read-only export of recent conversations.
- Only one-to-one threads that conservatively match a Network.crm contact are considered.
- Group conversations are ignored.
- The raw transcript is sent to the private Network.crm automation endpoint for summarization and is not stored in Neon.
- Neon stores only the proposed summary, timestamps, message count, contact ID, and a duplicate-prevention fingerprint.
- Nothing sends, edits, or deletes a message.

The helper uses the pinned `imessage-exporter` 4.2.0 release because it handles current iMessage, SMS, MMS, and RCS message formats, including Apple's encoded message bodies.

## One-time setup

1. Make sure Messages on the Mac shows the same conversations as the iPhone.
2. From this repository, run `zsh scripts/setup_messages_sync.sh`.
3. Paste the same Network.crm access key used to sign into the web app.
4. Open **System Settings > Privacy & Security > Full Disk Access**.
5. Add and enable `~/Library/Application Support/Network CRM/bin/imessage-exporter`.
6. Run `/usr/bin/python3 scripts/messages_sync.py --dry-run` from the repository.
7. Run `/usr/bin/python3 scripts/messages_sync.py` to create the first review drafts.

The first run considers the previous 12 hours. Later runs continue from the last successful checkpoint. The installed schedule runs at noon and 6 PM local time.

## Review flow

Open a matched contact in Network.crm. Pending summaries appear above Notes. Edit the wording if needed, then choose **Add to Notes** or **Dismiss**. Approved summaries become ordinary dated notes and update Last Contact.

## Matching

The parser asks the local macOS Contacts database to resolve phone numbers and email addresses to names. The helper then requires one unambiguous match against Network.crm name, email, or mobile phone. Add a mobile number to a CRM profile when a conversation remains unmatched.

The sync log reports only counts and errors; it never prints message contents. Logs and the private checkpoint live in `~/Library/Application Support/Network CRM/`.
