const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NETWORK_CRM_AUTOMATION_TOKEN = "test-private-token";
const endpoint = require("../api/automation/follow-ups");

function responseRecorder() {
  return {
    body: undefined,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
}

test("returns only follow-up contacts with the requested read-only fields", async () => {
  const handler = endpoint.createHandler({
    loadContacts: async () => [
      {
        _recordId: "123",
        name: "Jane Smith",
        company: "Example Co.",
        position: "COO",
        tier: 1,
        status: "follow_up",
        followUpDate: "2026-08-03",
        notes: "<b>Discussed</b> AI workflow mapping.",
        email: "jane@example.com",
        linkedin: "https://linkedin.com/in/jane-smith"
      },
      {
        _recordId: "124",
        name: "Needs Scheduling",
        status: "follow_up",
        notInterested: true,
        notes: "Still included because only deleted and archived contacts are excluded."
      },
      {
        _recordId: "125",
        name: "Archived Follow-up",
        status: "follow_up",
        archived: true
      },
      {
        _recordId: "126",
        name: "Regular Network Contact",
        status: "network",
        followUpDate: "2026-07-01"
      }
    ]
  });
  const response = responseRecorder();

  await handler(
    {
      method: "GET",
      headers: { authorization: "Bearer test-private-token" }
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.equal(response.body.follow_ups.length, 2);
  assert.deepEqual(response.body.follow_ups[0], {
    contact_id: "123",
    contact_name: "Jane Smith",
    company: "Example Co.",
    position: "COO",
    tier: 1,
    follow_up_date: "2026-08-03",
    recent_context: "Discussed AI workflow mapping.",
    email: "jane@example.com",
    linkedin: "https://linkedin.com/in/jane-smith",
    source_url: "https://network-crm-data.vercel.app/contacts/123"
  });
  assert.equal(response.body.follow_ups[1].contact_name, "Needs Scheduling");
  assert.equal(response.body.follow_ups[1].follow_up_date, null);
});

test("rejects missing bearer authentication before reading contacts", async () => {
  let loaded = false;
  const handler = endpoint.createHandler({
    loadContacts: async () => {
      loaded = true;
      return [];
    }
  });
  const response = responseRecorder();

  await handler({ method: "GET", headers: {} }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(loaded, false);
});

test("rejects all write methods", async () => {
  const handler = endpoint.createHandler({ loadContacts: async () => [] });
  const response = responseRecorder();

  await handler(
    {
      method: "PATCH",
      headers: { authorization: "Bearer test-private-token" }
    },
    response
  );

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "GET");
});
