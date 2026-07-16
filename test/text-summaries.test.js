const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cleanTranscript,
  getBearerToken,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  sourceKeyFor,
  validDate
} = require("../lib/text-summaries");

test("normalizes contact identifiers conservatively", () => {
  assert.equal(normalizeName("Mary-Claire Sullivan"), "mary claire sullivan");
  assert.equal(normalizeEmail(" Andre@Example.com "), "andre@example.com");
  assert.equal(normalizePhone("(914) 555-0199"), "+19145550199");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

test("reads bearer tokens without accepting other schemes", () => {
  assert.equal(getBearerToken({ headers: { authorization: "Bearer private-key" } }), "private-key");
  assert.equal(getBearerToken({ headers: { authorization: "Basic private-key" } }), "");
  assert.equal(getBearerToken({ headers: {} }), "");
});

test("automation endpoint rejects unauthenticated requests before database access", async () => {
  const handler = require("../api/automation/text-summaries");
  let statusCode;
  let responseBody;
  await handler(
    { method: "GET", headers: {} },
    {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; }
    }
  );
  assert.equal(statusCode, 401);
  assert.equal(responseBody.error.message, "Unauthorized");
});

test("cleans transcripts and creates stable source keys", () => {
  assert.equal(cleanTranscript(" hello\u0000 "), "hello");
  assert.equal(sourceKeyFor("same"), sourceKeyFor("same"));
  assert.notEqual(sourceKeyFor("same"), sourceKeyFor("different"));
});

test("validates timestamps", () => {
  assert.ok(validDate("2026-07-16T12:00:00Z") instanceof Date);
  assert.equal(validDate("not-a-date"), null);
});
