# Referrer phase one

Open **Referrer** from Network.crm, type a referral ask in plain language, and
press Enter. Results are ranked separately as direct matches or potential
connectors, with up to ten distinct contacts. Expand **Why this match?** to see
what wording or role contributed to the ranking and what to verify. Click a name or evidence excerpt
to open the contact; the excerpt jumps to its note when found in the current
dataset.

The authenticated, read-only search uses saved cloud contact records. Local
candidate selection combines topic/term overlap with role and relationship
signals and takes up to 18 candidates from each track. The existing Anthropic
configuration reranks the shortlist using only contact names, company, title,
and up to two relevant snippets per candidate. Dedicated email and phone fields
and full note histories are not sent. Search requests do not run as you type.

Referrer infers industries from current employer names at search time, using
known employers and recognizable name patterns. Existing industry fields take
precedence; unrecognized employers stay unknown. No contact records are changed.
An explicit industry or school-district ask restricts direct matches to that scope.
Outside connectors need a note that attributes relevant access to the contact;
an unrelated introduction is not evidence. Scoped searches may return fewer than
ten people rather than filling the list with off-scope results.

Relative scores are not calibrated probabilities. Strong results require
model-assessed explicit evidence and a verbatim snippet verified by the server.
Role-only or weak matches can still appear, labeled as such. Without the model,
the CRM-based shortlist still returns best-effort leads. Archived, deleted and
do-not-contact contacts are excluded. No database migration, web research,
bulk external enrichment or automatic outreach is included.
