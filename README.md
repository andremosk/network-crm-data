# Network.crm

Network.crm is a private, local-first contact CRM with cloud persistence. Contacts remain the source of truth for people and follow-ups. Applications and Engagements are separate record types with their own views and cloud-sync lanes.

## Engagements

The Engagements view tracks prospective pursuits and active client work without turning Network.crm into a project-management tool. Each record has a current state, opportunity/problem, optional commercial hypothesis, next milestone and date, linked CRM people, working-document links, and a dated notes timeline.

Existing cloud datasets do not require a manual data conversion. Missing `engagements` data defaults to an empty list, and older engagement field shapes are normalized when loaded. Linked contacts are references only; editing an engagement does not edit a contact record.

See [docs/engagement-examples.md](docs/engagement-examples.md) for copy-ready examples to create after deployment. The repository does not seed these into production.

## Verification

```bash
npm test
```
