# Communication Review

Network.crm's Communication Review combines the existing SMS review queue with reviewable outbound-email proposals. Nothing in this feature sends email, creates a contact, or edits a contact automatically.

## Email ingestion endpoint

`POST /api/automation/communication-proposals`

Authenticate with `Authorization: Bearer ${NETWORK_CRM_AUTOMATION_TOKEN}` (the Messages-only token is also accepted). Send one normalized outbound message with a stable `sourceMessageId`, `sentAt`, one recipient, `subject`, and `bodyText`. Optional recipient fields are `name`, `company`, and `position`.

The endpoint:

- accepts only one-to-one sent relationship mail;
- excludes group mail, receipts, newsletters, automated messages, and low-signal logistics;
- matches contacts by normalized recipient email;
- creates a pending `Create contact` or `Update contact` proposal;
- deduplicates by the source message ID/hash;
- never changes CRM records itself.

The initial deterministic rules recognize reconnecting, connecting, setting up time, calendar/Calendly, coffee, catching up, and following up. Suggested follow-up dates default to one week after the sent message. Applying an update never replaces an existing later follow-up date.

## Gmail connection still required

This repository does **not** currently poll Gmail. To automate ingestion, a separate private connector still needs to authenticate to Gmail (OAuth), read only newly sent one-to-one messages on a schedule or through Gmail watch/push, normalize each message, and call the endpoint above. The stable Gmail message ID must be passed as `sourceMessageId`. Email content stays within this deterministic pipeline and is not sent to an LLM.
