const { tokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { createRecord } = require("../crm/state");
const { getBearerToken, parseBody } = require("../../lib/text-summaries");
const { createPayload, publicEngagement, requestHash, validatePayload } = require("../../lib/automation-engagements");

function active(record) {
  return ![true, "true", 1, "1"].includes(record.deleted) && ![true, "true", 1, "1"].includes(record.archived);
}

function recordFromRow(row) {
  return { ...row.payload, _recordId: row.record_id, _syncVersion: Number(row.version) };
}

async function findContact(sql, id) {
  const rows = await sql`SELECT record_id, payload, version FROM crm_records WHERE record_type = 'contact' AND record_id = ${id}`;
  const contact = rows[0] ? recordFromRow(rows[0]) : null;
  return contact && active(contact) ? contact : null;
}

async function findEngagementByRequestId(sql, requestId) {
  const rows = await sql`
    SELECT record_id, payload, version FROM crm_records
    WHERE record_type = 'engagement'
      AND COALESCE(payload->'automationRequestIds', '[]'::jsonb) ? ${requestId}
    LIMIT 1
  `;
  return rows[0] ? recordFromRow(rows[0]) : null;
}

function createRepository(sql) {
  return {
    resolveContacts: async (ids) => Promise.all(ids.map((id) => findContact(sql, id))),
    findByRequestId: (requestId) => findEngagementByRequestId(sql, requestId),
    create: (payload) => createRecord(sql, "engagement", { id: "", create: true, data: payload }),
    async claim(requestId, hash) {
      const inserted = await sql`
        INSERT INTO crm_automation_write_requests (request_id, request_hash, status)
        VALUES (${requestId}, ${hash}, 'processing')
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `;
      if (inserted.length) return { type: "claimed" };
      const rows = await sql`SELECT request_hash, status, response FROM crm_automation_write_requests WHERE request_id = ${requestId}`;
      const current = rows[0];
      if (!current || current.request_hash !== hash) return { type: "conflict" };
      if (current.status === "completed" && current.response) return { type: "completed", response: current.response };
      const reclaimed = await sql`
        UPDATE crm_automation_write_requests SET status = 'processing', updated_at = NOW()
        WHERE request_id = ${requestId} AND request_hash = ${hash} AND status = 'failed'
        RETURNING request_id
      `;
      return reclaimed.length ? { type: "claimed" } : { type: "in_progress" };
    },
    complete: async (requestId, result) => {
      await sql`
        UPDATE crm_automation_write_requests
        SET status = 'completed', response = ${JSON.stringify(result)}::jsonb, updated_at = NOW()
        WHERE request_id = ${requestId}
      `;
    },
    fail: async (requestId) => {
      await sql`
        UPDATE crm_automation_write_requests SET status = 'failed', updated_at = NOW()
        WHERE request_id = ${requestId} AND status = 'processing'
      `;
    }
  };
}

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || tokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const repositoryFactory = dependencies.createRepository || createRepository;
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    if (!auth(getBearerToken(request))) return response.status(401).json({ error: { message: "Unauthorized" } });
    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    const input = validatePayload(body);
    if (input.error) return response.status(400).json({ error: { message: input.error } });
    let repository;
    try {
      const sql = sqlFactory();
      await schema(sql);
      repository = repositoryFactory(sql);
      const claim = await repository.claim(input.requestId, requestHash(body));
      if (claim.type === "completed") return response.status(200).json(claim.response);
      if (claim.type === "conflict") return response.status(409).json({ error: { message: "request_id was previously used for a different request." } });
      if (claim.type === "in_progress") return response.status(409).json({ error: { message: "This request is still being processed; retry shortly with the same request_id." } });

      const prior = await repository.findByRequestId(input.requestId);
      if (prior) {
        const result = { request_id: input.requestId, outcome: "created", engagement: publicEngagement(prior) };
        await repository.complete(input.requestId, result);
        return response.status(200).json(result);
      }
      const linkedContacts = await repository.resolveContacts(input.engagement.contactIds);
      const missing = input.engagement.contactIds.filter((id, index) => !linkedContacts[index]);
      if (missing.length) {
        await repository.fail(input.requestId);
        return response.status(400).json({ error: { message: "One or more linked_contact_ids do not identify active CRM contacts.", contact_ids: missing } });
      }
      const created = await repository.create(createPayload(input.engagement, input.requestId));
      const item = { ...created.data, _recordId: created.id, _syncVersion: created.version };
      const result = { request_id: input.requestId, outcome: "created", engagement: publicEngagement(item) };
      await repository.complete(input.requestId, result);
      return response.status(201).json(result);
    } catch (error) {
      if (repository) await repository.fail(input.requestId).catch(() => {});
      console.error("Automation engagement creation failed:", error.message || error);
      return response.status(500).json({ error: { message: "Automation engagement creation failed." } });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.createRepository = createRepository;
module.exports = handler;
