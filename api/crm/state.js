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

function validCursor(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getState(sql, since) {
  const cursor = validCursor(since);
  // Keep the upper bound stable so writes during this request arrive on the
  // next incremental sync rather than falling between cursor windows.
  const syncedAt = new Date().toISOString();
  const rows = cursor
    ? await sql`
      SELECT record_type, record_id, payload, version, updated_at
      FROM crm_records
      WHERE updated_at >= ${cursor} AND updated_at <= ${syncedAt}
      ORDER BY record_type, record_id
    `
    : await sql`
      SELECT record_type, record_id, payload, version, updated_at
      FROM crm_records
      ORDER BY record_type, record_id
    `;
  const deleted = cursor
    ? await sql`
      SELECT record_type, record_id
      FROM crm_deleted_records
      WHERE deleted_at >= ${cursor} AND deleted_at <= ${syncedAt}
      ORDER BY record_type, record_id
    `
    : [];
  const contacts = [];
  const apps = [];
  const engagements = [];
  for (const row of rows) {
    const record = {
      ...row.payload,
      _syncVersion: Number(row.version),
      _syncUpdatedAt: new Date(row.updated_at).toISOString()
    };
    if (row.record_type === "contact") contacts.push(record);
    else if (row.record_type === "application") apps.push(record);
    else if (row.record_type === "engagement") engagements.push(record);
  }
  const deletedContacts = [];
  const deletedApps = [];
  const deletedEngagements = [];
  for (const row of deleted) {
    if (row.record_type === "contact") deletedContacts.push({ id: row.record_id });
    else if (row.record_type === "application") deletedApps.push({ id: row.record_id });
    else if (row.record_type === "engagement") deletedEngagements.push({ id: row.record_id });
  }
  return {
    mode: cursor ? "delta" : "full",
    contacts, apps, engagements,
    deletedContacts, deletedApps, deletedEngagements,
    syncedAt
  };
}

async function createRecord(sql, recordType, record) {
  const requestedId = String(record.id ?? "");
  const payload = cleanPayload(record.data);
  const rows = await sql`
    WITH id_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${`crm-record-id:${recordType}`}, 0)) AS held
    ), next_id AS (
      SELECT COALESCE(
        MAX(record_id::BIGINT) FILTER (WHERE record_id ~ '^[0-9]+$'),
        0
      ) + 1 AS value
      FROM crm_records
      CROSS JOIN id_lock
      WHERE record_type = ${recordType}
    )
    INSERT INTO crm_records (record_type, record_id, payload)
    SELECT
      ${recordType},
      next_id.value::TEXT,
      jsonb_set(${JSON.stringify(payload)}::jsonb, '{id}', to_jsonb(next_id.value), true)
    FROM next_id
    RETURNING record_id, payload, version, updated_at
  `;
  const inserted = rows[0];
  return {
    requestedId,
    id: inserted.record_id,
    status: "inserted",
    version: Number(inserted.version),
    updatedAt: inserted.updated_at,
    data: inserted.payload
  };
}

async function updateRecord(sql, recordType, record) {
  const id = String(record.id ?? "");
  const expectedVersion = Number(record.version || 0);
  if (!id) return { id, status: "invalid" };
  const payload = cleanPayload(record.data);
  // A zero-version record is a create from either the current client or a
  // still-open legacy tab. The database assigns its final numeric ID.
  if (record.create || !expectedVersion) return createRecord(sql, recordType, record);
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
    return { id, status: "updated", version: Number(rows[0].version), updatedAt: rows[0].updated_at, data: payload };
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
    return { id, status: "unchanged", version: Number(current[0].version), updatedAt: current[0].updated_at, data: current[0].payload };
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
    WITH removed AS (
      DELETE FROM crm_records
      WHERE record_type = ${recordType} AND record_id = ${id} AND version = ${version}
      RETURNING record_type, record_id
    ), tombstone AS (
      INSERT INTO crm_deleted_records (record_type, record_id, deleted_at)
      SELECT record_type, record_id, NOW() FROM removed
      ON CONFLICT (record_type, record_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at
      RETURNING record_id
    )
    SELECT record_id FROM tombstone
  `;
  return { id, status: rows.length ? "deleted" : "conflict" };
}

function createHandler(dependencies = {}) {
  const getSqlDependency = dependencies.getSql || getSql;
  const ensureSchemaDependency = dependencies.ensureSchema || ensureSchema;
  const updateRecordDependency = dependencies.updateRecord || updateRecord;
  const deleteRecordDependency = dependencies.deleteRecord || deleteRecord;
  const getStateDependency = dependencies.getState || getState;

  return async function handler(request, response) {
  if (!hasValidSession(request)) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  try {
    const sql = getSqlDependency();
    await ensureSchemaDependency(sql);
    if (request.method === "GET") {
      const url = new URL(request.url || "", "https://network-crm.local");
      const since = request.query?.since || url.searchParams.get("since");
      return response.status(200).json(await getStateDependency(sql, since));
    }
    if (request.method !== "PATCH") {
      response.setHeader("Allow", "GET, PATCH");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    const results = { contacts: [], apps: [], engagements: [], deletedContacts: [], deletedApps: [], deletedEngagements: [] };
    for (const record of body.contacts || []) results.contacts.push(await updateRecordDependency(sql, "contact", record));
    for (const record of body.apps || []) results.apps.push(await updateRecordDependency(sql, "application", record));
    for (const record of body.engagements || []) results.engagements.push(await updateRecordDependency(sql, "engagement", record));
    for (const record of body.deletedContacts || []) results.deletedContacts.push(await deleteRecordDependency(sql, "contact", record));
    for (const record of body.deletedApps || []) results.deletedApps.push(await deleteRecordDependency(sql, "application", record));
    for (const record of body.deletedEngagements || []) results.deletedEngagements.push(await deleteRecordDependency(sql, "engagement", record));
    console.info("CRM state PATCH", {
      contacts: results.contacts.map(({ status }) => status),
      apps: results.apps.map(({ status }) => status),
      engagements: results.engagements.map(({ status }) => status),
      deletedContacts: results.deletedContacts.map(({ status }) => status),
      deletedApps: results.deletedApps.map(({ status }) => status),
      deletedEngagements: results.deletedEngagements.map(({ status }) => status)
    });
    return response.status(200).json(results);
  } catch (error) {
    console.error("CRM state API error:", error);
    return response.status(500).json({ error: { message: error.message || "CRM sync failed." } });
  }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.createRecord = createRecord;
module.exports.updateRecord = updateRecord;
module.exports.getState = getState;
module.exports.validCursor = validCursor;
