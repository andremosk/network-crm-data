const assert = require("node:assert/strict");
const test = require("node:test");
const endpoint = require("../api/automation/recent-notes");

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

test("recent notes accepts current and staged tokens without changing its response", async (t) => {
  const prior = {
    current: process.env.NETWORK_CRM_AUTOMATION_TOKEN,
    next: process.env.NETWORK_CRM_AUTOMATION_TOKEN_NEXT
  };
  process.env.NETWORK_CRM_AUTOMATION_TOKEN = "current-test-token";
  process.env.NETWORK_CRM_AUTOMATION_TOKEN_NEXT = "staged-test-token";
  t.after(() => {
    for (const [key, value] of [
      ["NETWORK_CRM_AUTOMATION_TOKEN", prior.current],
      ["NETWORK_CRM_AUTOMATION_TOKEN_NEXT", prior.next]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let reads = 0;
  const handler = endpoint.createHandler({ loadContacts: async () => {
    reads += 1;
    return [{ id: 123, name: "Mike Test", company: "Belmont Example",
      notes: "Oct 5, 2026: <strong>Text summary</strong> - Discuss reporting next steps." }];
  } });

  for (const token of ["current-test-token", "staged-test-token"]) {
    const response = responseRecorder();
    await handler({ method: "GET", headers: { authorization: `Bearer ${token}` },
      query: { since: "2026-10-01", q: "Mike Test" } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    assert.equal(response.body.notes.length, 1);
    assert.match(response.body.notes[0].note, /^Text summary/);
    assert.equal(response.body.notes[0].source_url, "https://network-crm-data.vercel.app/contacts/123");
  }
  assert.equal(reads, 2);

  for (const authorization of [undefined, "Bearer invalid-test-token", "Basic staged-test-token"]) {
    const response = responseRecorder();
    await handler({ method: "GET", headers: { authorization } }, response);
    assert.equal(response.statusCode, 401);
  }
  assert.equal(reads, 2, "unauthorized requests must not read contacts");

  delete process.env.NETWORK_CRM_AUTOMATION_TOKEN_NEXT;
  const response = responseRecorder();
  await handler({ method: "GET", headers: { authorization: "Bearer staged-test-token" } }, response);
  assert.equal(response.statusCode, 401, "removing the staged token must revoke it");
  assert.equal(reads, 2);
});
