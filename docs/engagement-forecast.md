# Engagement Forecast

Engagements opens in Cash flow view; List retains the previous overview. The default Active opportunities filter includes Pursuit, Discovery, Proposal, Active Client and On Hold, excluding closed/deleted/archived records. On Hold remains visible as red/at-risk work. All opportunities and individual stage filters can include closed records for reference. Group headers never contribute fees; child pursuits count independently, avoiding parent/child double-counting.

Client and Opportunity are the first two columns, followed by monthly Gantt cells and an Unscheduled column. The first month defaults to the current New York month. Choose the first month, move three months backward/forward, or show 6/12/18 months. Desktop client/opportunity labels stay frozen while scrolling; on narrow screens only the client label stays frozen. Bars use exact start/end days within each month; amounts use receipt dates independently. Missing run dates produce no invented bar. Receipts outside the visible months are explicitly listed in the Unscheduled column as Outside view, not moved into a different month. Click Edit plan (or a month's receipt cell) to edit dates, stage, confidence, fees and payment installments.

Colors default by stage: Active Client = green/confirmed, Pursuit/Discovery/Proposal = yellow/tentative, On Hold = red/at risk. `forecastConfidence` can override that mapping with `confirmed`, `proposal`, or `at_risk`, without changing engagement stage. The footer separates monthly confirmed, proposed and at-risk receipts instead of treating them as equally certain.

## Fields and persistence

Each engagement adds:
- `projectedStartDate` and `projectedEndDate`: date-only `YYYY-MM-DD` strings; blank means unknown.
- `expectedValue`: nonnegative USD fee estimate, or null when unknown. Zero is valid.
- `payments`: array of `{id, label, amount, expectedDate, status}`. Amount is nullable; status is `expected` or `received`.
- `forecastConfidence`: blank to follow the stage, or an explicit `confirmed` / `proposal` / `at_risk` override.

Existing status, organization, next milestone/date, commercial text, notes, people links and group relationships are unchanged. Commercial free text is not parsed into financial figures. Legacy records receive empty/unknown defaults; no database migration or live-data seeding is required. These fields travel through the existing local/cloud JSON engagement record and versioned save path. Editing the table or engagement detail saves the same record. Contacts are not changed.

## Totals

Expected fees use the explicit estimate; absent an estimate, the known payment amounts provide a subtotal. Unknown amounts are not treated as a known zero. Expected receipts exclude payments marked received. Known fees not allocated to the payment plan become an Unscheduled balance. Monthly buckets use expected receipt dates, not the project run dates; undated payments and unallocated balances remain Unscheduled. Fees and receipts are alternative views of the same money and are not added together. All figures are projections, not probability-weighted or guaranteed revenue.

A complete payment plan that differs from explicit fees displays a mismatch. Negative or invalid numeric entries and end dates earlier than start dates are rejected. No recurring payments are invented; add one row per expected installment.

## Recap and export

Copy recap copies the currently displayed cash-flow timeline as both an inline-styled HTML table (for normal Gmail paste) and readable plain text. The HTML retains monthly run shading, confidence colors, receipt amounts and category totals. Nothing opens, drafts or sends an email. Clipboard support requires a secure origin or localhost; the interface reports failures and offers CSV as an alternative. CSV includes Client, Opportunity, confidence, run dates, month columns, unscheduled balance and outside-view receipts, plus confidence-separated monthly totals. CSV cannot retain background colors; use rich copy for the colored timeline. CSV cells are quoted, UTF-8 BOM is supplied for spreadsheet compatibility, and formula-like text is neutralized. Exports contain private business information; share deliberately.

Verification uses fictional records only; `outputs/engagement-forecast-preview.html` is a local QA fixture, not a production seed. Tests cover legacy defaults, filters, integer-cent rollups, received/unscheduled treatment, validation, local saves, escaping and exports.
