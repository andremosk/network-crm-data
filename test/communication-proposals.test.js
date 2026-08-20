const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeOutboundEmail,
  applyUpdatePayload,
  createContactPayload
} = require("../lib/communication-proposals");

function outbound(overrides = {}) {
  return {
    sourceMessageId: "gmail-message-1",
    sentAt: "2026-08-12T14:00:00Z",
    recipients: [{ name: "Jane Smith", email: "jane@example.com", position: "COO" }],
    subject: "Checking in",
    bodyText: "I have been meaning to reconnect and hear how things are going. Open to catching up over coffee sometime soon?",
    ...overrides
  };
}

function responseRecorder() {
  return {
    statusCode: null, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

test("creates a conservative new-contact proposal with a one-week follow-up", () => {
  const result = analyzeOutboundEmail(outbound());
  assert.equal(result.status, "pending");
  assert.equal(result.proposalType, "create_contact");
  assert.equal(result.proposed.name, "Jane Smith");
  assert.equal(result.proposed.email, "jane@example.com");
  assert.equal(result.proposed.company, "Example");
  assert.equal(result.proposed.position, "COO");
  assert.equal(result.proposed.tier, 3);
  assert.equal(result.proposed.status, "follow_up");
  assert.equal(result.proposed.followUpDate, "2026-08-19");
});

test("uses T2 only when the email contains clear existing-relationship evidence", () => {
  const result = analyzeOutboundEmail(outbound({
    bodyText: "As an old colleague, I have been meaning to reconnect and reminisce about when we worked together. Want to catch up?"
  }));
  assert.equal(result.proposed.tier, 2);
});

test("matches an existing contact by email and proposes an update instead of a new contact", () => {
  const result = analyzeOutboundEmail(outbound(), { id: "42", name: "Jane Smith", email: "jane@example.com" });
  assert.equal(result.proposalType, "update_contact");
  assert.equal(result.matchedContactId, "42");
  assert.equal(result.proposed.followUpDate, "2026-08-19");
  assert.match(result.proposed.note, /Checking in/i);
});

test("excludes group mail, transactional mail, and low-signal logistics", () => {
  assert.equal(analyzeOutboundEmail(outbound({
    recipients: [{ email: "a@example.com" }, { email: "b@example.com" }]
  })).status, "excluded");
  assert.equal(analyzeOutboundEmail(outbound({ subject: "Your receipt", bodyText: "Order confirmation and receipt." })).status, "excluded");
  assert.equal(analyzeOutboundEmail(outbound({ subject: "Calendar", bodyText: "Tuesday at 3 works for me. See you then." })).status, "excluded");
});

test("automation ingestion is idempotent and matches by normalized recipient email", async () => {
  const { createHandler } = require("../api/automation/communication-proposals");
  const stored = new Map();
  const handler = createHandler({
    auth: () => true,
    getSql: () => ({}),
    ensureSchema: async () => {},
    findContactByEmail: async (_sql, email) => email === "jane@example.com" ? { id: "42", name: "Jane Smith" } : null,
    insertProposal: async (_sql, proposal) => {
      if (stored.has(proposal.sourceHash)) return { status: "duplicate", id: stored.get(proposal.sourceHash).id };
      stored.set(proposal.sourceHash, { ...proposal, id: 1 });
      return { status: "pending", id: 1, proposalType: proposal.proposalType };
    }
  });
  const first = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: outbound() }, first);
  const second = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer test" }, body: outbound() }, second);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.status, "pending");
  assert.equal(first.body.proposalType, "update_contact");
  assert.equal(second.body.status, "duplicate");
  assert.equal(stored.size, 1);
});

test("automation ingestion rejects unauthenticated requests before database access", async () => {
  const { createHandler } = require("../api/automation/communication-proposals");
  let openedDatabase = false;
  const handler = createHandler({
    auth: () => false,
    getSql: () => { openedDatabase = true; return {}; }
  });
  const response = responseRecorder();
  await handler({ method: "POST", headers: {}, body: outbound() }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(openedDatabase, false);
});

test("approval creates the expected contact shape and never occurs during ingestion", () => {
  const proposal = analyzeOutboundEmail(outbound());
  const contact = createContactPayload(proposal.proposed, 2040);
  assert.equal(contact.id, 2040);
  assert.equal(contact.name, "Jane Smith");
  assert.equal(contact.tier, 3);
  assert.equal(contact.status, "follow_up");
  assert.equal(contact.followUp, true);
});

test("applying an update preserves an existing later follow-up date", () => {
  const contact = { id: 42, name: "Jane Smith", notes: "Earlier note", status: "follow_up", followUp: true, followUpDate: "2026-09-10", lastContact: "2026-08-01" };
  const updated = applyUpdatePayload(contact, {
    note: "Sent a reconnection email.", status: "follow_up", followUpDate: "2026-08-19", lastContact: "2026-08-12"
  });
  assert.equal(updated.followUpDate, "2026-09-10");
  assert.match(updated.notes, /Sent a reconnection email/);
  assert.equal(updated.lastContact, "2026-08-12");
});

test("review API requires explicit apply before invoking contact creation", async () => {
  const { createHandler } = require("../api/crm/communication-proposals");
  let creates = 0;
  const draft = { id: 7, proposal_type: "create_contact", occurred_at: "2026-08-12T14:00:00Z", proposed: analyzeOutboundEmail(outbound()).proposed };
  const handler = createHandler({
    auth: () => true, getSql: () => ({}), ensureSchema: async () => {},
    loadPending: async () => draft,
    editProposal: async (_sql, _id, _type, proposed) => ({ id: 7, proposed }),
    applyCreate: async () => { creates += 1; return "2040"; }
  });
  const edited = responseRecorder();
  await handler({ method: "PATCH", body: { id: 7, action: "edit", proposed: draft.proposed } }, edited);
  assert.equal(creates, 0);
  assert.equal(edited.body.status, "pending");
  const applied = responseRecorder();
  await handler({ method: "PATCH", body: { id: 7, action: "apply", proposed: draft.proposed } }, applied);
  assert.equal(creates, 1);
  assert.equal(applied.body.status, "applied");
});
