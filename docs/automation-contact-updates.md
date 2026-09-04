# Automation contact updates

`POST /api/automation/contact-updates` is a narrow, write-only companion to the
follow-up queue. It is for trusted automations such as Andre's Chief of Staff,
not a browser or public CRM API.

## Authentication

Send `Authorization: Bearer ${NETWORK_CRM_AUTOMATION_TOKEN}`. Requests without a
valid token receive `401`. The token is never accepted in query parameters.

## Requests

Every request needs a unique, stable `request_id`. Repeating the exact same
request returns the original result without adding a duplicate note or contact.
Reusing a `request_id` for different content returns `409`.

Lookup only (no writes):

```json
{
  "request_id": "cos-2026-09-03-nicole-lookup",
  "action": "lookup",
  "contact": { "email": "nicole@example.com" }
}
```

Resolve an existing contact, add one concise factual note, and schedule a
follow-up. A later existing follow-up date is retained.

```json
{
  "request_id": "cos-2026-09-03-nicole-note-1",
  "contact": { "name": "Nicole Heid-Arce", "email": "nicole@example.com" },
  "note": "Discussed payroll and AR reconciliation opportunities.",
  "follow_up": { "status": "follow_up", "date": "2026-10-03" }
}
```

Create only when no unambiguous active CRM contact matches, then add the note and
follow-up in the same request. `tier` is relationship tier and defaults to `3`.

```json
{
  "request_id": "cos-2026-09-03-new-contact-1",
  "contact": { "email": "person@example.com", "name": "Pat Example" },
  "create_if_missing": true,
  "create": {
    "name": "Pat Example",
    "email": "person@example.com",
    "company": "Example Co.",
    "position": "COO",
    "tier": 3
  },
  "note": "Met at a local business event; discussed an AI workflow review.",
  "follow_up": { "status": "follow_up", "date": "2026-09-10" }
}
```

## Limits and safeguards

- Supports only lookup, minimal contact creation, note append, and `follow_up` status/date.
- Does not support delete, bulk changes, arbitrary contact-field edits, or UI access.
- A selector may be numeric `contact.id`, `contact.name`, and/or `contact.email`.
  Ambiguous or disagreeing selectors return `409` with safe candidate identifiers.
- Dates must be `YYYY-MM-DD`; note length is capped at 2,400 characters.
- Current later follow-up dates win over an earlier proposed date.
- Notes are stored in the existing contact notes field; `note_id` is therefore
  always `null` in the response.

## Engagement creation

`POST /api/automation/engagements` uses the same bearer token and requires a
stable `request_id`. It can only create an engagement; it cannot list, edit, or
delete engagements.

```json
{
  "request_id": "cos-2026-09-04-seo-training-lead-1",
  "engagement": {
    "title": "SEO / Paid Media AI Training Lead",
    "organization": "Unnamed SEO / paid media business",
    "status": "pursuit",
    "current_state": "Melissa Murphy shared a warm lead for a half-day AI training session. Andre expressed interest and gave Melissa his website to share.",
    "opportunity": "Half-day practical AI training session; approximate budget is $5,000.",
    "next_milestone": "Melissa shares Andre's website with the prospect and facilitates an introduction.",
    "linked_contact_ids": []
  }
}
```

Accepted statuses: `pursuit`, `discovery`, `proposal`, `active_client`,
`on_hold`, and `closed`. Optional fields are `commercial`,
`next_milestone_date` (`YYYY-MM-DD`), and up to 50 `linked_contact_ids`. Every
linked contact ID must be an active CRM contact. A repeat of the same request
returns the original engagement without creating another one.
