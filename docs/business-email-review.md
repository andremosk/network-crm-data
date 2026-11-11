# Business-aware email review

The scheduled Gmail helper and **Check email** use the same protected server
pipeline. Incoming human email is assessed for relevance to Andre's business:
referrals, introductions, opportunities, collaborators, professional connections,
and client work updates. Routine sports, kids' activities, family logistics and
social chatter are excluded. Specific durable relationship openers from existing
contacts (such as vacation news) remain an intentional exception.

## Screening and privacy

- No `List-Id`, bulk/list precedence, no-reply or ordinary automated mail. Personal
  calendar comments can pass their wrapper. Multiple recipients do not disqualify
  a human message.
- Received mail is searched, including archived mail, not only the Inbox. Spam,
  Trash, Drafts and Andre's sent mail are excluded. The separate legacy normalized
  outbound ingestion endpoint retains its existing behavior.
- The primary mailbox is `NETWORK_CRM_GMAIL_MAILBOX`. Optional comma-separated
  `NETWORK_CRM_GMAIL_ALIASES` adds other identities. For Andre's established Gmail
  and andremosk.com accounts both known addresses are recognized automatically.
- The new contribution is extracted before quoted history, forwarded marketing
  and signature delimiters; at most 12,000 characters and 24 external participants
  are considered per email. Attachments are not read.
- Claude Haiku, using the existing server Anthropic key, performs one short
  relevance/routing assessment per unseen eligible message. It sees the email,
  participant matches and relevant engagement titles/organizations, not contact
  notes or the entire CRM. No new AI credentials are required.
- Exact participant email or unique full-name matches are suggested and name-only
  matches are labeled for verification. A second address never overwrites a saved one.
  Ambiguous names are not automatically linked. Facts need a supporting exact
  quote from the email. No financial estimates or active-client status are inferred.

## Review and approval

One email can generate several proposals grouped by source in Communication
Review. Each has independent Edit, Ignore and Apply/Create actions. Nothing
creates or edits live contacts or engagements during ingestion or Save Edit.

- Referrers get a concise credit note and a suggested thank-you/outcome reminder
  one calendar month after the introduction (New York date, month ends clamped).
- Reminders retain their text/date in `communicationReminders`, visible on the
  contact profile. They do not replace an existing scheduled follow-up. If no
  follow-up exists, the proposed reminder can establish one. Explicit manual
  status/date changes still work as before. Reminder details are also in the note.
- Concrete prospective work gets a new Pursuit with opportunity, current state,
  milestone, source link, initial note and known linked contacts. The reviewer
  can choose an existing engagement instead. Prospect contacts are separate,
  optional approval proposals; copying someone is not permission to create them.
- Existing client-work email goes to an Engagement timeline. Reviewed state,
  problem and milestone fields can update; commercial estimates, stage, cash
  flow, linked people and unrelated fields are preserved on an existing record.
- A conflicting same-organization pursuit creation returns a conflict instead
  of creating another silently. Choose an existing engagement and retry.

Receipts and all child proposals for a message are inserted atomically. Each
action has a stable source key. Approval atomically claims only that pending
proposal and writes only its chosen destination. Duplicate/racing approvals
cannot append activity twice. Previously queued/applied/ignored legacy messages
are not replayed; existing SMS review and routing remain in place.

## Bounded rollout and compute

Schema additions are backward-compatible: review metadata, receipt table,
engagement proposal types, and a screening-version checkpoint. On the first run
of version 2 the scanner rechecks only the configured initial window (14 days by
default, maximum 60), then returns to incremental scanning. Checkpoints paginate
a fixed time window. The existing batch size and Mac schedule are unchanged.
Excluded and proposed messages are cached; AI/provider failures are not cached
as exclusions and do not advance the successful checkpoint. A 40-second soft
budget stops starting new work; a provider call has a 20-second timeout. Completed
receipts survive retries. The one-time rescan can take several scheduled batches.

Local code changes do not activate the rollout until deployed. No changes to
contacts, engagements, tokens or the installed schedule are needed for rollout.

## Verification

`node --test test/*.test.js` covers routing, grounding, dedupe, approval, UI,
reminders and old behavior. `CRM_SQL_INTEGRATION=1` with a privately supplied
`DATABASE_URL` also checks actual Postgres approval SQL in session-local temporary
tables dropped on commit; it never edits public CRM records.

`node scripts/evaluate_business_email_review.js` is an opt-in provider evaluation
using six fictional messages through the existing production AI endpoint. It
does not read or write CRM data. Normal automated tests make no provider calls.
