# Communication Review

Network.crm's Communication Review combines the existing SMS review queue with reviewable email proposals. Nothing in this feature sends email, creates a contact, or edits a contact automatically.

## Email ingestion endpoint

`POST /api/automation/communication-proposals`

Authenticate with `Authorization: Bearer ${NETWORK_CRM_AUTOMATION_TOKEN}` (the Messages-only token is also accepted). Send one normalized email with a stable `sourceMessageId`, `subject`, and `bodyText`.

For outbound mail, provide `sentAt` and one recipient. For inbound relationship mail, provide `direction: "inbound"`, `receivedAt`, one sender, and one CRM-mailbox recipient.

The endpoint:

- accepts one-to-one sent relationship mail, plus personal inbound mail from an existing CRM contact;
- accepts only one-to-one inbound email by default; copied-recipient support is intentionally disabled until explicitly configured;
- excludes general group mail, receipts, newsletters, automated messages, and low-signal logistics;
- matches contacts by normalized counterparty email;
- creates a pending `Create contact` or `Update contact` proposal;
- deduplicates by the source message ID/hash;
- never changes CRM records itself.

The initial deterministic rules recognize reconnecting, connecting, setting up time, calendar/Calendly, coffee, catching up, and following up. Personal inbound mail must also include relationship context, such as a personal check-in or “you came to mind.” Inbound messages create note-only proposals; sent-mail follow-ups default to one week after the message. Applying an update never replaces an existing later follow-up date.

## Gmail review sync

`POST /api/crm/gmail-review-sync` lets an authenticated CRM session check Gmail on demand. `POST /api/automation/gmail-review-sync` exposes the same read-only ingestion job for a private scheduler, authenticated with the Network CRM automation bearer token.

`POST /api/crm/gmail-email-enrichment` scans the next batch of up to 100 direct Gmail conversations for contacts with no saved email address. It only proposes an email when the Gmail display name is a unique full-name match to one such contact. The equivalent private scheduler endpoint is `POST /api/automation/gmail-email-enrichment`. These proposals only save a currently blank email field when approved; they never overwrite an existing email or create a contact. Run the enrichment action again to process the next batch until it reports that the archive scan is complete.

The server needs these Vercel environment variables: `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, `GOOGLE_GMAIL_REFRESH_TOKEN`, and `NETWORK_CRM_GMAIL_MAILBOX`. The refresh token must have Gmail read access in addition to the existing draft-creation access. Gmail is read server-side; messages are evaluated by deterministic rules and are never sent to an LLM. The sync starts with a 14-day lookback, stores a per-mailbox checkpoint, and deduplicates by Gmail message ID.

No cron schedule is configured yet. The protected automation endpoint is ready for either a Vercel Cron job or Gmail watch/push after the Gmail read authorization is in place.
