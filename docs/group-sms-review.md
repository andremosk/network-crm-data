# Participant-aware Group SMS Review

Group messages now produce independent, reviewable participant updates rather
than one generic summary that can accidentally be assigned to any group member.
The review UI groups these drafts under a participant roster, shows each phone
number/address and suggested contact, and exposes the actual source messages for
each draft. Each update can be edited, approved or dismissed independently and
routed to Contacts or an existing Engagement. Active engagement suggestions use
the matched participant, not the entire group.

## Sender Identity

The existing local collector still uses imessage-exporter. For groups, a second
attachment-free export disables Contacts name substitution. Timestamp and exact
message-body matches connect the displayed name to the raw sender phone/address
only when there is exactly one candidate identity. A collision stays unresolved.
Thread-title numbers and observed senders form the roster; silent or unlisted
members are never invented. If raw handles are unavailable, named senders remain
separate from unpaired numbers. The UI can still show a name suggestion, but
cannot pretend to know which number it belongs to.

Server matching prefers a previously confirmed participant mapping, then unique
phone/email (including approved email aliases), then a unique full name/SMS alias.
Ambiguous identities remain unmatched. Save match can match even a silent listed
number without adding a note. Approving a contact note can remember that raw
number/address via an explicit checkbox. Mappings are private and do not silently
overwrite the contact's primary mobile number or email field.

## Attribution and Filtering

One AI call returns structured updates for all meaningful speakers. A draft must
cite exact source text and at least one new message by its own participant.
Earlier messages may explain a short acceptance or reply, but cannot create a
fresh update by themselves. Silent participants cannot inherit another person's
commitment. Tapbacks, pure laughs and emoji reactions do not establish agreement.
Explicit incoming work offers retain the existing deterministic safety fallback.
Routine AI observations, family/sports logistics and explanations of why a chat
is irrelevant are not CRM notes. No contact or engagement notes are applied by
ingestion; approval is still required.

## Replay and Dedupe

Private tables `crm_text_group_receipts` and `crm_sms_participant_matches` are
created by ensureSchema. Message fingerprints include timestamp, sender identity
and body, so edits are eligible as new events. Receipts and all participant drafts
commit together. Overlapping collections may reuse old messages as context but
cannot requeue them as new activity. A source-only index supports receipt lookup.

On the first updated collector run, groups in the existing 72-hour overlap are
reanalyzed once. Covered legacy *pending* aggregate drafts are superseded only
after successful analysis. Approved/dismissed legacy windows are not resurfaced,
and no existing CRM records or notes are rewritten. Older drafts whose source
messages are not available cannot be reliably split retroactively.

Raw exports remain in temporary local folders and are removed after collection.
Only cited messages are retained with pending participant proposals; receipts
hold fingerprints, not message bodies. Normal one-to-one behavior and the
installed schedule are preserved. Review API access requires a CRM session;
ingestion retains the existing protected automation token.

The model cites short message references which the server maps back to stable
fingerprints. A failed assessment gets one stronger-model attempt. If it still
fails or the request times out, the collector retains the original group payload
in its private, mode-600 `messages-sync-group-retries.json` file and continues with
unrelated conversations. Up to two due payloads retry per scheduled run with a
15-minute, one-hour, six-hour, then daily backoff. Payloads are removed on success
or confirmed dedupe; they are never silently discarded as irrelevant. Deferred
payloads retain their source text locally until this succeeds. No extra polling
schedule is added.

## Checks

- `node --test` and `python3 -m unittest discover -s test -p 'test_messages_sync.py'`
- `CRM_SQL_INTEGRATION=1 node --env-file=.env.local --test test/group-sms-attribution.test.js`
  uses temporary tables only for atomic receipt, approval, remembered-match,
  duplicate and non-target-contact preservation checks.
- `node scripts/evaluate_group_sms.js` tests three fictional exchanges against
  the real provider, without reading or writing real CRM/SMS data.
