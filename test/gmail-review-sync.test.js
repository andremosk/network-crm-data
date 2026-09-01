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
  assert.deepEqual(result, { scanned: 3, proposed: 1, approximated: 0, duplicates: 1, skipped: 1 });
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
