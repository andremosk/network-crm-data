const assert = require("node:assert/strict");
const test = require("node:test");

const { createHandler } = require("../api/automation/contact-updates");

function responseRecorder() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

function contact(id, overrides = {}) {
  return { id: String(id), _recordId: String(id), _syncVersion: 1, name: "Nicole Heid-Arce", email: "nicole@elevarecfo.com", notes: "", status: null, followUp: false, followUpDate: "", ...overrides };
}

function fakeRepository(records = []) {
  const values = new Map(records.map((item) => [String(item._recordId), { ...item }]));
  const completed = new Map();
  const claims = new Map();
  let nextId = 8000;
  const active = (item) => !item.deleted && !item.archived;
  return {
    values,
    async findById(id) { const value = values.get(String(id)); return value && active(value) ? { ...value } : null; },
    async findByEmail(email) { return [...values.values()].filter((item) => active(item) && item.email.toLowerCase() === String(email).toLowerCase()).map((item) => ({ ...item })); },
    async findByName(name) { return [...values.values()].filter((item) => active(item) && item.name.toLowerCase() === String(name).toLowerCase()).map((item) => ({ ...item })); },
    async findByRequestId(requestId) { const item = [...values.values()].find((value) => value.automationRequestIds?.includes(requestId)); return item ? { ...item } : null; },
    async create(payload) {
      const id = String(nextId++); const value = { ...payload, id: Number(id), _recordId: id, _syncVersion: 1 };
      values.set(id, value); return { id, version: 1, data: value };
    },
    async update(current, payload) {
      const stored = values.get(String(current._recordId));
      if (!stored || stored._syncVersion !== current._syncVersion) return { status: "conflict", version: stored?._syncVersion, data: stored };
      const value = { ...payload, _recordId: stored._recordId, _syncVersion: stored._syncVersion + 1 };
      values.set(stored._recordId, value);
      return { status: "updated", version: value._syncVersion, data: value };
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

function request(body, token = "test") { return { method: "POST", headers: { authorization: `Bearer ${token}` }, body }; }

test("rejects unauthenticated callers before opening the database", async () => {
  let databaseOpened = false;
  const handler = createHandler({ auth: () => false, getSql: () => { databaseOpened = true; return {}; } });
  const response = responseRecorder();
  await handler(request({ request_id: "request-123", action: "lookup", contact: { id: 1 } }), response);
  assert.equal(response.statusCode, 401);
  assert.equal(databaseOpened, false);
});

test("creates a minimal contact, note, and follow-up once", async () => {
  const repository = fakeRepository();
  const handler = makeHandler(repository);
  const body = {
    request_id: "create-pat-0001", contact: { email: "pat@example.com", name: "Pat Example" },
    create_if_missing: true, create: { name: "Pat Example", email: "pat@example.com", company: "Example Co.", position: "COO" },
    note: "Met at the chamber and discussed workflow mapping.", follow_up: { status: "follow_up", date: "2026-09-10" }
  };
  const first = responseRecorder(); await handler(request(body), first);
  const second = responseRecorder(); await handler(request(body), second);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.outcome, "created");
  assert.deepEqual(second.body, first.body);
  assert.equal(repository.values.size, 1);
  const saved = [...repository.values.values()][0];
  assert.match(saved.notes, /workflow mapping/);
  assert.equal(saved.followUpDate, "2026-09-10");
  assert.equal(saved.tier, 3);
});

test("updates an existing contact and preserves a later follow-up date", async () => {
  const repository = fakeRepository([contact(42, { followUpDate: "2026-10-15", status: "follow_up", followUp: true })]);
  const handler = makeHandler(repository);
  const response = responseRecorder();
  await handler(request({
    request_id: "nicole-note-0001", contact: { id: 42 }, note: "Discussed CFO services and reconciliation work.",
    follow_up: { status: "follow_up", date: "2026-10-03" }
  }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.follow_up.date, "2026-10-15");
  assert.equal(response.body.follow_up.kept_later_date, true);
  assert.match(repository.values.get("42").notes, /reconciliation/);
});

test("allows only the requested profile fields for an existing contact", async () => {
  const repository = fakeRepository([contact(42, { tier: 3, clientFitTier: 4, status: "network" })]);
  const handler = makeHandler(repository);
  const response = responseRecorder();
  await handler(request({
    request_id: "profile-update-0001", contact: { id: 42 },
    profile: { tier: 1, client_fit_tier: 2, status: "network_closely" }
  }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.profile, { tier: 1, client_fit_tier: 2, status: "network_closely" });
  const saved = repository.values.get("42");
  assert.equal(saved.tier, 1);
  assert.equal(saved.clientFitTier, 2);
  assert.equal(saved.status, "network_closely");
});

test("rejects profile values outside the tier and status allowlists", async () => {
  const handler = makeHandler(fakeRepository([contact(42)]));
  const badTier = responseRecorder();
  await handler(request({ request_id: "bad-profile-tier", contact: { id: 42 }, profile: { tier: 5 } }), badTier);
  assert.equal(badTier.statusCode, 400);
  const badStatus = responseRecorder();
  await handler(request({ request_id: "bad-profile-status", contact: { id: 42 }, profile: { status: "anything_goes" } }), badStatus);
  assert.equal(badStatus.statusCode, 400);
});

test("returns ambiguity and rejects conflicting selectors without writing", async () => {
  const repository = fakeRepository([
    contact(1, { company: "Yarn", position: "Publisher", lastContact: "2026-08-04", notes: "Family yarn business and magazine pursuit." }),
    contact(2, { email: "other@example.com", company: "Other Co.", position: "Engineer" })
  ]);
  const handler = makeHandler(repository);
  const ambiguous = responseRecorder();
  await handler(request({ request_id: "ambiguous-0001", contact: { name: "Nicole Heid-Arce" }, note: "Do not add" }), ambiguous);
  assert.equal(ambiguous.statusCode, 409);
  assert.deepEqual(ambiguous.body.error.candidates[0], {
    id: "1", name: "Nicole Heid-Arce", company: "Yarn", position: "Publisher",
    last_contact: "2026-08-04", note_summary: "Family yarn business and magazine pursuit."
  });
  const conflicting = responseRecorder();
  await handler(request({ request_id: "conflict-0001", contact: { id: 1, email: "other@example.com" }, note: "Do not add" }), conflicting);
  assert.equal(conflicting.statusCode, 409);
  assert.equal(repository.values.get("1").notes, "Family yarn business and magazine pursuit.");
});

test("validates bad input and permits lookup without writes", async () => {
  const repository = fakeRepository([contact(42)]);
  const handler = makeHandler(repository);
  const invalid = responseRecorder();
  await handler(request({ request_id: "bad-date-0001", contact: { id: 42 }, follow_up: { status: "follow_up", date: "tomorrow" } }), invalid);
  assert.equal(invalid.statusCode, 400);
  const lookup = responseRecorder();
  await handler(request({ request_id: "lookup-0001", action: "lookup", contact: { id: 42 } }), lookup);
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.body.found, true);
  assert.equal(repository.values.get("42").notes, "");
});

test("rejects all GET writes", async () => {
  const handler = makeHandler(fakeRepository());
  const response = responseRecorder();
  await handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});
