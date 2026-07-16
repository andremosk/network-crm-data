const { hasValidSession } = require("../../lib/crm-auth");
const { cleanPayload, ensureSchema, getSql } = require("../../lib/crm-db");

function parseBody(request) {
  if (typeof request.body !== "string") return request.body || {};
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}

async function getState(sql) {
  const rows = await sql`
    SELECT record_type, record_id, payload, version, updated_at
    FROM crm_records
    ORDER BY record_type, record_id
  `;
  const contacts = [];
  const apps = [];
  for (const row of rows) {
    const record = {
      ...row.payload,
      _syncVersion: Number(row.version),
      _syncUpdatedAt: new Date(row.updated_at).toISOString()
    };
    if (row.record_type === "contact") contacts.push(record);
    else apps.push(record);
  }
  return { contacts, apps, syncedAt: new Date().toISOString() };
}

async function updateRecord(sql, recordType, record) {
  const id = String(record.id ?? "");
  const expectedVersion = Number(record.version || 0);
  if (!id) return { id, status: "invalid" };
  const payload = cleanPayload(record.data);
  if (!expectedVersion) {
    const inserted = await sql`
      INSERT INTO crm_records (record_type, record_id, payload)
      VALUES (${recordType}, ${id}, ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (record_type, record_id) DO NOTHING
      RETURNING version, updated_at
    `;
    if (inserted.length) {
      return { id, status: "inserted", version: Number(inserted[0].version), updatedAt: inserted[0].updated_at };
    }
    const current = await sql`
      SELECT payload, version, updated_at FROM crm_records
      WHERE record_type = ${recordType} AND record_id = ${id}
    `;
    return {
      id,
      status: "conflict",
      version: Number(current[0].version),
      updatedAt: current[0].updated_at,
      data: current[0].payload
    };
  }
  const rows = await sql`
    UPDATE crm_records
    SET payload = ${JSON.stringify(payload)}::jsonb,
        version = version + 1,
        updated_at = NOW()
    WHERE record_type = ${recordType}
      AND record_id = ${id}
      AND version = ${expectedVersion}
      AND payload IS DISTINCT FROM ${JSON.stringify(payload)}::jsonb
    RETURNING version, updated_at
  `;
  if (rows.length) {
    return { id, status: "updated", version: Number(rows[0].version), updatedAt: rows[0].updated_at };
  }
  const current = await sql`
    SELECT payload, version, updated_at,
           payload = ${JSON.stringify(payload)}::jsonb AS same
    FROM crm_records
    WHERE record_type = ${recordType} AND record_id = ${id}
  `;
  if (!current.length) {
    const inserted = await sql`
      INSERT INTO crm_records (record_type, record_id, payload)
      VALUES (${recordType}, ${id}, ${JSON.stringify(payload)}::jsonb)
      RETURNING version, updated_at
    `;
    return { id, status: "inserted", version: Number(inserted[0].version), updatedAt: inserted[0].updated_at };
  }
  if (current[0].same) {
    return { id, status: "unchanged", version: Number(current[0].version), updatedAt: current[0].updated_at };
  }
  return {
    id,
    status: "conflict",
    version: Number(current[0].version),
    updatedAt: current[0].updated_at,
    data: current[0].payload
  };
}

async function deleteRecord(sql, recordType, record) {
  const id = String(record.id ?? record);
  const version = Number(record.version || 0);
  if (!id || !version) return { id, status: "invalid" };
  const rows = await sql`
    DELETE FROM crm_records
    WHERE record_type = ${recordType} AND record_id = ${id} AND version = ${version}
    RETURNING record_id
  `;
  return { id, status: rows.length ? "deleted" : "conflict" };
}

module.exports = async function handler(request, response) {
  if (!hasValidSession(request)) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  try {
    const sql = getSql();
    await ensureSchema(sql);
    if (request.method === "GET") return response.status(200).json(await getState(sql));
    if (request.method !== "PATCH") {
      response.setHeader("Allow", "GET, PATCH");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    const results = { contacts: [], apps: [], deletedContacts: [], deletedApps: [] };
    for (const record of body.contacts || []) results.contacts.push(await updateRecord(sql, "contact", record));
    for (const record of body.apps || []) results.apps.push(await updateRecord(sql, "application", record));
    for (const record of body.deletedContacts || []) results.deletedContacts.push(await deleteRecord(sql, "contact", record));
    for (const record of body.deletedApps || []) results.deletedApps.push(await deleteRecord(sql, "application", record));
    return response.status(200).json(results);
  } catch (error) {
    console.error("CRM state API error:", error);
    return response.status(500).json({ error: { message: error.message || "CRM sync failed." } });
  }
};
