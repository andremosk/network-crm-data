const crypto = require("crypto");

const STATUSES = new Set(["pursuit", "discovery", "proposal", "active_client", "on_hold", "closed"]);
const MAX_LINKED_CONTACTS = 50;

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T12:00:00Z`).getTime())) return "";
  return text;
}

function requestHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Request body must be an object." };
  const requestId = String(body.request_id || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(requestId)) {
    return { error: "request_id must be 8-200 characters using letters, numbers, '.', '_', ':', or '-'." };
  }
  const value = body.engagement;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "engagement must be an object." };
  const title = cleanText(value.title || value.name, 240);
  const organization = cleanText(value.organization || value.client, 240);
  const status = String(value.status || "pursuit").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const currentState = cleanText(value.current_state || value.currentState || value.context, 3000);
  const opportunity = cleanText(value.opportunity || value.problem, 3000);
  const commercial = cleanText(value.commercial || value.commercial_hypothesis || value.estimate, 1000);
  const nextMilestone = cleanText(value.next_milestone || value.nextMilestone || value.next_action, 1000);
  const rawDate = value.next_milestone_date ?? value.nextMilestoneDate ?? "";
  const nextMilestoneDate = validDate(rawDate);
  const rawIds = value.linked_contact_ids || value.contact_ids || value.contactIds || [];
  if (!title) return { error: "engagement.title is required." };
  if (!STATUSES.has(status)) return { error: "engagement.status is invalid." };
  if (rawDate && !nextMilestoneDate) return { error: "engagement.next_milestone_date must use YYYY-MM-DD." };
  if (!Array.isArray(rawIds) || rawIds.length > MAX_LINKED_CONTACTS) return { error: `linked_contact_ids must contain at most ${MAX_LINKED_CONTACTS} IDs.` };
  const contactIds = [...new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (contactIds.some((id) => id.length > 100)) return { error: "linked_contact_ids contains an invalid ID." };
  return {
    requestId,
    engagement: { title, organization, status, currentState, opportunity, commercial, nextMilestone, nextMilestoneDate, contactIds }
  };
}

function createPayload(value, requestId, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return {
    title: value.title,
    organization: value.organization,
    status: value.status,
    currentState: value.currentState,
    opportunity: value.opportunity,
    commercial: value.commercial,
    nextMilestone: value.nextMilestone,
    nextMilestoneDate: value.nextMilestoneDate,
    contactIds: value.contactIds,
    links: "",
    notes: [],
    createdDate: date,
    updatedDate: date,
    automationRequestIds: [requestId]
  };
}

function publicEngagement(item, created = true) {
  return {
    id: String(item._recordId ?? item.id ?? ""),
    title: item.title,
    organization: item.organization,
    status: item.status,
    created
  };
}

module.exports = { createPayload, publicEngagement, requestHash, validatePayload };
