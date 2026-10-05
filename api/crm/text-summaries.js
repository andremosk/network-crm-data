const { hasValidSession } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { parseBody } = require("../../lib/text-summaries");
const { activeEngagements, suggestEngagement } = require("../../lib/sms-routing");

function noteDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createHandler(dependencies = {}) {
  return (request, response) => handler(request, response, dependencies);
}

async function handler(request, response, dependencies) {
  const auth = dependencies.auth || hasValidSession;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  response.setHeader("Cache-Control", "private, no-store");
  if (!auth(request)) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  if (!['GET', 'PATCH'].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  try {
    const sql = sqlFactory();
    await schema(sql);
    if (request.method === 'GET') {
      const summaries = await sql`
        SELECT id, contact_id, summary, conversation_started_at,
               conversation_ended_at, message_count, created_at
        FROM crm_text_summaries
        WHERE status = 'pending'
        ORDER BY conversation_ended_at DESC
        LIMIT 250
      `;
      const conversations = await sql`
        SELECT conversation_key, participant_label, latest_message_at, created_at
        FROM crm_text_conversations
        WHERE status = 'pending'
        ORDER BY latest_message_at DESC
        LIMIT 250
      `;
      const engagementRows = await sql`SELECT record_id, payload FROM crm_records WHERE record_type = 'engagement'`;
      const engagements = activeEngagements(engagementRows.map(row => ({ ...row.payload, id: row.record_id })));
      const contactIds = [...new Set(summaries.map(item => String(item.contact_id)))];
      const contactRows = contactIds.length ? await sql`SELECT record_id, payload FROM crm_records
        WHERE record_type = 'contact' AND record_id = ANY(${contactIds}::text[])` : [];
      const contacts = new Map(contactRows.map(row => [String(row.record_id), { ...row.payload, id: row.record_id }]));
      return response.status(200).json({
        summaries: summaries.map(item => ({ ...item, suggested_engagement_id:
          suggestEngagement(contacts.get(String(item.contact_id)) || { id: item.contact_id }, item.summary, engagements) })),
        conversations,
        engagements: engagements.map(item => ({ id: String(item.id), title: item.title, organization: item.organization }))
      });
    }

    const body = parseBody(request);
    if (body?.resource === 'conversation') {
      const key = String(body.key || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(key) || !['match', 'dismiss', 'ignore'].includes(body.action)) {
        return response.status(400).json({ error: { message: "Invalid conversation review action." } });
      }
      let contactId = null;
      if (body.action === 'match') {
        contactId = String(body.contactId || "");
        const contacts = await sql`
          SELECT record_id FROM crm_records
          WHERE record_type = 'contact' AND record_id = ${contactId}
        `;
        if (!contacts.length) return response.status(404).json({ error: { message: "Contact not found." } });
      }
      const status = body.action === 'match' ? 'matched' : body.action === 'ignore' ? 'ignored' : 'dismissed';
      const rows = await sql`
        UPDATE crm_text_conversations
        SET status = ${status},
            contact_id = ${contactId},
            reviewed_message_at = latest_message_at,
            updated_at = NOW()
        WHERE conversation_key = ${key} AND status = 'pending'
        RETURNING conversation_key, status, contact_id
      `;
      return response.status(rows.length ? 200 : 404).json(rows.length
        ? { status: rows[0].status, key: rows[0].conversation_key, contactId: rows[0].contact_id }
        : { error: { message: "Pending conversation not found." } });
    }
    const id = Number(body?.id);
    if (!id || !['approve', 'dismiss'].includes(body?.action)) {
      return response.status(400).json({ error: { message: "Invalid review action." } });
    }
    if (body.action === 'dismiss') {
      const rows = await sql`
        UPDATE crm_text_summaries
        SET status = 'dismissed', reviewed_at = NOW()
        WHERE id = ${id} AND status = 'pending'
        RETURNING id, contact_id
      `;
      return response.status(rows.length ? 200 : 404).json(rows.length
        ? { status: "dismissed", contactId: rows[0].contact_id }
        : { error: { message: "Pending summary not found." } });
    }

    const editedSummary = String(body.summary || "").trim().slice(0, 4000);
    if (!editedSummary) return response.status(400).json({ error: { message: "Summary cannot be empty." } });
    const drafts = await sql`
      SELECT contact_id, conversation_ended_at, source_key
      FROM crm_text_summaries
      WHERE id = ${id} AND status = 'pending'
    `;
    if (!drafts.length) return response.status(404).json({ error: { message: "Pending summary not found." } });

    const endedAt = new Date(drafts[0].conversation_ended_at);
    if (body.engagementId != null && String(body.engagementId).trim()) {
      const engagementId = String(body.engagementId).trim();
      const contactRows = await sql`SELECT payload FROM crm_records
        WHERE record_type = 'contact' AND record_id = ${drafts[0].contact_id}`;
      const name = contactRows[0]?.payload.name || "Contact";
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(endedAt);
      const note = { id: `text-summary-${id}`, date, source: "sms", sourceKey: drafts[0].source_key,
        contactId: String(drafts[0].contact_id),
        html: `<strong>SMS - ${escapeHtml(name)}</strong><br>${escapeHtml(editedSummary).replace(/\n/g, "<br>")}` };
      const rows = await sql`
        WITH target AS (
          SELECT record_id FROM crm_records
          WHERE record_type = 'engagement' AND record_id = ${engagementId}
            AND COALESCE(payload->>'status', '') <> 'closed'
            AND COALESCE(payload->>'deleted', 'false') <> 'true'
            AND COALESCE(payload->>'archived', 'false') <> 'true'
          FOR UPDATE
        ), claimed_summary AS (
          UPDATE crm_text_summaries SET status = 'approved', summary = ${editedSummary}, reviewed_at = NOW()
          WHERE id = ${id} AND status = 'pending' AND EXISTS (SELECT 1 FROM target)
          RETURNING contact_id
        ), updated_engagement AS (
          UPDATE crm_records SET payload = jsonb_set(jsonb_set(payload, '{notes}',
            (CASE WHEN jsonb_typeof(payload->'notes') = 'array' THEN payload->'notes'
              WHEN COALESCE(payload->>'notes', '') <> '' THEN jsonb_build_array(jsonb_build_object(
                'id', 'legacy-note', 'date', COALESCE(payload->>'createdDate', ''), 'html', payload->>'notes'))
              ELSE '[]'::jsonb END) || ${JSON.stringify([note])}::jsonb),
              '{updatedDate}', to_jsonb(${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())}::text)),
              version = version + 1, updated_at = NOW()
          WHERE record_type = 'engagement' AND record_id IN (SELECT record_id FROM target)
            AND EXISTS (SELECT 1 FROM claimed_summary)
          RETURNING record_id
        ) SELECT record_id AS engagement_id FROM updated_engagement
      `;
      return response.status(rows.length ? 200 : 409).json(rows.length
        ? { status: "approved", contactId: drafts[0].contact_id, engagementId: rows[0].engagement_id }
        : { error: { message: "Engagement unavailable or summary already reviewed." } });
    }
    const entry = `${noteDate(endedAt)}: <strong>Text summary</strong> — ${escapeHtml(editedSummary)}`;
    const contactDate = endedAt.toISOString().slice(0, 10);
    const rows = await sql`
      WITH claimed_summary AS (
        UPDATE crm_text_summaries
        SET status = 'approved', summary = ${editedSummary}, reviewed_at = NOW()
        WHERE id = ${id} AND status = 'pending'
        RETURNING contact_id
      ), updated_contact AS (
        UPDATE crm_records
        SET payload = jsonb_set(
              jsonb_set(
                payload,
                '{notes}',
                to_jsonb(CASE
                  WHEN COALESCE(payload->>'notes', '') = '' THEN ${entry}
                  ELSE (payload->>'notes') || E'\n' || ${entry}
                END)
              ),
              '{lastContact}',
              to_jsonb(CASE
                WHEN COALESCE(payload->>'lastContact', '') > ${contactDate} THEN payload->>'lastContact'
                ELSE ${contactDate}
              END)
            ),
            version = version + 1,
            updated_at = NOW()
        FROM claimed_summary
        WHERE record_type = 'contact' AND record_id = claimed_summary.contact_id
        RETURNING record_id
      )
      SELECT record_id AS contact_id FROM updated_contact
    `;
    return response.status(rows.length ? 200 : 409).json(rows.length
      ? { status: "approved", contactId: rows[0].contact_id }
      : { error: { message: "Could not approve this summary." } });
  } catch (error) {
    console.error("Text summary review error:", error);
    return response.status(500).json({ error: { message: error.message || "Text summary review failed." } });
  }
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
