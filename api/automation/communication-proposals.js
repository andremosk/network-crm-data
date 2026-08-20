const { messagesTokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { getBearerToken, parseBody } = require("../../lib/text-summaries");
const { analyzeOutboundEmail, normalizeEmail } = require("../../lib/communication-proposals");

async function findContactByEmail(sql, email) {
  const rows = await sql`
    SELECT record_id, payload
    FROM crm_records
    WHERE record_type = 'contact'
      AND LOWER(COALESCE(payload->>'email', '')) = ${normalizeEmail(email)}
      AND COALESCE((payload->>'deleted')::boolean, false) = false
      AND COALESCE((payload->>'archived')::boolean, false) = false
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { id: rows[0].record_id, ...rows[0].payload };
}

async function insertProposal(sql, proposal) {
  const rows = await sql`
    INSERT INTO crm_communication_proposals (
      source, source_message_id, source_hash, recipient_email, occurred_at,
      proposal_type, matched_contact_id, evidence, proposed
    ) VALUES (
      ${proposal.source}, ${proposal.sourceMessageId}, ${proposal.sourceHash},
      ${proposal.recipientEmail}, ${proposal.occurredAt}, ${proposal.proposalType},
      ${proposal.matchedContactId}, ${proposal.evidence}, ${JSON.stringify(proposal.proposed)}::jsonb
    )
    ON CONFLICT (source_hash) DO NOTHING
    RETURNING id, status
  `;
  if (rows.length) return { status: "pending", id: Number(rows[0].id), proposalType: proposal.proposalType };
  const existing = await sql`
    SELECT id, status, proposal_type
    FROM crm_communication_proposals
    WHERE source_hash = ${proposal.sourceHash}
  `;
  return { status: "duplicate", id: Number(existing[0]?.id), proposalType: existing[0]?.proposal_type || proposal.proposalType };
}

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || messagesTokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const findContact = dependencies.findContactByEmail || findContactByEmail;
  const saveProposal = dependencies.insertProposal || insertProposal;

  return async function handler(request, response) {
    if (!auth(getBearerToken(request))) {
      return response.status(401).json({ error: { message: "Unauthorized" } });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });

    try {
      const preliminary = analyzeOutboundEmail(body, null);
      if (preliminary.status === "invalid") return response.status(400).json({ error: { message: preliminary.reason } });
      if (preliminary.status === "excluded") return response.status(200).json({ status: "skipped", reason: preliminary.reason });

      const sql = sqlFactory();
      await schema(sql);
      const matchedContact = await findContact(sql, preliminary.recipientEmail);
      const proposal = analyzeOutboundEmail(body, matchedContact);
      const result = await saveProposal(sql, proposal);
      return response.status(200).json(result);
    } catch (error) {
      console.error("Communication proposal import error:", error);
      return response.status(500).json({ error: { message: error.message || "Communication proposal import failed." } });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.findContactByEmail = findContactByEmail;
module.exports.insertProposal = insertProposal;
