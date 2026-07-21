# Gmail draft integration

Network.crm can create rich HTML drafts in Andre's Gmail account. Draft creation:

- runs only after Network.crm session authentication;
- allows only `andre.moskowitz@gmail.com` and `andre@andremosk.com`;
- validates the selected address against Gmail's accepted **Send mail as** identities;
- uses the signature configured for that Gmail identity;
- creates a draft but never sends mail automatically.

## Google authorization

Create an OAuth 2.0 Web application in the Google Cloud project with the Gmail API enabled. Authorize the mailbox with offline access using these scopes:

- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.settings.basic`

Store the resulting values as sensitive Vercel Production environment variables:

- `GOOGLE_GMAIL_CLIENT_ID`
- `GOOGLE_GMAIL_CLIENT_SECRET`
- `GOOGLE_GMAIL_REFRESH_TOKEN`

Optional: set `GOOGLE_GMAIL_ACCOUNT_INDEX` to the number Gmail uses in `/mail/u/0/`. It defaults to `0`.

Redeploy after adding or changing environment variables.
