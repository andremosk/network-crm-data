const assert = require("node:assert/strict");
const test = require("node:test");
const { createHandler } = require("../api/automation/engagements");

function responseRecorder() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

function fakeRepository({ contacts = ["42"] } = {}) {
  const items = new Map();
  const claims = new Map();
  const completed = new Map();
  let nextId = 9000;
  return {
    items,
    async resolveContacts(ids) { return ids.map((id) => contacts.includes(String(id)) ? { _recordId: String(id), name: "Known person" } : null); },
    async findByRequestId(requestId) { return [...items.values()].find((item) => item.automationRequestIds?.includes(requestId)) || null; },
    async create(payload) {
      const id = String(nextId++); const item = { ...payload, id: Number(id), _recordId: id, _syncVersion: 1 };
      items.set(id, item); return { id, version: 1, data: item };
    },
    async claim(requestId, hash) {
      const old = claims.get(requestId);
      if (!old) { claims.set(requestId, { hash, status: "processing" }); return { type: "claimed" }; }
      if (old.hash !== hash) return { type: "conflict" };
      if (old.status === "completed") return { type: "completed", response: completed.get(requestId) };
      return { type: "in_progress" };
    },
    async complete(requestId, result) { claims.get(requestId).status = "completed"; completed.set(requestId, result); },
    async fail(requestId) { claims.get(requestId).status = "failed"; }
  };
}

function makeHandler(repository, auth = () => true) {
  return createHandler({ auth, getSql: () => ({}), ensureSchema: async () => {}, createRepository: () => repository });
}

function request(body) { return { method: "POST", headers: { authorization: "Bearer test" }, body }; }

function body(overrides = {}) {
  return {
    request_id: "seo-training-lead-0001",
    engagement: {
      title: "SEO / Paid Media AI Training Lead",
      organization: "Unnamed SEO business",
      status: "pursuit",
      current_state: "Warm lead through Melissa.",
      opportunity: "Half-day AI training.",
      next_milestone: "Melissa facilitates an introduction.",
      linked_contact_ids: ["42"],
      ...overrides
    }
  };
}

test("rejects unauthenticated requests before database access", async () => {
  let opened = false;
  const handler = createHandler({ auth: () => false, getSql: () => { opened = true; return {}; } });
  const response = responseRecorder();
  await handler(request(body()), response);
  assert.equal(response.statusCode, 401);
  assert.equal(opened, false);
});

test("creates an idempotent engagement with validated linked contacts", async () => {
  const repository = fakeRepository();
  const handler = makeHandler(repository);
  const first = responseRecorder(); await handler(request(body()), first);
  const second = responseRecorder(); await handler(request(body()), second);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.outcome, "created");
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(repository.items.size, 1);
  const saved = [...repository.items.values()][0];
  assert.equal(saved.status, "pursuit");
  assert.deepEqual(saved.contactIds, ["42"]);
});

test("rejects invalid engagement fields and unknown linked contacts", async () => {
  const repository = fakeRepository();
  const handler = makeHandler(repository);
  const invalid = responseRecorder();
  await handler(request(body({ status: "maybe" })), invalid);
  assert.equal(invalid.statusCode, 400);
  const unknown = responseRecorder();
  await handler(request(body({ linked_contact_ids: ["unknown"] })), unknown);
  assert.equal(unknown.statusCode, 400);
  assert.equal(repository.items.size, 0);
});

test("only accepts POST", async () => {
  const handler = makeHandler(fakeRepository());
  const response = responseRecorder();
  await handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});
