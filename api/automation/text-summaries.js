const { ensureSchema, getSql } = require("../../lib/crm-db");
const { tokenIsValid } = require("../../lib/crm-auth");
const {
  cleanTranscript,
  getBearerToken,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseBody,
  sourceKeyFor,
  summarizeTranscript,
  validDate
} = require("../../lib/text-summaries");

async function contactDirectory(sql) {
  const rows = await sql`
    SELECT record_id, payload
    FROM crm_records
    WHERE record_type = 'contact'
      AND COALESCE((payload->>'deleted')::boolean, false) = false
      AND COALESCE((payload->>'archived')::boolean, false) = false
  `;
  return rows.map((row) => ({
    id: row.record_id,
    name: row.payload.name || [row.payload.firstName, row.payload.lastName].filter(Boolean).join(" "),
    normalizedName: normalizeName(row.payload.name || [row.payload.firstName, row.payload.lastName].filter(Boolean).join(" ")),
    email: normalizeEmail(row.payload.email),
    phone: normalizePhone(row.payload.phone)
  }));
}

module.exports = async function handler(request, response) {
  if (!tokenIsValid(getBearerToken(request))) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);
    if (request.method === 'GET') {
      return response.status(200).json({ contacts: await contactDirectory(sql) });
    }

    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    const transcript = cleanTranscript(body.transcript);
    const startedAt = validDate(body.startedAt);
    const endedAt = validDate(body.endedAt);
    const messageCount = Math.max(0, Math.min(Number(body.messageCount) || 0, 1000));
    if (!body.contactId || !body.sourceKey || !transcript || !startedAt || !endedAt) {
      return response.status(400).json({ error: { message: "Missing or invalid text-summary fields." } });
    }

    const sourceKey = sourceKeyFor(body.sourceKey);
    const existing = await sql`SELECT id, status FROM crm_text_summaries WHERE source_key = ${sourceKey}`;
    if (existing.length) return response.status(200).json({ status: "duplicate", id: existing[0].id });

    const contacts = await sql`
      SELECT record_id, payload FROM crm_records
      WHERE record_type = 'contact' AND record_id = ${String(body.contactId)}
    `;
    if (!contacts.length) return response.status(404).json({ error: { message: "Contact not found." } });

    const contactName = contacts[0].payload.name || "Unknown contact";
    const summary = await summarizeTranscript({ contactName, transcript, startedAt, endedAt });
    if (!summary || summary.toUpperCase() === "SKIP") {
      return response.status(200).json({ status: "skipped" });
    }

    const inserted = await sql`
      INSERT INTO crm_text_summaries (
        contact_id, source_key, summary, conversation_started_at,
        conversation_ended_at, message_count
      ) VALUES (
        ${String(body.contactId)}, ${sourceKey}, ${summary}, ${startedAt.toISOString()},
        ${endedAt.toISOString()}, ${messageCount}
      )
      ON CONFLICT (source_key) DO NOTHING
      RETURNING id
    `;
    return response.status(200).json(inserted.length
      ? { status: "pending", id: inserted[0].id }
      : { status: "duplicate" });
  } catch (error) {
    console.error("Text summary automation error:", error);
    return response.status(500).json({ error: { message: error.message || "Text summary import failed." } });
  }
};
