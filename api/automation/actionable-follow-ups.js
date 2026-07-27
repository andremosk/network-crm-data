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
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function contactName(contact) {
  return (
    compactText(contact.name, 200) ||
    compactText([contact.firstName, contact.lastName].filter(Boolean).join(" "), 200) ||
    "Unknown contact"
  );
}

function followUpDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function isActionable(contact) {
  return (
    String(contact.status || "").toLowerCase() === "follow_up" &&
    !truthy(contact.deleted) &&
    !truthy(contact.archived) &&
    !truthy(contact.notInterested)
  );
}

function contextFor(contact) {
  const context = {};
  const company = compactText(contact.company, 240);
  const position = compactText(contact.position, 240);
  const notes = compactText(contact.notes);
  if (company) context.company = company;
  if (position) context.position = position;
  if (contact.tier) context.relationship_tier = Number(contact.tier);
  if (contact.clientFitTier) context.client_fit_tier = Number(contact.clientFitTier);
  if (contact.connectorFitTier) context.connector_fit_tier = Number(contact.connectorFitTier);
  if (contact.lastContact) context.last_contact = String(contact.lastContact);
  if (notes) context.notes = notes;
  return context;
}

function followUpRecord(contact) {
  const name = contactName(contact);
  const contactId = String(contact._recordId ?? contact.id ?? "");
  const explicitAction = compactText(
    contact.nextAction ||
      contact.next_action ||
      contact.followUpAction ||
      contact.follow_up_action,
    500
  );
  return {
    follow_up_id: `crm-follow-up:${contactId}`,
    contact_id: contactId,
    contact_name: name,
    next_action: explicitAction || `Follow up with ${name}`,
    follow_up_date: followUpDate(contact.followUpDate || contact.follow_up_date),
    status: "follow_up",
    context: contextFor(contact)
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
        .filter(isActionable)
        .map(followUpRecord)
        .filter((record) => record.contact_id)
        .sort(sortFollowUps);

      return response.status(200).json({
        generated_at: new Date().toISOString(),
        follow_ups: followUps
      });
    } catch (error) {
      console.error("Actionable follow-ups Neon query failed:", error);
      return response.status(500).json({
        error: { message: "Could not load actionable CRM follow-ups." }
      });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.followUpRecord = followUpRecord;
handler.isActionable = isActionable;

module.exports = handler;
