const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NETWORK_CRM_AUTOMATION_TOKEN = "test-private-token";

const { matchContact, nameSimilarity, summaryHtml } = require("../lib/granola-notes");
const { createHandler } = require("../api/automation/granola-notes");

const contacts = [
  { id: 1, name: "Chris Villani", company: "Garden Island LLC", email: "" },
  { id: 2, name: "Christopher Villanueva", company: "Other Co", email: "chris@example.com" },
  { id: 3, name: "Mary Smith", company: "Acme Advisory", email: "mary@acme.com" },
  { id: 4, name: "Mary Smith", company: "Different Co", email: "other@example.com" }
];

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function validRequest(overrides = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-private-token" },
    body: {
      meetingId: "meeting-123",
      meetingAt: "2026-07-31T15:00:00Z",
      meetingTitle: "Chris Villani and Andre Moskowitz",
      participant: { name: "Chris Villani", company: "Garden Island LLC" },
      summary: "- Personal context\n- Professional context\n- Memorable phrase\n- Next steps: reconnect",
      ...overrides
    }
  };
}

test("matches an attendee by exact email before approximate names", () => {
  const result = matchContact(contacts, { name: "Chris", email: "chris@example.com" }, "Catch-up");
  assert.equal(result.match.id, 2);
  assert.equal(result.method, "email");
});

test("holds duplicate exact-email records for review", () => {
  const result = matchContact([
    { id: 1, name: "Chris One", email: "shared@example.com" },
    { id: 2, name: "Chris Two", email: "shared@example.com" }
  ], { name: "Chris", email: "shared@example.com" }, "Catch-up");
  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 2);
});

test("matches a contact without email by a unique full name", () => {
  const result = matchContact(contacts, { name: "Chris Villani" }, "Chris Villani and Andre");
  assert.equal(result.match.id, 1);
  assert.ok(result.score >= 84);
});

test("does not accept first-name-only or ambiguous full-name matches", () => {
  assert.equal(nameSimilarity("Chris Villani", "Chris"), 0);
  const result = matchContact(contacts, { name: "Mary Smith" }, "Mary and Andre");
  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 2);
});

test("formats recipe bullets as safe CRM note HTML", () => {
  const html = summaryHtml("- Knows <Andre>\n- Next steps: follow up");
  assert.equal(html, "• Knows &lt;Andre&gt;<br>• Next steps: follow up");
});

test("rejects unauthenticated Granola note imports before database access", async () => {
  const handler = createHandler({ getSql() { throw new Error("database should not be reached"); } });
  const response = responseRecorder();
  await handler({ ...validRequest(), headers: {} }, response);
  assert.equal(response.statusCode, 401);
});

test("imports a recipe summary for a confident approximate match", async () => {
  let imported;
  const handler = createHandler({
    getSql: () => ({}),
    ensureSchema: async () => {},
    findImport: async () => null,
    loadContacts: async () => contacts,
    recordReview: async () => { throw new Error("should not require review"); },
    importNote: async (_sql, input, _key, result) => {
      imported = { input, result };
      return true;
    }
  });
  const response = responseRecorder();
  await handler(validRequest(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "imported");
  assert.equal(response.body.contactId, "1");
  assert.equal(imported.input.summary.includes("Next steps"), true);
});

test("holds uncertain matches for review without modifying a contact", async () => {
  let review;
  const handler = createHandler({
    getSql: () => ({}),
    ensureSchema: async () => {},
    findImport: async () => null,
    loadContacts: async () => contacts,
    recordReview: async (_sql, input, _key, result) => { review = { input, result }; },
    importNote: async () => { throw new Error("should not import"); }
  });
  const response = responseRecorder();
  await handler(validRequest({
    meetingTitle: "Mary and Andre",
    participant: { name: "Mary Smith" }
  }), response);
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, "review_required");
  assert.equal(review.result.match, null);
});

test("returns duplicate without importing the same meeting twice", async () => {
  const handler = createHandler({
    getSql: () => ({}),
    ensureSchema: async () => {},
    findImport: async () => ({ status: "imported", contact_id: "1" }),
    loadContacts: async () => { throw new Error("should not load contacts"); }
  });
  const response = responseRecorder();
  await handler(validRequest(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "duplicate");
});
