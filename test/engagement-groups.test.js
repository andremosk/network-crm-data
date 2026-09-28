const assert = require("node:assert/strict");
const test = require("node:test");
const { createHandler } = require("../api/automation/engagement-groups");

function responseRecorder() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

function makeHandler(row, updateRecord = async (_sql, _type, record) => ({ status: "updated", version: 4, data: record.data })) {
  return createHandler({
    auth: () => true,
    getSql: () => ({}),
    ensureSchema: async () => {},
    findByExactTitle: async () => row,
    updateRecord
  });
}

function request(body) { return { method: "POST", headers: { authorization: "Bearer test" }, body }; }

const businessLogistics = {
  record_id: "17", version: 3,
  payload: { id: 17, title: "Business Logistics", status: "pursuit", contactIds: [2, 4], notes: [{ id: "note-1", date: "2026-09-10", html: "Existing history" }] }
};

test("inspects a group candidate without changing its record", async () => {
  const handler = makeHandler(businessLogistics);
  const response = responseRecorder();
  await handler(request({ action: "inspect", title: "Business Logistics" }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.group, {
    id: "17", title: "Business Logistics", organization: "", status: "pursuit", is_group: false,
    linked_contact_count: 2, note_count: 1
  });
});

test("converts only the group flag and preserves existing history", async () => {
  let updated;
  const handler = makeHandler(businessLogistics, async (_sql, type, record) => {
    updated = { type, record };
    return { status: "updated", version: 4, data: record.data };
  });
  const response = responseRecorder();
  await handler(request({ action: "convert_to_group", title: "Business Logistics", request_id: "business-logistics-group-20260928" }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(updated.type, "engagement");
  assert.equal(updated.record.data.isGroup, true);
  assert.deepEqual(updated.record.data.notes, businessLogistics.payload.notes);
  assert.deepEqual(updated.record.data.contactIds, businessLogistics.payload.contactIds);
});

test("rejects requests without the private bearer token", async () => {
  const handler = createHandler({ auth: () => false, getSql: () => { throw new Error("should not connect"); } });
  const response = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { action: "inspect", title: "Business Logistics" } }, response);
  assert.equal(response.statusCode, 401);
});
