const { hasValidSession } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { parseBody } = require("../../lib/text-summaries");
const { createContactPayload, sanitizeProposal } = require("../../lib/communication-proposals");

function noteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function listProposals(sql) {
  return sql`
    SELECT p.id, p.source, p.source_message_id, p.recipient_email, p.occurred_at,
           p.proposal_type, p.matched_contact_id, p.evidence, p.proposed, p.created_at,
           COALESCE(r.payload->>'name', '') AS matched_contact_name
    FROM crm_communication_proposals p
    LEFT JOIN crm_records r
      ON r.record_type = 'contact' AND r.record_id = p.matched_contact_id
    WHERE p.status = 'pending'
    ORDER BY p.occurred_at DESC
    LIMIT 250
  `;
}

async function loadPending(sql, id) {
  const rows = await sql`
    SELECT id, proposal_type, matched_contact_id, occurred_at, proposed
    FROM crm_communication_proposals
    WHERE id = ${id} AND status = 'pending'
  `;
  return rows[0] || null;
}

async function ignoreProposal(sql, id) {
  const rows = await sql`
    UPDATE crm_communication_proposals
    SET status = 'ignored', reviewed_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING id
  `;
  return rows.length > 0;
}

async function editProposal(sql, id, type, proposed) {
  const clean = sanitizeProposal(type, proposed);
  const rows = await sql`
    UPDATE crm_communication_proposals
    SET proposed = ${JSON.stringify(clean)}::jsonb
    WHERE id = ${id} AND status = 'pending'
    RETURNING id, proposed
  `;
  return rows[0] || null;
}

async function applyCreate(sql, draft, proposed) {
  const template = createContactPayload(proposed, 0);
  delete template.id;
  const rows = await sql`
    WITH target AS MATERIALIZED (
      SELECT id FROM crm_communication_proposals
      WHERE id = ${Number(draft.id)} AND status = 'pending'
      FOR UPDATE
    ), id_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended('crm-record-id:contact', 0)) AS held
      FROM target
    ), next_id AS MATERIALIZED (
      SELECT COALESCE(MAX(record_id::BIGINT) FILTER (WHERE record_id ~ '^[0-9]+$'), 0) + 1 AS value
      FROM crm_records CROSS JOIN id_lock
      WHERE record_type = 'contact'
    ), inserted AS (
      INSERT INTO crm_records (record_type, record_id, payload)
      SELECT 'contact', next_id.value::TEXT,
             jsonb_set(${JSON.stringify(template)}::jsonb, '{id}', to_jsonb(next_id.value), true)
      FROM target CROSS JOIN next_id
      RETURNING record_id
    ), applied AS (
      UPDATE crm_communication_proposals
      SET status = 'applied', proposed = ${JSON.stringify(sanitizeProposal("create_contact", proposed))}::jsonb,
          reviewed_at = NOW()
      WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM inserted)
      RETURNING id
    )
    SELECT record_id AS contact_id FROM inserted
  `;
  return rows[0]?.contact_id || null;
}

async function applyUpdate(sql, draft, proposed) {
  const clean = sanitizeProposal("update_contact", proposed);
  const note = clean.note ? `${noteDate(draft.occurred_at)}: <strong>Email</strong> — ${escapeHtml(clean.note)}` : "";
  const rows = await sql`
    WITH target AS MATERIALIZED (
      SELECT id, matched_contact_id
      FROM crm_communication_proposals
      WHERE id = ${Number(draft.id)} AND status = 'pending'
      FOR UPDATE
    ), updated AS (
      UPDATE crm_records r
      SET payload = (
            CASE WHEN ${note} <> '' THEN
              jsonb_set(r.payload, '{notes}', to_jsonb(CASE
                WHEN COALESCE(r.payload->>'notes', '') = '' THEN ${note}
                ELSE (r.payload->>'notes') || E'\n' || ${note}
              END), true)
            ELSE r.payload END
          ) || jsonb_strip_nulls(jsonb_build_object(
            'lastContact', CASE
              WHEN ${clean.lastContact} <> '' AND ${clean.lastContact} > COALESCE(r.payload->>'lastContact', '') THEN ${clean.lastContact}
              ELSE NULL END,
            'email', CASE
              WHEN ${clean.email} <> '' AND COALESCE(r.payload->>'email', '') = '' THEN ${clean.email}
              ELSE NULL END,
            'status', CASE WHEN ${clean.status || ""} = 'follow_up' THEN 'follow_up' ELSE NULL END,
            'followUp', CASE WHEN ${clean.status || ""} = 'follow_up' THEN true ELSE NULL END,
            'followUpDate', CASE
              WHEN ${clean.status || ""} <> 'follow_up' OR ${clean.followUpDate} = '' THEN NULL
              WHEN COALESCE(r.payload->>'followUpDate', '') > ${clean.followUpDate} THEN r.payload->>'followUpDate'
              ELSE ${clean.followUpDate} END
          )),
          version = version + 1,
          updated_at = NOW()
      FROM target
      WHERE r.record_type = 'contact' AND r.record_id = target.matched_contact_id
      RETURNING r.record_id
    ), applied AS (
      UPDATE crm_communication_proposals
      SET status = 'applied', proposed = ${JSON.stringify(clean)}::jsonb, reviewed_at = NOW()
      WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM updated)
      RETURNING id
    )
    SELECT record_id AS contact_id FROM updated
  `;
  return rows[0]?.contact_id || null;
}

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || hasValidSession;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const list = dependencies.listProposals || listProposals;
  const load = dependencies.loadPending || loadPending;
  const ignore = dependencies.ignoreProposal || ignoreProposal;
  const edit = dependencies.editProposal || editProposal;
  const create = dependencies.applyCreate || applyCreate;
  const update = dependencies.applyUpdate || applyUpdate;

  return async function handler(request, response) {
    if (!auth(request)) return response.status(401).json({ error: { message: "Unauthorized" } });
    if (!["GET", "PATCH"].includes(request.method)) {
      response.setHeader("Allow", "GET, PATCH");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    try {
      const sql = sqlFactory();
      await schema(sql);
      if (request.method === "GET") return response.status(200).json({ proposals: await list(sql) });
      const body = parseBody(request);
      const id = Number(body?.id);
      if (!id || !["edit", "ignore", "apply"].includes(body?.action)) {
        return response.status(400).json({ error: { message: "Invalid communication review action." } });
      }
      const draft = await load(sql, id);
      if (!draft) return response.status(404).json({ error: { message: "Pending proposal not found." } });
      if (body.action === "ignore") {
        const ignored = await ignore(sql, id);
        return response.status(ignored ? 200 : 404).json(ignored ? { status: "ignored" } : { error: { message: "Pending proposal not found." } });
      }
      const proposed = sanitizeProposal(draft.proposal_type, body.proposed || draft.proposed);
      if (body.action === "edit") {
        const edited = await edit(sql, id, draft.proposal_type, proposed);
        return response.status(edited ? 200 : 404).json(edited ? { status: "pending", proposal: edited.proposed } : { error: { message: "Pending proposal not found." } });
      }
      if (draft.proposal_type === "create_contact" && (!proposed.name || !proposed.email)) {
        return response.status(400).json({ error: { message: "Name and email are required to create a contact." } });
      }
      if (draft.proposal_type === "no_action") return response.status(400).json({ error: { message: "This proposal has no CRM action." } });
      const contactId = draft.proposal_type === "create_contact"
        ? await create(sql, draft, proposed)
        : await update(sql, draft, proposed);
      return response.status(contactId ? 200 : 409).json(contactId
        ? { status: "applied", contactId }
        : { error: { message: "This proposal could not be applied." } });
    } catch (error) {
      console.error("Communication review error:", error);
      return response.status(500).json({ error: { message: error.message || "Communication review failed." } });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.applyCreate = applyCreate;
module.exports.applyUpdate = applyUpdate;
module.exports.listProposals = listProposals;
