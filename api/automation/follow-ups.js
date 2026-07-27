const { tokenIsValid } = require("../../lib/crm-auth");
const { getSql } = require("../../lib/crm-db");
const { getBearerToken } = require("../../lib/text-summaries");

function truthy(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function compactText(value, maxLength = 1200) {
  const text = String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maxLength) return text;
  return `…${text.slice(-(maxLength - 1)).trimStart()}`;
}

function nullableText(value, maxLength) {
  return compactText(value, maxLength) || null;
}

function contactName(contact) {
  return (
    nullableText(contact.name, 200) ||
    nullableText([contact.firstName, contact.lastName].filter(Boolean).join(" "), 200) ||
    "Unknown contact"
  );
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function isFollowUp(contact) {
  return (
    contact.status === "follow_up" &&
    !truthy(contact.deleted) &&
    !truthy(contact.archived)
  );
}

function toFollowUp(contact) {
  const contactId = String(contact._recordId ?? contact.id ?? "");
  const numericTier = Number(contact.tier);
  return {
    contact_id: contactId,
    contact_name: contactName(contact),
    company: nullableText(contact.company, 240),
    position: nullableText(contact.position, 240),
    tier: Number.isFinite(numericTier) && numericTier > 0 ? numericTier : null,
    follow_up_date: normalizeDate(contact.followUpDate),
    recent_context: nullableText(contact.notes, 1200),
    email: nullableText(contact.email, 320),
    linkedin: nullableText(contact.linkedin, 1000),
    source_url: contactId
      ? `https://network-crm-data.vercel.app/contacts/${encodeURIComponent(contactId)}`
      : null
  };
}

function sortFollowUps(left, right) {
  if (left.follow_up_date && right.follow_up_date) {
    const dateOrder = left.follow_up_date.localeCompare(right.follow_up_date);
    if (dateOrder) return dateOrder;
  } else if (left.follow_up_date) {
    return -1;
  } else if (right.follow_up_date) {
    return 1;
  }
  return left.contact_name.localeCompare(right.contact_name);
}

async function loadContacts() {
  const sql = getSql();
  const rows = await sql`
    SELECT record_id, payload
    FROM crm_records
    WHERE record_type = 'contact'
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => ({ ...row.payload, _recordId: row.record_id }));
}

function createHandler({ loadContacts: contactLoader = loadContacts } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }

    if (!process.env.NETWORK_CRM_AUTOMATION_TOKEN) {
      return response.status(500).json({
        error: { message: "NETWORK_CRM_AUTOMATION_TOKEN is not set." }
      });
    }

    if (!tokenIsValid(getBearerToken(request))) {
      return response.status(401).json({ error: { message: "Unauthorized" } });
    }

    try {
      const contacts = await contactLoader();
      const followUps = contacts
        .filter(isFollowUp)
        .map(toFollowUp)
        .filter((contact) => contact.contact_id)
        .sort(sortFollowUps);

      return response.status(200).json({ follow_ups: followUps });
    } catch (error) {
      console.error("Follow-ups Neon query failed:", error);
      return response.status(500).json({
        error: { message: "Could not load CRM follow-ups." }
      });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.isFollowUp = isFollowUp;
handler.toFollowUp = toFollowUp;

module.exports = handler;
