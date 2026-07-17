const { hasValidSession } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { parseBody } = require("../../lib/text-summaries");

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

module.exports = async function handler(request, response) {
  if (!hasValidSession(request)) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  if (!['GET', 'PATCH'].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);
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
      return response.status(200).json({ summaries, conversations });
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

    const editedSummary = String(body.summary || "").trim().slice(0, 2000);
    if (!editedSummary) return response.status(400).json({ error: { message: "Summary cannot be empty." } });
    const drafts = await sql`
      SELECT contact_id, conversation_ended_at
      FROM crm_text_summaries
      WHERE id = ${id} AND status = 'pending'
    `;
    if (!drafts.length) return response.status(404).json({ error: { message: "Pending summary not found." } });

    const endedAt = new Date(drafts[0].conversation_ended_at);
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
};
