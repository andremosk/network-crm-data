# Engagement Forecast

Engagements opens in Forecast view; List retains the previous overview. The default Active opportunities filter includes Pursuit, Discovery, Proposal and Active Client, excluding closed/held/deleted/archived records. All opportunities and individual stage filters can include held/closed records for reference. Group headers never contribute fees; child pursuits count independently, avoiding parent/child double-counting.

## Fields and persistence

Each engagement adds:
- `projectedStartDate` and `projectedEndDate`: date-only `YYYY-MM-DD` strings; blank means unknown.
- `expectedValue`: nonnegative USD fee estimate, or null when unknown. Zero is valid.
- `payments`: array of `{id, label, amount, expectedDate, status}`. Amount is nullable; status is `expected` or `received`.

Existing status, organization, next milestone/date, commercial text, notes, people links and group relationships are unchanged. Commercial free text is not parsed into financial figures. Legacy records receive empty/unknown defaults; no database migration or live-data seeding is required. These fields travel through the existing local/cloud JSON engagement record and versioned save path. Editing the table or engagement detail saves the same record. Contacts are not changed.

## Totals

Expected fees use the explicit estimate; absent an estimate, the known payment amounts provide a subtotal. Unknown amounts are not treated as a known zero. Expected receipts exclude payments marked received. Known fees not allocated to the payment plan become an Unscheduled balance. Monthly buckets use expected receipt dates, not the project run dates; undated payments and unallocated balances remain Unscheduled. Fees and receipts are alternative views of the same money and are not added together. All figures are projections, not probability-weighted or guaranteed revenue.

A complete payment plan that differs from explicit fees displays a mismatch. Negative or invalid numeric entries and end dates earlier than start dates are rejected. No recurring payments are invented; add one row per expected installment.

## Recap and export

Copy recap copies the currently displayed opportunities as both an inline-styled HTML table (for normal Gmail paste) and readable plain text. Nothing opens, drafts or sends an email. Clipboard support requires a secure origin or localhost; the interface reports failures and offers CSV as an alternative. CSV download includes organization, stage, projected dates, fees, the payment schedule and existing milestone/date. CSV cells are quoted, UTF-8 BOM is supplied for spreadsheet compatibility, and formula-like text is neutralized. Exports contain private business information; share deliberately.

Verification uses fictional records only; `outputs/engagement-forecast-preview.html` is a local QA fixture, not a production seed. Tests cover legacy defaults, filters, integer-cent rollups, received/unscheduled treatment, validation, local saves, escaping and exports.
