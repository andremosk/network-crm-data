const { ensureSchema, getSql } = require("../../lib/crm-db");
const { messagesTokenIsValid } = require("../../lib/crm-auth");
const { suggestEngagement, activeEngagements } = require("../../lib/sms-routing");
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
    phone: normalizePhone(row.payload.phone),
    smsAliases: Array.isArray(row.payload.smsAliases)
      ? row.payload.smsAliases.filter(alias => typeof alias === 'string').map(normalizeName).filter(Boolean)
      : []
  }));
}

async function conversationDecisions(sql) {
  const rows = await sql`
    SELECT conversation_key, status, contact_id, reviewed_message_at
    FROM crm_text_conversations
    WHERE status IN ('matched', 'dismissed', 'ignored')
  `;
  return rows.map((row) => ({
    key: row.conversation_key,
    status: row.status,
    contactId: row.contact_id || undefined,
    reviewedMessageAt: row.reviewed_message_at || undefined
  }));
}

async function recordUnmatchedConversations(sql, body) {
  const conversations = Array.isArray(body.conversations) ? body.conversations.slice(0, 100) : [];
  let accepted = 0;
  for (const item of conversations) {
    const key = String(item?.key || "").toLowerCase();
    const label = String(item?.label || "").trim().slice(0, 200);
    const latestMessageAt = validDate(item?.latestMessageAt);
    if (!/^[a-f0-9]{64}$/.test(key) || !label || !latestMessageAt) continue;
    await sql`
      INSERT INTO crm_text_conversations (
        conversation_key, participant_label, latest_message_at
      ) VALUES (
        ${key}, ${label}, ${latestMessageAt.toISOString()}
      )
      ON CONFLICT (conversation_key) DO UPDATE
      SET participant_label = EXCLUDED.participant_label,
          latest_message_at = GREATEST(crm_text_conversations.latest_message_at, EXCLUDED.latest_message_at),
          status = CASE
            WHEN crm_text_conversations.status = 'dismissed'
              AND EXCLUDED.latest_message_at > COALESCE(crm_text_conversations.reviewed_message_at, '-infinity'::timestamptz)
            THEN 'pending'
            ELSE crm_text_conversations.status
          END,
          updated_at = NOW()
    `;
    accepted += 1;
  }
  return accepted;
}

function createHandler(dependencies = {}) {
  return (request, response) => handler(request, response, dependencies);
}

async function handler(request, response, dependencies) {
  if (!(dependencies.auth || messagesTokenIsValid)(getBearerToken(request))) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  try {
    const sql = (dependencies.getSql || getSql)();
    await (dependencies.ensureSchema || ensureSchema)(sql);
    if (request.method === 'GET') {
      const [contacts, decisions] = await Promise.all([
        contactDirectory(sql),
        conversationDecisions(sql)
      ]);
      return response.status(200).json({ contacts, conversationDecisions: decisions });
    }

    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    if (body.type === 'unmatched') {
      const accepted = await recordUnmatchedConversations(sql, body);
      return response.status(200).json({ status: "recorded", accepted });
    }
    const transcript = cleanTranscript(body.transcript);
    const startedAt = validDate(body.startedAt);
    const endedAt = validDate(body.endedAt);
    const messageCount = Math.max(0, Math.min(Number(body.messageCount) || 0, 1000));
    const isGroup = body.isGroup === true;
    const group = isGroup ? {
      isGroup: true,
      threadKey: String(body.threadKey || ''),
      title: String(body.threadTitle || '').trim().slice(0, 200),
      participants: [...new Set((Array.isArray(body.participants) ? body.participants : [])
        .filter(name => typeof name === 'string').map(name => name.trim().slice(0, 120)).filter(Boolean))].slice(0, 30)
    } : null;
    if (isGroup && (!/^[a-f0-9]{64}$/.test(group.threadKey) || !group.title || !group.participants.length || body.contactId)) {
      return response.status(400).json({ error: { message: 'Group proposals need a thread identity and speakers, not an automatic contact match.' } });
    }
    if ((!isGroup && !body.contactId) || !body.sourceKey || !transcript || !startedAt || !endedAt || endedAt < startedAt) {
      return response.status(400).json({ error: { message: "Missing or invalid text-summary fields." } });
    }

    const sourceKey = sourceKeyFor(body.sourceKey);
    const existing = await sql`SELECT id, status FROM crm_text_summaries WHERE source_key = ${sourceKey}`;
    if (existing.length) return response.status(200).json({ status: "duplicate", id: existing[0].id });

    const contacts = isGroup ? [] : await sql`
      SELECT record_id, payload FROM crm_records
      WHERE record_type = 'contact' AND record_id = ${String(body.contactId)}
    `;
    if (!isGroup && !contacts.length) return response.status(404).json({ error: { message: "Contact not found." } });

    const contactName = isGroup ? group.title : contacts[0].payload.name || "Unknown contact";
    const engagementRows = isGroup ? [] : await sql`SELECT record_id, payload FROM crm_records WHERE record_type = 'engagement'`;
    const engagements = activeEngagements(engagementRows.map(row => ({ ...row.payload, id: row.record_id })));
    const engagementId = isGroup ? null : suggestEngagement({ ...contacts[0].payload, id: contacts[0].record_id }, transcript, engagements);
    const engagement = engagements.find(item => String(item.id) === engagementId);
    const summary = await (dependencies.summarizeTranscript || summarizeTranscript)({ contactName, transcript, startedAt, endedAt, engagement, group });
    if (!summary || summary.toUpperCase() === "SKIP") {
      return response.status(200).json({ status: "skipped" });
    }

    const inserted = await sql`
      INSERT INTO crm_text_summaries (
        contact_id, source_key, summary, conversation_started_at,
        conversation_ended_at, message_count, conversation_context
      ) VALUES (
        ${isGroup ? null : String(body.contactId)}, ${sourceKey}, ${summary}, ${startedAt.toISOString()},
        ${endedAt.toISOString()}, ${messageCount}, ${JSON.stringify(group || {})}::jsonb
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
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
