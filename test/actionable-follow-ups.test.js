const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NETWORK_CRM_AUTOMATION_TOKEN = "test-private-token";
const endpoint = require("../api/automation/actionable-follow-ups");

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

test("maps active follow-ups to stable task records and sorts dated work first", async () => {
  const handler = endpoint.createHandler({
    loadContacts: async () => [
      {
        _recordId: "22",
        name: "Undated Person",
        status: "follow_up",
        notes: "Reconnect about operations."
      },
      {
        _recordId: "7",
        name: "Maya Patel",
        company: "Northline Components",
        position: "President",
        tier: 2,
        clientFitTier: 1,
        connectorFitTier: 3,
        status: "follow_up",
        followUpDate: "2026-07-28",
        followUpAction: "Send the workflow outline",
        notes: "<b>Quoting</b> still moves between email and spreadsheets."
      },
      {
        _recordId: "9",
        name: "Not Interested",
        status: "follow_up",
        followUpDate: "2026-07-20",
        notInterested: true
      },
      {
        _recordId: "10",
        name: "Network Contact",
        status: "network",
        followUpDate: "2026-07-20"
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
    follow_up_id: "crm-follow-up:7",
    contact_id: "7",
    contact_name: "Maya Patel",
    next_action: "Send the workflow outline",
    follow_up_date: "2026-07-28",
    status: "follow_up",
    context: {
      company: "Northline Components",
      position: "President",
      relationship_tier: 2,
      client_fit_tier: 1,
      connector_fit_tier: 3,
      notes: "Quoting still moves between email and spreadsheets."
    }
  });
  assert.equal(response.body.follow_ups[1].follow_up_date, null);
  assert.equal(response.body.follow_ups[1].next_action, "Follow up with Undated Person");
});

test("rejects unattended requests without the configured bearer token", async () => {
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

test("is read-only", async () => {
  const handler = endpoint.createHandler({ loadContacts: async () => [] });
  const response = responseRecorder();

  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-private-token" }
    },
    response
  );

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "GET");
});
