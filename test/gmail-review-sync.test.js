const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizedInboundMessage, runGmailEmailEnrichment, runGmailReviewSync } = require("../lib/gmail-review-sync");

function encoded(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function gmailMessage(overrides = {}) {
  return {
    id: "gmail-123",
    internalDate: "1787588520000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Lisa Cassidy <lisa@cassidylab.com>" },
        { name: "To", value: "andre@example.com" },
        { name: "Subject", value: "Complimentary Gartner webinars" }
      ],
      parts: [{ mimeType: "text/plain", body: { data: encoded("Hi Andre, hope the kids are doing well. You came to mind when I saw these AI webinars. Talk again soon.\n\n---------- Forwarded message ----------\nGartner details") } }]
    },
    ...overrides
  };
}

test("normalizes only direct, non-automated inbound Gmail messages", () => {
  const parsed = normalizedInboundMessage(gmailMessage(), "andre@example.com");
  assert.equal(parsed.sender.email, "lisa@cassidylab.com");
  assert.equal(parsed.recipients.length, 1);
  assert.match(parsed.bodyText, /You came to mind/);
  assert.equal(normalizedInboundMessage(gmailMessage({ payload: { ...gmailMessage().payload, headers: [...gmailMessage().payload.headers, { name: "Cc", value: "other@example.com" }] } }), "andre@example.com"), null);
  assert.equal(normalizedInboundMessage(gmailMessage({ payload: { ...gmailMessage().payload, headers: [...gmailMessage().payload.headers, { name: "List-Id", value: "newsletter.example" }] } }), "andre@example.com"), null);
});

test('allows a human calendar comment through the automated wrapper guard, but rejects bulk and no-reply mail', () => {
  const original = gmailMessage();
  const payload = {
    ...original.payload,
    headers: original.payload.headers.filter(h => h.name !== 'Subject').concat([
      { name: 'Subject', value: 'Proposed new time: Lisa / Andre' },
      { name: 'Auto-Submitted', value: 'auto-generated' }
    ]),
    parts: [{ mimeType: 'text/plain', body: { data: encoded('Lisa proposed a new time: Friday "Dave and I are taking a vacation."') } }]
  };
  assert.ok(normalizedInboundMessage({ ...original, payload }, 'andre@example.com'));
  assert.equal(normalizedInboundMessage({ ...original, payload: { ...payload, headers: payload.headers.concat({ name: 'List-Id', value: 'bulk.example' }) } }, 'andre@example.com'), null);
  assert.equal(normalizedInboundMessage({ ...original, payload: { ...payload, headers: payload.headers.map(h => h.name === 'From' ? { ...h, value: 'noreply@example.com' } : h) } }, 'andre@example.com'), null);
});

test("Gmail review sync proposes only a known contact and deduplicates source messages", async () => {
  const stored = new Set();
  const saved = [];
  const result = await runGmailReviewSync({
    sql: {},
    env: { NETWORK_CRM_GMAIL_MAILBOX: "andre@example.com" },
    now: new Date("2026-08-31T15:00:00Z"),
    dependencies: {
      getAccessToken: async () => "access-token",
      loadSyncState: async () => null,
      listMessages: async () => ({ messages: [{ id: "gmail-123" }, { id: "unknown-456" }, { id: "gmail-123" }] }),
      getMessage: async (_token, id) => id === "unknown-456"
        ? gmailMessage({ id, payload: { ...gmailMessage().payload, headers: [{ name: "From", value: "Unknown <unknown@example.com>" }, { name: "To", value: "andre@example.com" }, { name: "Subject", value: "Checking in" }] } })
        : gmailMessage(),
      findContactByEmail: async (_sql, email) => email === "lisa@cassidylab.com" ? { id: "55", name: "Lisa Cassidy" } : null,
      insertProposal: async (_sql, proposal) => {
        if (stored.has(proposal.sourceHash)) return "duplicate";
        stored.add(proposal.sourceHash);
        saved.push(proposal);
        return "created";
      },
      saveSyncState: async () => {}
    }
  });
  assert.deepEqual(result, { scanned: 3, proposed: 1, approximated: 0, duplicates: 1, skipped: 1, has_more: false });
  assert.equal(saved[0].matchedContactId, "55");
  assert.match(saved[0].proposed.note, /Received email from Lisa Cassidy/);
  assert.doesNotMatch(saved[0].proposed.note, /Forwarded message/);
});

test("Gmail review makes a missing-email proposal from a unique full-name approximation", async () => {
  const saved = [];
  const result = await runGmailReviewSync({
    sql: {}, env: { NETWORK_CRM_GMAIL_MAILBOX: "andre@example.com" }, now: new Date("2026-08-31T15:00:00Z"),
    dependencies: {
      getAccessToken: async () => "access-token", loadSyncState: async () => null,
      listMessages: async () => ({ messages: [{ id: "gmail-123" }] }), getMessage: async () => gmailMessage(),
      findContactByEmail: async () => null,
      findUniqueContactByName: async (_sql, name, missing) => name === "Lisa Cassidy" && missing ? { id: "55", name: "Lisa Cassidy", email: "" } : null,
      insertProposal: async (_sql, proposal) => { saved.push(proposal); return "created"; }, saveSyncState: async () => {}
    }
  });
  assert.equal(result.approximated, 1);
  assert.equal(saved[0].matchedContactId, "55");
  assert.equal(saved[0].proposed.email, "lisa@cassidylab.com");
  assert.match(saved[0].evidence, /Suggested unique name match/);
});

test("email enrichment only proposes a blank email for a unique direct-conversation name match", async () => {
  const saved = [];
  const result = await runGmailEmailEnrichment({
    sql: {}, env: { NETWORK_CRM_GMAIL_MAILBOX: "andre@example.com" },
    dependencies: {
      getAccessToken: async () => "access-token", loadEnrichmentState: async () => null,
      listMessages: async () => ({ messages: [{ id: "gmail-123" }], nextPageToken: "next-page" }), getMessage: async () => gmailMessage(),
      findUniqueContactByName: async (_sql, name, missing) => name === "Lisa Cassidy" && missing ? { id: "55", name: "Lisa Cassidy", email: "" } : null,
      hasPendingEmailEnrichment: async () => false,
      insertProposal: async (_sql, proposal) => { saved.push(proposal); return "created"; }, saveEnrichmentState: async () => {}
    }
  });
  assert.equal(result.proposed, 1);
  assert.equal(result.completed, false);
  assert.equal(saved[0].proposalType, "update_contact");
  assert.equal(saved[0].proposed.email, "lisa@cassidylab.com");
  assert.equal(saved[0].proposed.note, "");
});

test("email enrichment does not queue a second pending suggestion for the same contact and email", async () => {
  let inserted = false;
  const result = await runGmailEmailEnrichment({
    sql: {}, env: { NETWORK_CRM_GMAIL_MAILBOX: "andre@example.com" },
    dependencies: {
      getAccessToken: async () => "access-token", loadEnrichmentState: async () => null,
      listMessages: async () => ({ messages: [{ id: "gmail-123" }] }), getMessage: async () => gmailMessage(),
      findUniqueContactByName: async () => ({ id: "55", name: "Lisa Cassidy", email: "" }),
      hasPendingEmailEnrichment: async (_sql, contactId, email) => contactId === "55" && email === "lisa@cassidylab.com",
      insertProposal: async () => { inserted = true; return "created"; }, saveEnrichmentState: async () => {}
    }
  });
  assert.equal(inserted, false);
  assert.equal(result.proposed, 0);
  assert.equal(result.duplicates, 1);
});

function responseRecorder() {
  return { statusCode: 0, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}

test('recent enrichment has its own resumable checkpoint and keeps working after archive completion', async () => {
  let state = null;
  const queries = [];
  let pages = 0;
  const dependencies = {
    getAccessToken: async () => 'token',
    loadEnrichmentState: async () => { throw new Error('must not read archive checkpoint'); },
    loadRecentEnrichmentState: async () => state,
    listMessages: async (_token, page, query) => {
      queries.push(query);
      pages += 1;
      if (pages === 1) return { messages: [], nextPageToken: 'next' };
      if (pages === 2) assert.equal(page, 'next');
      return { messages: [] };
    },
    saveRecentEnrichmentState: async (_sql, _mailbox, checkpoint, progress) => {
      state = { last_successful_at: checkpoint, next_page_token: progress.nextPageToken,
        window_since: progress.since, window_until: progress.until };
    }
  };
  const options = { sql: {}, env: { NETWORK_CRM_GMAIL_MAILBOX: 'andre@example.com' }, recent: true, dependencies };
  const first = await runGmailEmailEnrichment({ ...options, now: new Date('2026-10-23T15:00:00Z') });
  assert.equal(first.completed, false);
  assert.equal(state.last_successful_at, null);
  await runGmailEmailEnrichment({ ...options, now: new Date('2026-10-23T16:00:00Z') });
  assert.equal(state.last_successful_at, '2026-10-23T15:00:00.000Z');
  assert.equal(queries[0], queries[1]);
  await runGmailEmailEnrichment({ ...options, now: new Date('2026-10-24T15:00:00Z') });
  assert.notEqual(queries[1], queries[2]);
  assert.equal(pages, 3);
});

test('automated enrichment selects recent mode only when explicitly requested', async () => {
  const { createHandler } = require('../api/automation/gmail-email-enrichment');
  const modes = [];
  const handler = createHandler({ auth: () => true, getSql: () => ({}), ensureSchema: async () => {},
    runEnrichment: async ({ recent }) => { modes.push(recent); return { completed: true }; } });
  const response = responseRecorder();
  await handler({ method: 'POST', body: { mode: 'recent' } }, response);
  assert.equal(response.statusCode, 200);
  await handler({ method: 'POST', body: {} }, responseRecorder());
  assert.deepEqual(modes, [true, false]);
});

test('HTML-only email yields substantive body text and ignores script, style, and quoted history', () => {
  const original = gmailMessage();
  const parsed = normalizedInboundMessage({ ...original, payload: {
    ...original.payload,
    parts: [{ mimeType: 'text/html', body: { data: encoded('<style>invisible</style><p>Hi Andre,</p><p>Hope you are well. The garden project needs a revised vendor estimate &amp; delivery plan.</p><p>Could you introduce me to your supplier?</p><blockquote>Old message</blockquote><script>bad()</script>') } }]
  } }, 'andre@example.com');
  const proposal = require('../lib/communication-proposals').analyzeOutboundEmail(parsed, { id: '55', name: 'Kimberly Villani' });
  assert.equal(proposal.status, 'pending');
  assert.match(proposal.proposed.note, /revised vendor estimate & delivery plan/);
  assert.match(proposal.proposed.note, /introduce me to your supplier/);
  assert.doesNotMatch(proposal.proposed.note, /invisible|Old message|bad\(\)/);
});

test('review resumes a fixed scan window and advances checkpoint only after the last page', async () => {
  let state = { last_successful_at: '2026-08-20T00:00:00Z' };
  const requests = [];
  const dependencies = {
    getAccessToken: async () => 'token',
    loadSyncState: async () => state,
    listMessages: async (_token, since, page, until) => {
      requests.push({ since, page, until });
      return page ? { messages: [] } : { messages: [], nextPageToken: 'page-2' };
    },
    saveSyncState: async (_sql, _mailbox, checkpoint, progress) => {
      state = { last_successful_at: checkpoint, next_page_token: progress.nextPageToken,
        window_since: progress.since, window_until: progress.until };
    }
  };
  const options = { sql: {}, env: { NETWORK_CRM_GMAIL_MAILBOX: 'andre@example.com' }, dependencies };
  const first = await runGmailReviewSync({ ...options, now: new Date('2026-08-31T15:00:00Z') });
  assert.equal(first.has_more, true);
  assert.equal(state.last_successful_at, '2026-08-20T00:00:00Z');
  const second = await runGmailReviewSync({ ...options, now: new Date('2026-08-31T16:00:00Z') });
  assert.equal(second.has_more, false);
  assert.equal(requests[1].page, 'page-2');
  assert.equal(requests[1].since, requests[0].since);
  assert.equal(requests[1].until, requests[0].until);
  assert.equal(state.last_successful_at, '2026-08-31T15:00:00.000Z');
  assert.equal(state.next_page_token, undefined);
});

test("manual and automation Gmail sync routes enforce their separate authentication", async () => {
  const { createHandler: createManual } = require("../api/crm/gmail-review-sync");
  const { createHandler: createAutomation } = require("../api/automation/gmail-review-sync");
  let databaseOpened = false;
  const manual = createManual({ auth: () => false, getSql: () => { databaseOpened = true; return {}; } });
  const manualResponse = responseRecorder();
  await manual({ method: "POST", headers: {} }, manualResponse);
  assert.equal(manualResponse.statusCode, 401);
  assert.equal(databaseOpened, false);

  const automation = createAutomation({ auth: () => true, getSql: () => ({}), ensureSchema: async () => {}, runSync: async () => ({ scanned: 2, proposed: 1, duplicates: 0, skipped: 1 }) });
  const automationResponse = responseRecorder();
  await automation({ method: "POST", headers: { authorization: "Bearer private" } }, automationResponse);
  assert.equal(automationResponse.statusCode, 200);
  assert.equal(automationResponse.body.proposed, 1);
});
