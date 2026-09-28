const { tokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { updateRecord } = require("../crm/state");
const { getBearerToken, parseBody } = require("../../lib/text-summaries");
const { requestHash } = require("../../lib/automation-engagements");

function active(item) {
  return ![true, "true", 1, "1"].includes(item.deleted) && ![true, "true", 1, "1"].includes(item.archived);
}

function groupSummary(row) {
  const item = row.payload || {};
  return {
    id: String(row.record_id),
    title: String(item.title || ""),
    organization: String(item.organization || item.client || ""),
    status: String(item.status || "pursuit"),
    is_group: item.isGroup === true,
    linked_contact_count: Array.isArray(item.contactIds || item.linkedContactIds) ? (item.contactIds || item.linkedContactIds).length : 0,
    note_count: Array.isArray(item.notes) ? item.notes.length : item.notes ? 1 : 0
  };
}

async function findByExactTitle(sql, title) {
  const rows = await sql`
    SELECT record_id, payload, version FROM crm_records
    WHERE record_type = 'engagement'
      AND COALESCE(payload->>'title', '') = ${title}
    ORDER BY updated_at DESC
  `;
  const activeRows = rows.filter((row) => active(row.payload || {}));
  return activeRows.length === 1 ? activeRows[0] : null;
}

function validRequestId(value) {
  return /^[A-Za-z0-9._:-]{8,200}$/.test(String(value || "").trim());
}

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || tokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const update = dependencies.updateRecord || updateRecord;
  const find = dependencies.findByExactTitle || findByExactTitle;
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    if (!auth(getBearerToken(request))) return response.status(401).json({ error: { message: "Unauthorized" } });
    const body = parseBody(request);
    if (!body || !["inspect", "convert_to_group"].includes(body.action)) {
      return response.status(400).json({ error: { message: "action must be inspect or convert_to_group." } });
    }
    const title = String(body.title || "").trim();
    if (!title || title.length > 240) return response.status(400).json({ error: { message: "title is required." } });
    if (body.action === "convert_to_group" && !validRequestId(body.request_id)) {
      return response.status(400).json({ error: { message: "A valid request_id is required for conversion." } });
    }
    try {
      const sql = sqlFactory();
      await schema(sql);
      const row = await find(sql, title);
      if (!row) return response.status(404).json({ error: { message: "Expected exactly one active engagement with that title." } });
      if (body.action === "inspect") return response.status(200).json({ group: groupSummary(row) });

      const original = row.payload || {};
      if (original.isGroup === true && !original.groupId) {
        return response.status(200).json({ outcome: "unchanged", request_id: body.request_id, group: groupSummary(row) });
      }
      if (original.groupId) return response.status(409).json({ error: { message: "A child pursuit cannot be converted into a group." } });
      const data = { ...original, isGroup: true };
      const updated = await update(sql, "engagement", { id: row.record_id, version: Number(row.version), data });
      if (!["updated", "unchanged"].includes(updated.status)) {
        return response.status(409).json({ error: { message: "The engagement changed during conversion. Inspect and retry." } });
      }
      const converted = { record_id: row.record_id, version: updated.version, payload: updated.data || data };
      return response.status(200).json({ outcome: "converted", request_id: body.request_id, group: groupSummary(converted), request_hash: requestHash({ action: body.action, title, request_id: body.request_id }) });
    } catch (error) {
      console.error("Engagement group migration failed:", error.message || error);
      return response.status(500).json({ error: { message: "Engagement group migration failed." } });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.findByExactTitle = findByExactTitle;
module.exports = handler;
