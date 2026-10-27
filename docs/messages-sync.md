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
3. Paste the dedicated Messages sync key. The main Network.crm key remains supported as a fallback.
4. Open **System Settings > Privacy & Security > Full Disk Access**.
5. Add and enable `~/Library/Application Support/Network CRM/bin/imessage-exporter`.
6. Run `/usr/bin/python3 ~/Library/Application\ Support/Network\ CRM/messages_sync.py --dry-run`.
7. Run `/usr/bin/python3 ~/Library/Application\ Support/Network\ CRM/messages_sync.py` to create the first review drafts.

The first run considers the previous 12 hours. Later runs scan an overlapping 72-hour window to catch messages that arrive on the Mac late. A private per-conversation receipt file stores message hashes (not bodies), contact ID, timestamps, and the last outcome (`pending`, `skipped`, `duplicate`, or a local exclusion). Already processed messages are not re-summarized, including skipped chatter. The first run after upgrading establishes a baseline without replaying old conversations. Receipt history is retained for seven days; messages arriving more than 72 hours late still need manual recovery. The installed schedule runs at 11 AM, 3 PM, and 9:15 PM local time.

## Review flow

Open a matched contact in Network.crm. Pending summaries appear above Notes. Edit the wording if needed, then choose **Add to Notes** or **Dismiss**. Approved summaries become ordinary dated notes and update Last Contact.

## Matching

Verified alternate names can be stored on a contact as an `smsAliases` array. The private SMS directory exposes these to the Mac helper for exact alias matching. Nicknames are never guessed; conflicting names/aliases remain unmatched. This supports a verified Mac contact name such as Sammy Booth while preserving the CRM display name Samantha Rabinowicz Booth. The relevance gate also recognizes explicit introductions, “connect us,” change management, and school-district discussions.

Unfamiliar one-to-one senders enter the matching queue only when a local check finds explicit business/work context in the new message bodies. Names, URL text, reactions, and scheduling alone do not qualify. Their transcript stays on the Mac. This keyword check favors a quieter queue and can miss implicit business discussion; it does not permanently ignore the sender, so later substantive texts can still qualify.

Matched contacts receive a stricter AI relevance screen in the existing summarization call. Routine personal texting and call logistics should return `SKIP`; substantive work discussion and exceptional durable relationship news may produce a note for approval. Engagement routing continues to suggest related client work. Existing pending items are retained for review; this change governs future imports. The helper must be copied to its installed location, and server prompt changes require deployment.

The parser asks the local macOS Contacts database to resolve phone numbers and email addresses to names. The helper then requires one unambiguous match against Network.crm name, email, or mobile phone. Add a mobile number to a CRM profile when a conversation remains unmatched.

Explicit paid/contract-work offers receive a factual quoted fallback proposal if the summarizer incorrectly returns `SKIP`; this does not approve a note or imply an accepted contract. Routine Little League/team coaching and parent coordination are explicitly excluded from business commitments in the relevance prompt. Genuine durable personal updates remain eligible. Empty provider responses are errors to retry, not relevance skips.

The sync log reports counts, hashed conversation identifiers, contact IDs, timestamps, and per-thread outcomes; it never prints message contents or names. Logs, the private `messages-sync-receipts.json`, and checkpoint live in `~/Library/Application Support/Network CRM/`. Receipts distinguish AI relevance skips from duplicates and local filters, but do not claim to record the model's internal reasoning.

Unmatched one-to-one conversations are listed in `messages-sync-unmatched.json` in that same private folder. The report contains only the participant label and latest message date, never message content. Entries remain until they match a CRM contact or are more than 30 days old.
