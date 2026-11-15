# Referrer phase one

Open **Referrer** from Network.crm, type a referral ask in plain language, and
press Enter. Results are ranked separately as direct matches or potential
connectors, with up to ten distinct contacts. Click a name or evidence excerpt
to open the contact; the excerpt jumps to its note when found in the current
dataset.

The authenticated, read-only search uses saved cloud contact records. Local
candidate selection combines topic/term overlap with role and relationship
signals and takes up to 18 candidates from each track. The existing Anthropic
configuration reranks the shortlist using only contact names, company, title,
and up to two relevant snippets per candidate. Dedicated email and phone fields
and full note histories are not sent. Search requests do not run as you type.

Relative scores are not calibrated probabilities. Strong results require
model-assessed explicit evidence and a verbatim snippet verified by the server.
Role-only or weak matches can still appear, labeled as such. Without the model,
the CRM-based shortlist still returns best-effort leads. Archived, deleted and
do-not-contact contacts are excluded. No database migration, web research,
bulk enrichment or automatic outreach is included.
