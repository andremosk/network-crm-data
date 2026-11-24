# Profile Update Review

Communication Review now proposes profile changes for existing contacts alongside
independently approved contact notes and engagement actions. The first version
uses the current Gmail scanner and its existing AI assessment; it adds no polling
job, subscription, bulk archive rescan, or external enrichment provider. SMS and
Granola profile extraction, company-level research and shared company records
are not part of this version.

## Evidence and Matching

- Company/title changes require an exact source quote containing the proposed
  value in the author's new email contribution or current signature.
- Quoted replies and forwarded material are excluded from profile extraction.
  Signatures remain ineligible as evidence for interaction notes or pursuits.
- Only the matched sender can get a profile proposal, not copied recipients or
  an unknown person. Current matching uses unique primary/alias email, then the
  existing unique-name fallback, visibly labeled for review.
- A newly observed sender address may be proposed from its actual From header,
  even if there is no substantive interaction note. Domains do not imply employers.
- Stable contact IDs remain unchanged. Approved former/alternate addresses are
  recognized by Gmail and the communication/contact-update ingestion APIs.

## Approval

Each field has a checkbox, editable proposed value and saved comparison value.
Role destination is primary or additional; address destination is primary or
additional. A different employer defaults to an additional role, and an address
defaults to additional when a primary email already exists. Save Edit and Ignore
never modify contacts. Apply requires an explicit nonempty field selection.

Primary changes keep previous values in history; changing primary email keeps
the old address as an alias. Additional roles/addresses leave primary fields
alone. Notes, statuses, dates, ratings and engagement records are untouched.
Source observation and approval timestamps, original email ID, quote and whether
the reviewer edited the value are stored with approved fields. These details,
additional roles, alternate emails and history are readable on contact profiles.

Comparison values are server-owned and cannot be rebased by a browser request.
Changed saved fields cause a conflict rather than overwriting a manual edit.
A newer confirmed field observation also prevents an older primary change.
Conflicting suggestions can be ignored and the profile edited directly; this v1
does not silently rebase stale suggestions. Address collisions with another
active contact block approval. Approval is version-guarded and atomic with the
proposal's pending-to-applied transition.

## Defaults and Dedupe

Existing contact JSON needs no rewrite: missing `emailAliases`, `additionalRoles`,
`profileHistory` and `profileFieldSources` are treated as empty. Proposal type
remains `update_contact`, with an optional `profileUpdate` object. Existing notes,
SMS, engagement and legacy missing-email proposals retain their previous flow.

`ensureSchema` adds the partial unique index `crm_profile_pending_values_idx` to
prevent identical pending profile values for a contact across different emails.
Already approved aliases/secondary roles are not proposed from each signature.
An ignored exact values/comparison combination stays ignored on later messages;
a genuinely different candidate or changed saved baseline can be reviewed again.
Per-message receipts and stable child source IDs continue to prevent duplicates.
The screening version is deliberately unchanged, so deployment does not restart
the historical backfill that was recently repaired.

## Verification

- `node --test`: synthetic extraction, authorization/approval boundaries, UI,
  editable/selective fields, old behaviors and conflict protection.
- `CRM_SQL_INTEGRATION=1 node --env-file=.env.local --test test/profile-updates.test.js`:
  actual SQL using only transaction-local temporary tables, including dedupe,
  alias matching, address collisions, duplicate approval and unchanged notes/ratings.
- `node scripts/evaluate_profile_review.js`: optional real-provider test of four
  fictional messages. It never reads Gmail or CRM records or creates proposals.
